import type { SortItem } from './types.js';

/**
 * A decoded keyset cursor: the ordered values of the keyset columns (the active
 * sort columns plus a stable primary-key tiebreaker) captured from a boundary
 * row. The values line up positionally with the keyset's {@link SortItem}[].
 */
export type CursorValues = unknown[];

/**
 * Cursor (keyset) pagination parameters, as parsed from a request:
 *
 * - `after` — return the page immediately following this opaque cursor (forward).
 * - `before` — return the page immediately preceding this opaque cursor (backward).
 * - `first` / `last` — page size for forward / backward paging respectively.
 *
 * `after` and `before` are mutually exclusive; if both are given, `after` wins.
 */
export interface CursorParams {
  after?: string;
  before?: string;
  first?: number;
  last?: number;
}

/**
 * A single page of keyset-paginated results assembled by {@link buildCursorPage}.
 *
 * - `items` — the rows for this page, in the requested order.
 * - `nextCursor` — opaque cursor for the next forward page, or `null` when this
 *   is the last page.
 * - `prevCursor` — opaque cursor for the previous (backward) page, or `null`
 *   when this is the first page.
 * - `hasNext` / `hasPrev` — convenience booleans mirroring the cursors.
 */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Encodes keyset cursor values into a compact, URL-safe opaque string
 * (base64url of a JSON array). The shape is intentionally opaque to clients —
 * only this module reads it back.
 *
 * `Date` values are encoded as `{ $d: <iso> }` so they round-trip to `Date`
 * instances on decode (plain JSON would yield a string and break date keyset
 * comparisons).
 */
export function encodeCursor(values: CursorValues): string {
  // Pre-map Date values to a tagged form. We cannot detect dates in the
  // JSON.stringify replacer because Date.toJSON() has already converted them to
  // strings by the time the replacer sees the value.
  const tagged = values.map((v) => (v instanceof Date ? { $d: v.toISOString() } : v));
  const json = JSON.stringify(tagged);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor string back into its keyset values. Returns `null`
 * when the cursor is malformed (bad base64, bad JSON, or not an array) so the
 * caller can ignore an invalid cursor instead of crashing.
 */
export function decodeCursor(cursor: string): CursorValues | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json, (_key, value) => {
      if (value && typeof value === 'object' && typeof value.$d === 'string') {
        return new Date(value.$d);
      }
      return value;
    });
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Builds the keyset {@link SortItem}[] for cursor pagination: the caller's
 * effective sorts, with a stable primary-key tiebreaker appended if it is not
 * already present. The tiebreaker inherits the direction of the last sort column
 * so the overall ordering stays monotonic (important for a correct
 * `(cols, pk) > (...)` comparison).
 */
export function buildKeyset(sorts: SortItem[], primaryKey: string): SortItem[] {
  const hasPk = sorts.some((s) => s.field === primaryKey);
  if (hasPk) return sorts;
  const lastDirection = sorts[sorts.length - 1]?.direction ?? 'asc';
  return [...sorts, { field: primaryKey, direction: lastDirection }];
}

/** Flips every keyset column's direction (for backward cursor paging). */
export function reverseKeyset(keyset: SortItem[]): SortItem[] {
  return keyset.map((s) => ({
    field: s.field,
    direction: s.direction === 'asc' ? ('desc' as const) : ('asc' as const),
  }));
}

/**
 * Extracts the keyset values from a fetched row, in keyset column order.
 * Supports dotted relation paths (e.g. `author.name`) by walking the object.
 */
export function extractCursorValues(
  row: Record<string, unknown>,
  keyset: SortItem[],
): CursorValues {
  return keyset.map((s) => {
    if (!s.field.includes('.')) return row[s.field];
    let current: unknown = row;
    for (const segment of s.field.split('.')) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  });
}

/** The keyset shape {@link applyCursor} resolves and hands to {@link buildCursorPage}. */
export interface ResolvedCursor {
  /** The base keyset (effective sort + primary-key tiebreaker), in forward order. */
  keyset: SortItem[];
  /** Effective page size — the number of rows to keep for this page. */
  size: number;
  /** True when paging backward (a `before` cursor was supplied). */
  backward: boolean;
  /** True when a cursor (`after`/`before`) was supplied — the opposite page is then known to exist. */
  hasCursor: boolean;
}

/**
 * Assembles a {@link CursorPage} from the rows fetched for a keyset query.
 *
 * The query is expected to have been built by {@link applyCursor}, which fetches
 * one extra row (`limit = size + 1`) so we can detect a further page. For
 * backward paging the rows come back reversed and are flipped here to restore
 * the caller's requested order. Boundary cursors are computed from the base
 * keyset so they round-trip regardless of paging direction.
 */
export function buildCursorPage<T extends Record<string, unknown>>(
  rows: T[],
  resolved: ResolvedCursor,
): CursorPage<T> {
  const { keyset, size, backward, hasCursor } = resolved;

  const hasExtra = rows.length > size;
  let pageRows = hasExtra ? rows.slice(0, size) : rows;
  if (backward) pageRows = pageRows.slice().reverse();

  const firstRow = pageRows[0];
  const lastRow = pageRows[pageRows.length - 1];
  const startCursor = firstRow ? encodeCursor(extractCursorValues(firstRow, keyset)) : null;
  const endCursor = lastRow ? encodeCursor(extractCursorValues(lastRow, keyset)) : null;

  // With a cursor present, the opposite-direction page is known to exist; the
  // same-direction page exists iff we saw the extra row.
  const hasNext = backward ? hasCursor : hasExtra;
  const hasPrev = backward ? hasExtra : hasCursor;

  return {
    items: pageRows,
    nextCursor: hasNext ? endCursor : null,
    prevCursor: hasPrev ? startCursor : null,
    hasNext,
    hasPrev,
  };
}

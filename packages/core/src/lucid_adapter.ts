import { escapeLike } from './escape-like.js';
import type { ColumnFilter, FilterOperator } from './operators.js';
import type { SortItem } from './types.js';
import { normalizeOperator } from './validate-column-filter.js';

/**
 * The structural subset of a Lucid `ModelQueryBuilder` / `DatabaseQueryBuilder`
 * the adapter drives. An `@adonisjs/lucid` query builder satisfies it — declared
 * locally so the adapter never hard-imports Lucid (and stays unit-testable with a
 * recording mock). The nested-callback `where`/`orWhere` overloads model Lucid's
 * grouping closures used for AND/OR composition.
 */
export interface QueryBuilderLike {
  where(callback: (qb: QueryBuilderLike) => void): QueryBuilderLike;
  where(column: string, value: unknown): QueryBuilderLike;
  where(column: string, operator: string, value: unknown): QueryBuilderLike;
  orWhere(callback: (qb: QueryBuilderLike) => void): QueryBuilderLike;
  /**
   * Constrain the query to rows whose `relation` has at least one related row
   * matching the nested conditions — Lucid's `whereHas`. Used to translate a
   * dotted relation-path filter (`posts.title = x`) into a real subquery
   * (`whereHas('posts', (q) => q.where('title', x))`) instead of a dotted
   * column reference. Optional on real Lucid builders; the recording mock
   * implements it so relation translation stays unit-testable.
   */
  whereHas(relation: string, callback: (qb: QueryBuilderLike) => void): QueryBuilderLike;
  whereNot(column: string, value: unknown): QueryBuilderLike;
  whereIn(column: string, values: unknown[]): QueryBuilderLike;
  whereNotIn(column: string, values: unknown[]): QueryBuilderLike;
  whereNull(column: string): QueryBuilderLike;
  whereNotNull(column: string): QueryBuilderLike;
  whereBetween(column: string, range: [unknown, unknown]): QueryBuilderLike;
  whereNotBetween(column: string, range: [unknown, unknown]): QueryBuilderLike;
  whereILike(column: string, value: string): QueryBuilderLike;
  orWhereILike(column: string, value: string): QueryBuilderLike;
  orderBy(column: string, direction: 'asc' | 'desc'): QueryBuilderLike;
  limit(count: number): QueryBuilderLike;
}

/** Wrap a value as a LIKE pattern with escaped metacharacters. */
function like(value: unknown, kind: 'contains' | 'startsWith' | 'endsWith'): string {
  const v = escapeLike(String(value));
  if (kind === 'startsWith') return `${v}%`;
  if (kind === 'endsWith') return `%${v}`;
  return `%${v}%`;
}

/**
 * Apply a single (leaf) column filter to the builder.
 *
 * A dotted `field` is a **relation path** (`posts.title`, `posts.comments.body`):
 * every segment but the last is a relation hop, translated into a nested Lucid
 * `whereHas` subquery, and the final segment is the bare column the operator
 * lands on inside the innermost relation query — so `posts.title = x` becomes
 * `whereHas('posts', (q) => q.where('title', x))`. Depth is already bounded by
 * the spec's `maxDepth` allow-list before a filter reaches the adapter, so this
 * only translates paths that were explicitly whitelisted. A non-dotted `field`
 * is a plain base column and takes the operator switch directly.
 */
function applyLeaf(qb: QueryBuilderLike, field: string, operator: FilterOperator, value: unknown) {
  const dot = field.indexOf('.');
  if (dot !== -1) {
    const relation = field.slice(0, dot);
    const rest = field.slice(dot + 1);
    qb.whereHas(relation, (sub) => applyLeaf(sub, rest, operator, value));
    return;
  }
  switch (operator) {
    case 'equals':
      qb.where(field, value);
      break;
    case 'notEquals':
      qb.whereNot(field, value);
      break;
    case 'contains':
    case 'iContains':
      qb.whereILike(field, like(value, 'contains'));
      break;
    case 'startsWith':
      qb.whereILike(field, like(value, 'startsWith'));
      break;
    case 'endsWith':
      qb.whereILike(field, like(value, 'endsWith'));
      break;
    case 'notContains':
      qb.where((sub) => sub.whereNot(field, value).whereNotNull(field));
      break;
    case 'gt':
      qb.where(field, '>', value);
      break;
    case 'gte':
      qb.where(field, '>=', value);
      break;
    case 'lt':
      qb.where(field, '<', value);
      break;
    case 'lte':
      qb.where(field, '<=', value);
      break;
    case 'between':
      qb.whereBetween(field, value as [unknown, unknown]);
      break;
    case 'notBetween':
      qb.whereNotBetween(field, value as [unknown, unknown]);
      break;
    case 'in':
    case 'isAnyOf':
      qb.whereIn(field, value as unknown[]);
      break;
    case 'notIn':
      qb.whereNotIn(field, value as unknown[]);
      break;
    case 'isNull':
    case 'notExists':
      qb.whereNull(field);
      break;
    case 'isNotNull':
    case 'exists':
      qb.whereNotNull(field);
      break;
    case 'isEmpty':
      qb.where(field, '');
      break;
    case 'isNotEmpty':
      qb.whereNot(field, '');
      break;
  }
}

/**
 * Apply one {@link ColumnFilter} (possibly an AND/OR group) to a builder. A leaf
 * is a single condition; `AND`/`OR` recurse into a grouped sub-builder so the
 * boolean structure maps to Lucid's nested `where`/`orWhere` closures.
 */
function applyOne(qb: QueryBuilderLike, filter: ColumnFilter): void {
  const op = normalizeOperator(filter.operator);
  const hasField = typeof filter.field === 'string' && filter.field.length > 0;

  qb.where((group) => {
    if (hasField) {
      applyLeaf(group, filter.field, op, filter.value);
    }
    if (filter.AND) {
      for (const sub of filter.AND) {
        group.where((g) => applyOne(g, sub));
      }
    }
    if (filter.OR) {
      for (const sub of filter.OR) {
        group.orWhere((g) => applyOne(g, sub));
      }
    }
  });
}

/** Apply an array of column filters (combined with AND) to a Lucid query builder. */
export function applyColumnFilters(qb: QueryBuilderLike, filters: ColumnFilter[]): void {
  for (const filter of filters) {
    applyOne(qb, filter);
  }
}

/** Apply sort directives to a Lucid query builder, in order. */
export function applySort(qb: QueryBuilderLike, sorts: SortItem[]): void {
  for (const sort of sorts) {
    qb.orderBy(sort.field, sort.direction);
  }
}

/**
 * Apply a keyset (cursor) seek predicate to a Lucid query builder for row-value
 * comparison across the keyset columns.
 *
 * Given a keyset (the active sort columns plus a primary-key tiebreaker, each
 * with a direction) and a boundary row's values, this constrains the query to
 * rows strictly *after* the boundary in keyset order. The row-value comparison
 * is expanded into the portable "OR of AND tiers" form that works across all
 * SQL dialects:
 *
 * ```text
 *   (c0 OP0 v0)
 *   OR (c0 = v0 AND c1 OP1 v1)
 *   OR (c0 = v0 AND c1 = v1 AND c2 OP2 v2) ...
 * ```
 *
 * where `OPi` is `>` for an `asc` column and `<` for a `desc` column. The whole
 * predicate is wrapped in one AND-group so it composes with any existing
 * `where` conditions. A no-op when the keyset is empty or `values` does not line
 * up positionally with it.
 */
export function applyKeyset(qb: QueryBuilderLike, keyset: SortItem[], values: unknown[]): void {
  if (keyset.length === 0 || values.length !== keyset.length) return;

  qb.where((outer) => {
    for (let tier = 0; tier < keyset.length; tier++) {
      const buildTier = (inner: QueryBuilderLike) => {
        // Equality on every column before this tier.
        for (let i = 0; i < tier; i++) {
          inner.where(keyset[i]!.field, values[i]);
        }
        const cmp = keyset[tier]!.direction === 'asc' ? '>' : '<';
        inner.where(keyset[tier]!.field, cmp, values[tier]);
      };
      // First tier seeds the group with AND; the rest OR onto it.
      if (tier === 0) outer.where(buildTier);
      else outer.orWhere(buildTier);
    }
  });
}

/** Apply a free-text ILIKE search across `columns` (OR-combined) to a Lucid query builder. */
export function applySearch(qb: QueryBuilderLike, term: string, columns: string[]): void {
  if (columns.length === 0 || term.length === 0) return;
  const pattern = like(term, 'contains');
  qb.where((group) => {
    for (const column of columns) {
      group.orWhereILike(column, pattern);
    }
  });
}

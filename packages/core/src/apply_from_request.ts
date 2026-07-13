import type { CursorParams, ResolvedCursor } from './cursor.js';
import { type FilterSpec, specToFilterConfig } from './filter_spec.js';
import { applyColumnFilters, type QueryBuilderLike } from './lucid_adapter.js';
import type { ColumnFilter } from './operators.js';
import { parseFilterRequest } from './parse_request.js';
import { type CursorConfig, type ResolvedPagination, applyCursor, applyFilter } from './runner.js';
import type { FilterInput } from './types.js';

/**
 * The structural slice of an AdonisJS `HttpContext` these helpers read. Only
 * `request.qs()` (the decoded query string) is used to source the raw input;
 * the whole ctx is also handed to a spec's tenant resolver. Declared
 * structurally so the package never hard-imports `@adonisjs/core` — a real
 * `HttpContext` satisfies it, and tests can pass a plain object.
 */
export interface FilterRequestContext {
  request?: { qs?: () => Record<string, unknown> };
  // biome-ignore lint/suspicious/noExplicitAny: ctx is opaque to us beyond request.qs; the tenant resolver reads the rest.
  [key: string]: any;
}

/** Options shared by the request-driven helpers. */
export interface ApplyFromRequestOptions {
  /**
   * Pre-parsed input to use instead of reading `ctx.request.qs()`. Useful for
   * non-HTTP callers and tests; when omitted the query string is parsed via
   * {@link parseFilterRequest}.
   */
  input?: FilterInput;
  /**
   * Query embedding for pgvector similarity ranking. The idiomatic path: the
   * controller computes it from an embedding service and passes it here (rather
   * than shipping a large float array through the query string). Ignored unless
   * the spec declares a `vector` column; merged over any `input.vector`.
   */
  vector?: readonly number[];
}

/** Options for {@link applyCursorFromRequest}. */
export interface ApplyCursorFromRequestOptions extends ApplyFromRequestOptions {
  /** Primary-key column appended to the keyset as a stable tiebreaker. Default `'id'`. */
  primaryKey?: string;
}

/** Read the decoded query string off the ctx (empty object when absent). */
function rawQs(ctx: FilterRequestContext | undefined): Record<string, unknown> {
  const qs = ctx?.request?.qs;
  if (typeof qs === 'function') return qs.call(ctx?.request) ?? {};
  return {};
}

/**
 * Apply the server-side, non-client-tamperable scope to the query BEFORE the
 * allow-listed request filters: the tenant constraint (when the spec declares
 * one and a tenant id resolves from ctx) and any `defaultFilters`. These bypass
 * the allow-list on purpose — they are trusted server policy, mirroring how the
 * NestJS runner applied `@TenantScoped` via the adapter's auto-field path.
 */
function applyServerScope(
  query: QueryBuilderLike,
  spec: FilterSpec,
  ctx: FilterRequestContext | undefined,
): void {
  const serverFilters: ColumnFilter[] = [];

  if (spec.tenant) {
    const tenantId = spec.tenant.resolve(ctx);
    if (tenantId !== undefined && tenantId !== null) {
      serverFilters.push({ field: spec.tenant.column, operator: 'equals', value: tenantId });
    }
  }
  if (spec.defaultFilters.length > 0) {
    serverFilters.push(...(spec.defaultFilters as ColumnFilter[]));
  }
  if (serverFilters.length > 0) {
    applyColumnFilters(query, serverFilters);
  }
}

/** Fall back to the spec's `defaultSort` when the request supplied no sort. */
function withDefaultSort(input: FilterInput, spec: FilterSpec): FilterInput {
  if ((!input.sort || input.sort.length === 0) && spec.defaultSort.length > 0) {
    return { ...input, sort: [...spec.defaultSort] };
  }
  return input;
}

/**
 * Apply a {@link FilterSpec} to a Lucid query from a request context, returning
 * the resolved offset pagination — the single explicit call an AdonisJS
 * controller makes (the idiomatic replacement for the NestJS
 * `ApplyFilterInterceptor` + `@ApplyFilter` param decorator).
 *
 * It resolves the request input from `ctx.request.qs()`, injects the server
 * scope (tenant + default filters) that is never exposed to the allow-list, and
 * delegates the allow-listed filter/sort/search + pagination resolution to
 * {@link applyFilter}.
 *
 * ```ts
 * const spec = defineFilter({ filterable: ['name', 'age'], tenant: { column: 'tenantId', resolve: (ctx) => ctx.auth.user.tenantId } })
 *
 * // in a controller:
 * const query = User.query()
 * const { page, size } = applyFilterFromRequest(query, spec, ctx)
 * return query.paginate(page, size)
 * ```
 */
export function applyFilterFromRequest(
  query: QueryBuilderLike,
  spec: FilterSpec,
  ctx: FilterRequestContext | undefined,
  options: ApplyFromRequestOptions = {},
): ResolvedPagination {
  const parsed = options.input ?? parseFilterRequest(rawQs(ctx));
  const withVector =
    options.vector !== undefined ? { ...parsed, vector: options.vector } : parsed;
  applyServerScope(query, spec, ctx);
  return applyFilter(query, withDefaultSort(withVector, spec), specToFilterConfig(spec));
}

/** Parse cursor (keyset) params from a decoded query string (Spatie `page[...]` shapes). */
function parseCursorParams(qs: Record<string, unknown>): CursorParams {
  const out: CursorParams = {};
  const page =
    qs.page != null && typeof qs.page === 'object' && !Array.isArray(qs.page)
      ? (qs.page as Record<string, unknown>)
      : undefined;

  const after = qs.after ?? page?.after;
  const before = qs.before ?? page?.before;
  if (typeof after === 'string' && after.length > 0) out.after = after;
  else if (typeof before === 'string' && before.length > 0) out.before = before;

  const first = qs.first ?? page?.first;
  const last = qs.last ?? page?.last;
  const toInt = (v: unknown): number | undefined => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const f = toInt(first);
  const l = toInt(last);
  if (f !== undefined) out.first = f;
  if (l !== undefined) out.last = l;

  return out;
}

/**
 * The keyset (cursor) counterpart of {@link applyFilterFromRequest}. Sources the
 * request filters and the `after`/`before`/`first`/`last` cursor params from ctx,
 * injects the same server scope, and delegates to {@link applyCursor}. Feed the
 * fetched rows and the returned {@link ResolvedCursor} to `buildCursorPage`.
 */
export function applyCursorFromRequest(
  query: QueryBuilderLike,
  spec: FilterSpec,
  ctx: FilterRequestContext | undefined,
  options: ApplyCursorFromRequestOptions = {},
): ResolvedCursor {
  const qs = rawQs(ctx);
  const parsed = options.input ?? parseFilterRequest(qs);
  const full: FilterInput & CursorParams = {
    ...withDefaultSort(parsed, spec),
    ...parseCursorParams(qs),
  };
  applyServerScope(query, spec, ctx);
  const config: CursorConfig = {
    ...specToFilterConfig(spec),
    ...(options.primaryKey !== undefined && { primaryKey: options.primaryKey }),
  };
  return applyCursor(query, full, config);
}

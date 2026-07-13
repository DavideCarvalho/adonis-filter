import type { FieldAliases } from './field_aliases.js';
import type { VectorDistanceMetric } from './lucid_adapter.js';
import type { ColumnFilter } from './operators.js';

/** A sort directive: field + direction. */
export interface SortItem {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * Where a request's structured input is read from, for {@link resolveInputFromRequest}:
 *
 * - `'auto'` — query on reads (GET/HEAD), query+body (body wins) on writes.
 * - `'query'` / `'body'` — always that container.
 * - a dot-path (e.g. `'body.filters'`) — the nested object at that path.
 * - a function — a custom extractor receiving the raw request.
 */
export type InputSource =
  | 'auto'
  | 'query'
  | 'body'
  // biome-ignore lint/suspicious/noExplicitAny: `string & {}` keeps literal autocomplete while allowing dot-paths.
  | (string & {})
  | ((req: unknown) => Record<string, unknown> | undefined);

/**
 * How incoming field-name keys are normalized before matching against the
 * allow-list — a built-in case transform or a custom mapping function.
 */
export type InputNormalizer = 'camelCase' | 'snakeCase' | ((key: string) => string);

/**
 * The parsed, structured input a {@link applyFilter} call consumes — produced by
 * {@link parseFilterRequest} from a request query string, or built directly.
 */
export interface FilterInput {
  /** Column filter conditions (with optional AND/OR composition). */
  filters?: ColumnFilter[];
  /** Sort directives, applied in order. */
  sort?: SortItem[];
  /** Free-text search term, applied across the configured searchable columns. */
  search?: string;
  /** 1-based page number for offset pagination. */
  page?: number;
  /** Page size for offset pagination. */
  size?: number;
  /**
   * A query embedding to rank rows by pgvector similarity. Applied only when the
   * policy declares a vector-searchable column (see {@link FilterConfig.vector}) —
   * ignored otherwise, so non-vector requests are unchanged. Typically the
   * controller computes this from an embedding service, not the query string.
   */
  vector?: readonly number[];
}

/**
 * Declares a pgvector-searchable column on a policy. When a request also carries
 * a query embedding ({@link FilterInput.vector}), the runner ranks rows by
 * ascending distance to it. Additive — a policy without this behaves exactly as
 * before.
 */
export interface VectorSearchConfig {
  /** The pgvector column ranked against the query embedding (e.g. `'embedding'`). */
  column: string;
  /** Distance metric → pgvector operator. Default `'cosine'` (`<=>`). */
  metric?: VectorDistanceMetric;
  /** Optional max-distance filter — drop rows farther than this from the embedding. */
  threshold?: number;
  /** Optional top-K truncation — keep only the K nearest rows. */
  topK?: number;
}

/**
 * An allow-list of field names — the security boundary for filter/sort. One of:
 *
 * - `'*'` — allow any field (use with care);
 * - `string[]` — allow exactly these field names;
 * - a predicate `(field) => boolean` — allow fields for which it returns true.
 *   The predicate form lets a policy express rules a flat list can't (e.g.
 *   relation-path whitelisting with a depth cap). It is evaluated against the
 *   already alias-resolved target field, never the client-facing alias key.
 */
export type AllowList = '*' | string[] | ((field: string) => boolean);

/**
 * Per-call filter policy. The allow-lists are the security boundary: only fields
 * named here can be filtered/sorted/searched, so client input can never probe
 * arbitrary columns.
 */
export interface FilterConfig {
  /** Columns clients may filter on. `'*'` allows any (use with care). */
  allowed: AllowList;
  /** Columns clients may sort on. Defaults to {@link FilterConfig.allowed}. */
  sortable?: AllowList;
  /** Columns the free-text `search` term scans (ILIKE). */
  searchable?: string[];
  /** Default page size when none is given. Default 25. */
  defaultSize?: number;
  /** Hard cap on page size. Default 100. */
  maxSize?: number;
  /** Throw `InvalidColumnFilterError` on a disallowed/invalid field instead of dropping it. Default false (drop). */
  throwOnInvalid?: boolean;
  /**
   * Declarative field-name remapping applied to filter and sort fields BEFORE
   * allow-listing — an alias key resolves to its target column, which is what
   * the allow-list, validation and query builder then see. Aliases do not
   * cascade. See {@link resolveFieldAlias}.
   */
  aliases?: FieldAliases;
  /**
   * Opt-in pgvector similarity search. When set and the request carries a query
   * embedding ({@link FilterInput.vector}), rows are ranked nearest-first by
   * distance to it. Omitted → no vector search (default).
   */
  vector?: VectorSearchConfig;
}

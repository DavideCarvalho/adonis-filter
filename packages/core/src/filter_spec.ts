import type { FieldAliases } from './field_aliases.js';
import type { FilterFieldTypeInfo } from './generate_client.js';
import type { ColumnFilter } from './operators.js';
import type {
  AllowList,
  FilterConfig,
  FullTextSearchConfig,
  SortItem,
  VectorSimilarityConfig,
} from './types.js';

/**
 * Thrown when a {@link defineFilter} declaration is itself invalid (a developer
 * error surfaced at wiring time, not a bad client request). Request-time
 * violations (a disallowed field under `throwOnInvalid`) still surface as
 * `InvalidColumnFilterError` from the runner — this is the one new typed error,
 * for the declaration boundary the NestJS `@Filterable` decorator guarded.
 */
export class FilterDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterDefinitionError';
  }
}

/** Column-level allow-list for a relation: `'*'` (any column) or a bare-name list. */
export type RelationColumns = string[] | '*';

/**
 * The filterable/sortable declaration for one whitelisted relation, keyed by the
 * relation name on the owning model. Column names are **bare** (unprefixed) — the
 * request field is the dotted path `relation.column`. Nesting `relations` again
 * whitelists deeper paths (`relation.child.column`), bounded by `maxDepth`.
 */
export interface RelationSpec {
  /** Columns of the related model clients may filter on. Defaults to `'*'`. */
  filterable?: RelationColumns;
  /** Columns of the related model clients may sort on. Defaults to `filterable`. */
  sortable?: RelationColumns;
  /** Further whitelisted relations reachable from this one (one hop deeper). */
  relations?: Record<string, RelationSpec>;
}

/**
 * Reads the current tenant id from the request context (the AdonisJS
 * `HttpContext`, or any object the caller passes). A `null`/`undefined` result
 * means "no tenant in context" — tenant scoping is then skipped (opt-in, exactly
 * like the NestJS `@TenantScoped` no-op when no tenant resolves).
 */
export type TenantResolver = (ctx: unknown) => string | number | null | undefined;

/** Tenant auto-scope: constrain `column` to the tenant id resolved from ctx. */
export interface TenantScopeSpec {
  /** The model column constrained to the current tenant id (e.g. `'tenantId'`). */
  column: string;
  /** Resolves the tenant id from the request ctx. Nullish → scope is skipped. */
  resolve: TenantResolver;
}

/**
 * The declarative filter definition — the idiomatic AdonisJS reimplementation of
 * everything the NestJS `@Filterable`/`@Relations`/`@TenantScoped` decorators
 * encoded, as a plain options object (no decorators, no metadata reflection).
 */
export interface DefineFilterOptions {
  /** Columns clients may filter on. `'*'` allows any base column. */
  filterable: RelationColumns;
  /** Columns clients may sort on. Defaults to {@link DefineFilterOptions.filterable}. */
  sortable?: RelationColumns;
  /**
   * Columns the free-text `search` term scans with a portable ILIKE — the
   * default search path when {@link DefineFilterOptions.fullText} is not set.
   */
  searchable?: string[];
  /**
   * Per-field column value types. Declaring a field here does two things at once:
   *
   * 1. **Server-side validation.** A query-string filter value is always a string, and Postgres
   *    silently casts the benign cases (`day_of_week = '3'` works) — so the gap stays invisible
   *    until a client sends something uncastable (`is_recurring = 'xyz'`), which raises
   *    `invalid input syntax for type boolean` at the database and surfaces as a **500 driven by
   *    user input**. With a declared kind the value is coerced up front, and one that can't be
   *    coerced is treated exactly like a disallowed field: dropped, or a loud
   *    `InvalidColumnFilterError` (→ 400) under {@link DefineFilterOptions.throwOnInvalid}.
   * 2. **Type-aware client codegen.** `make:filter-client` reads the same declaration, so the
   *    emitted client narrows operators per field instead of being operator-permissive.
   *
   * One declaration, both ends. Undeclared fields keep the previous behaviour (no coercion), so
   * adding this to an existing spec is opt-in and backwards compatible.
   */
  fieldTypes?: Record<string, FilterFieldTypeInfo>;
  /**
   * Opt-in Postgres tsvector full-text search. When set, the request `search`
   * string routes through `websearch_to_tsquery`/`@@` (and optional `ts_rank`)
   * instead of the ILIKE `searchable` scan. Column(s) + language + rank.
   */
  fullText?: FullTextSearchConfig;
  /** Whitelisted relations and their nested filterable/sortable columns. */
  relations?: Record<string, RelationSpec>;
  /**
   * Maximum relation-path depth (number of relation hops; a base column is
   * depth 0, `posts.title` is depth 1, `posts.comments.body` is depth 2).
   * Defaults to the deepest declared relation nesting. An explicit smaller value
   * caps paths even when a deeper relation is declared.
   */
  maxDepth?: number;
  /** Client-alias → resolved-target field remapping (see {@link resolveFieldAlias}). */
  aliases?: FieldAliases;
  /**
   * Opt-in pgvector embedding-similarity ordering (distinct from text `search`):
   * declares the vector column (and metric / threshold / top-K) rows are ranked
   * by when a request carries a query embedding. Additive — a spec without this
   * is unchanged.
   */
  vectorSimilarity?: VectorSimilarityConfig;
  /** Opt-in tenant auto-scope read from ctx. */
  tenant?: TenantScopeSpec;
  /**
   * Server-declared filters always applied (in real column terms, AND-combined
   * with the request filters). Not subject to the allow-list — they are trusted
   * server policy, never client input.
   */
  defaultFilters?: ColumnFilter[];
  /** Sort applied when the request supplies none (stable default ordering). */
  defaultSort?: SortItem[];
  /** Default page size when the request gives none. Default 25 (in the runner). */
  defaultSize?: number;
  /** Hard cap on page size. Default 100 (in the runner). */
  maxSize?: number;
  /** Throw `InvalidColumnFilterError` on a disallowed field instead of dropping it. */
  throwOnInvalid?: boolean;
}

/**
 * A resolved, reusable, frozen filter definition produced by {@link defineFilter}.
 * Build it once (module scope) and hand it to {@link applyFilterFromRequest} on
 * every request. The `isFilterable`/`isSortable` predicates are the allow-list
 * boundary — relation-path and depth aware — that the runner enforces.
 */
export interface FilterSpec {
  readonly filterable: RelationColumns;
  readonly sortable: RelationColumns;
  readonly searchable: readonly string[];
  /** Declared column value kinds — drives value coercion AND client codegen. */
  readonly fieldTypes: Readonly<Record<string, FilterFieldTypeInfo>> | undefined;
  readonly fullText: FullTextSearchConfig | undefined;
  readonly relations: Readonly<Record<string, RelationSpec>>;
  readonly maxDepth: number;
  readonly aliases: FieldAliases | undefined;
  readonly vectorSimilarity: VectorSimilarityConfig | undefined;
  readonly tenant: TenantScopeSpec | undefined;
  readonly defaultFilters: readonly ColumnFilter[];
  readonly defaultSort: readonly SortItem[];
  readonly defaultSize: number | undefined;
  readonly maxSize: number | undefined;
  readonly throwOnInvalid: boolean;
  /** Is this (possibly relation-dotted, alias-resolved) field filterable? */
  isFilterable(field: string): boolean;
  /** Is this (possibly relation-dotted, alias-resolved) field sortable? */
  isSortable(field: string): boolean;
}

/** Blocked path segments that could otherwise index inherited prototype members. */
const BLOCKED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

/** Deepest relation nesting declared under `relations` (0 when none). */
function declaredDepth(relations: Record<string, RelationSpec> | undefined): number {
  if (!relations) return 0;
  let max = 0;
  for (const rel of Object.values(relations)) {
    max = Math.max(max, 1 + declaredDepth(rel.relations));
  }
  return max;
}

/** Does an allow-list admit a bare column name? `undefined` → treated as `'*'`. */
function columnAllowed(list: RelationColumns | undefined, column: string): boolean {
  if (list === undefined || list === '*') return true;
  return list.includes(column);
}

/**
 * Resolve a (possibly dotted) field path against the base allow-lists and the
 * relation whitelist, enforcing `maxDepth`. Pure — the client-supplied `field`
 * is only ever read, and each segment is guarded against prototype-pollution
 * lookups before it indexes the relations map.
 */
function pathAllowed(
  field: string,
  kind: 'filterable' | 'sortable',
  baseFilterable: RelationColumns,
  baseSortable: RelationColumns,
  relations: Record<string, RelationSpec>,
  maxDepth: number,
): boolean {
  const segments = field.split('.');

  // Base column (no relation hop).
  if (segments.length === 1) {
    const seg = segments[0]!;
    if (seg.length === 0 || BLOCKED_SEGMENTS.has(seg)) return false;
    return columnAllowed(kind === 'filterable' ? baseFilterable : baseSortable, seg);
  }

  // Relation path — bounded by maxDepth (hops = segments - 1).
  if (segments.length - 1 > maxDepth) return false;

  let node: Record<string, RelationSpec> | undefined = relations;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (seg.length === 0 || BLOCKED_SEGMENTS.has(seg)) return false;
    if (!node || !Object.hasOwn(node, seg)) return false;
    const rel: RelationSpec = node[seg]!;

    // Last hop: the final segment is the leaf column on this relation.
    if (i === segments.length - 2) {
      const leaf = segments[segments.length - 1]!;
      if (leaf.length === 0 || BLOCKED_SEGMENTS.has(leaf)) return false;
      const list = kind === 'filterable' ? rel.filterable : (rel.sortable ?? rel.filterable);
      return columnAllowed(list, leaf);
    }
    node = rel.relations;
  }
  return false;
}

/**
 * Build a reusable {@link FilterSpec} from a declarative {@link DefineFilterOptions}.
 *
 * This is the AdonisJS-idiomatic replacement for the NestJS decorator stack:
 * instead of `@Filterable`/`@Relations`/`@TenantScoped` metadata read by an
 * interceptor, the definition is an explicit, framework-free config object built
 * once and passed explicitly to {@link applyFilterFromRequest}. It captures the
 * same feature set the decorators encoded — filterable/sortable allow-listing,
 * a relation whitelist with a depth cap, field aliases, tenant scoping, and
 * default filters/sort.
 */
export function defineFilter(options: DefineFilterOptions): FilterSpec {
  if (!options || options.filterable === undefined) {
    throw new FilterDefinitionError('defineFilter requires a `filterable` allow-list.');
  }
  if (
    options.maxDepth !== undefined &&
    (!Number.isInteger(options.maxDepth) || options.maxDepth < 0)
  ) {
    throw new FilterDefinitionError('`maxDepth` must be a non-negative integer.');
  }

  const relations = options.relations ?? {};
  const filterable = options.filterable;
  const sortable = options.sortable ?? options.filterable;
  const maxDepth = options.maxDepth ?? declaredDepth(relations);

  const spec: FilterSpec = {
    filterable,
    sortable,
    searchable: options.searchable ?? [],
    fieldTypes: options.fieldTypes,
    fullText: options.fullText,
    relations,
    maxDepth,
    aliases: options.aliases,
    vectorSimilarity: options.vectorSimilarity,
    tenant: options.tenant,
    defaultFilters: options.defaultFilters ?? [],
    defaultSort: options.defaultSort ?? [],
    defaultSize: options.defaultSize,
    maxSize: options.maxSize,
    throwOnInvalid: options.throwOnInvalid ?? false,
    isFilterable(field: string): boolean {
      return pathAllowed(field, 'filterable', filterable, sortable, relations, maxDepth);
    },
    isSortable(field: string): boolean {
      return pathAllowed(field, 'sortable', filterable, sortable, relations, maxDepth);
    },
  };

  return Object.freeze(spec);
}

/**
 * Project a {@link FilterSpec} onto the per-call {@link FilterConfig} the runner's
 * {@link applyFilter}/{@link applyCursor} consume. The allow-lists become
 * predicates (so relation-path + depth rules survive), and `defaultSort` fields
 * are unioned into the sortable predicate so a server-declared default ordering
 * is never dropped by the client-facing sort allow-list.
 */
export function specToFilterConfig(spec: FilterSpec): FilterConfig {
  const defaultSortFields = new Set(spec.defaultSort.map((s) => s.field));
  const allowed: AllowList = (field) => spec.isFilterable(field);
  const sortable: AllowList = (field) => spec.isSortable(field) || defaultSortFields.has(field);

  return {
    allowed,
    sortable,
    ...(spec.searchable.length > 0 && { searchable: [...spec.searchable] }),
    ...(spec.fieldTypes && { fieldTypes: spec.fieldTypes }),
    ...(spec.fullText && { fullText: spec.fullText }),
    ...(spec.aliases && { aliases: spec.aliases }),
    ...(spec.vectorSimilarity && { vectorSimilarity: spec.vectorSimilarity }),
    ...(spec.defaultSize !== undefined && { defaultSize: spec.defaultSize }),
    ...(spec.maxSize !== undefined && { maxSize: spec.maxSize }),
    throwOnInvalid: spec.throwOnInvalid,
  };
}

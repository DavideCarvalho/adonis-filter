import {
  type QueryBuilderLike,
  applyColumnFilters,
  applySearch,
  applySort,
} from './lucid_adapter.js';
import type { ColumnFilter } from './operators.js';
import type { FilterConfig, FilterInput, SortItem } from './types.js';
import { InvalidColumnFilterError, validateColumnFilters } from './validate-column-filter.js';

/** The resolved offset pagination to hand to Lucid's `query.paginate(page, size)`. */
export interface ResolvedPagination {
  page: number;
  size: number;
}

function isAllowed(field: string, allow: string[] | '*'): boolean {
  return allow === '*' || allow.includes(field);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Recursively prune a filter against the allow-list. A leaf on a disallowed field
 * is dropped (or throws when `throwOnInvalid`). Group nodes keep only their
 * surviving children; a group left empty is itself dropped (returns `null`).
 */
function prune(
  filter: ColumnFilter,
  allowed: string[] | '*',
  throwOnInvalid: boolean,
): ColumnFilter | null {
  const hasField = typeof filter.field === 'string' && filter.field.length > 0;

  if (hasField && !isAllowed(filter.field, allowed)) {
    if (throwOnInvalid) {
      throw new InvalidColumnFilterError(`Field "${filter.field}" is not filterable.`);
    }
    return null;
  }

  const next: ColumnFilter = { field: filter.field, operator: filter.operator };
  if (filter.value !== undefined) next.value = filter.value;

  if (filter.AND) {
    const kept = filter.AND.map((f) => prune(f, allowed, throwOnInvalid)).filter(
      (f): f is ColumnFilter => f !== null,
    );
    if (kept.length > 0) next.AND = kept;
  }
  if (filter.OR) {
    const kept = filter.OR.map((f) => prune(f, allowed, throwOnInvalid)).filter(
      (f): f is ColumnFilter => f !== null,
    );
    if (kept.length > 0) next.OR = kept;
  }

  // A pure group node (no field of its own) with no surviving children is empty.
  if (!hasField && next.AND === undefined && next.OR === undefined) {
    return null;
  }
  return next;
}

/**
 * Apply a parsed {@link FilterInput} to a Lucid query builder under a
 * {@link FilterConfig} policy, and return the resolved offset pagination.
 *
 * The allow-lists are the security boundary — fields not in `allowed`/`sortable`/
 * `searchable` are dropped (or rejected with `throwOnInvalid`). Pagination is
 * returned (not applied) so the caller drives Lucid's `query.paginate()`:
 *
 * ```ts
 * const { page, size } = applyFilter(Users.query(), input, { allowed: ['name', 'age'] })
 * const result = await Users.query()... // or: await query.paginate(page, size)
 * ```
 */
export function applyFilter(
  qb: QueryBuilderLike,
  input: FilterInput,
  config: FilterConfig,
): ResolvedPagination {
  const throwOnInvalid = config.throwOnInvalid ?? false;
  const sortable = config.sortable ?? config.allowed;

  if (input.filters && input.filters.length > 0) {
    // Structural validation first (operator/value shape, depth, field charset).
    validateColumnFilters(input.filters);
    const safe = input.filters
      .map((f) => prune(f, config.allowed, throwOnInvalid))
      .filter((f): f is ColumnFilter => f !== null);
    if (safe.length > 0) {
      applyColumnFilters(qb, safe);
    }
  }

  if (input.search && config.searchable && config.searchable.length > 0) {
    const term = input.search.trim();
    if (term.length > 0) {
      applySearch(qb, term, config.searchable);
    }
  }

  if (input.sort && input.sort.length > 0) {
    const safeSort: SortItem[] = [];
    for (const sort of input.sort) {
      if (isAllowed(sort.field, sortable)) {
        safeSort.push(sort);
      } else if (throwOnInvalid) {
        throw new InvalidColumnFilterError(`Field "${sort.field}" is not sortable.`);
      }
    }
    if (safeSort.length > 0) {
      applySort(qb, safeSort);
    }
  }

  const size = clamp(input.size ?? config.defaultSize ?? 25, 1, config.maxSize ?? 100);
  const page = Math.max(1, input.page ?? 1);
  return { page, size };
}

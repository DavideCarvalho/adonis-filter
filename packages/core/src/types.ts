import type { ColumnFilter } from './operators.js';

/** A sort directive: field + direction. */
export interface SortItem {
  field: string;
  direction: 'asc' | 'desc';
}

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
}

/**
 * Per-call filter policy. The allow-lists are the security boundary: only fields
 * named here can be filtered/sorted/searched, so client input can never probe
 * arbitrary columns.
 */
export interface FilterConfig {
  /** Columns clients may filter on. `'*'` allows any (use with care). */
  allowed: string[] | '*';
  /** Columns clients may sort on. Defaults to {@link FilterConfig.allowed}. */
  sortable?: string[] | '*';
  /** Columns the free-text `search` term scans (ILIKE). */
  searchable?: string[];
  /** Default page size when none is given. Default 25. */
  defaultSize?: number;
  /** Hard cap on page size. Default 100. */
  maxSize?: number;
  /** Throw `InvalidColumnFilterError` on a disallowed/invalid field instead of dropping it. Default false (drop). */
  throwOnInvalid?: boolean;
}

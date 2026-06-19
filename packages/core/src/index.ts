/** Keep in sync with this package's `version` in package.json. */
export const VERSION = '0.1.0';

export type {
  ColumnFilter,
  FilterOperator,
  FilterOperatorAlias,
  FilterOperatorInput,
} from './operators.js';
export { FILTER_OPERATORS, OPERATOR_ALIASES } from './operators.js';
export {
  InvalidColumnFilterError,
  MAX_FILTER_DEPTH,
  normalizeOperator,
  validateColumnFilter,
  validateColumnFilters,
} from './validate-column-filter.js';
export { isOperatorObject, valueToColumnFilters } from './value-shape.js';
export { escapeLike } from './escape-like.js';
export type { FilterConfig, FilterInput, SortItem } from './types.js';
export { parseFilterRequest } from './parse_request.js';
export { applyFilter } from './runner.js';
export type { ResolvedPagination } from './runner.js';
export {
  applyColumnFilters,
  applySearch,
  applySort,
  type QueryBuilderLike,
} from './lucid_adapter.js';

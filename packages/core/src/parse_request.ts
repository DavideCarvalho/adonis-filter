import type { ColumnFilter, FilterOperatorInput } from './operators.js';
import type { FilterInput, SortItem } from './types.js';

function toInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Map one `filter[field]=…` entry to `ColumnFilter[]` (Spatie/JSON:API shapes). */
export function toColumnFilters(field: string, value: unknown): ColumnFilter[] {
  // Array (`filter[id][]=1&filter[id][]=2`) → IN.
  if (Array.isArray(value)) {
    return [{ field, operator: 'in', value }];
  }
  // Operator object (`filter[age][gte]=18`) → one filter per operator key.
  if (value != null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([operator, opValue]) => ({
      field,
      operator: operator as FilterOperatorInput,
      value: opValue,
    }));
  }
  // Comma-separated scalar (Spatie multi-value convention) → IN.
  if (typeof value === 'string' && value.includes(',')) {
    return [
      {
        field,
        operator: 'in',
        value: value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      },
    ];
  }
  // Bare scalar → equals.
  return [{ field, operator: 'equals', value }];
}

/** Parse the `sort` param (`-createdAt,name` or `sort[]=…`) into ordered {@link SortItem}s. */
export function parseSort(sort: unknown): SortItem[] {
  let raw: string[] = [];
  if (typeof sort === 'string') raw = sort.split(',');
  else if (Array.isArray(sort)) raw = sort.filter((s): s is string => typeof s === 'string');

  const items: SortItem[] = [];
  for (const entry of raw) {
    const field = entry.trim();
    if (field.length === 0) continue;
    if (field.startsWith('-')) items.push({ field: field.slice(1), direction: 'desc' });
    else items.push({ field, direction: 'asc' });
  }
  return items;
}

function parsePagination(qs: Record<string, unknown>): { page?: number; size?: number } {
  let page = toInt(qs.page);
  let size = toInt(qs.size);
  // JSON:API nested form: page[number] / page[size].
  if (qs.page != null && typeof qs.page === 'object' && !Array.isArray(qs.page)) {
    const p = qs.page as Record<string, unknown>;
    page = toInt(p.number) ?? page;
    size = toInt(p.size) ?? size;
  }
  return { ...(page !== undefined && { page }), ...(size !== undefined && { size }) };
}

/**
 * Parse a decoded request query object — e.g. AdonisJS `ctx.request.qs()` — into
 * a structured {@link FilterInput}. Understands the Spatie / JSON:API shapes the
 * `@agora/filter-client` builder emits:
 *
 * - `filter[status]=active` → equals
 * - `filter[id]=1,2,3` / `filter[id][]=1&filter[id][]=2` → IN
 * - `filter[age][gte]=18` → operator filter
 * - `sort=-createdAt,name` → sort items
 * - `search=term`, `page`/`size` (or `page[number]`/`page[size]`)
 *
 * Pure reshape — no validation or allow-listing here; that happens in
 * {@link applyFilter} against the {@link FilterConfig}.
 */
export function parseFilterRequest(qs: Record<string, unknown>): FilterInput {
  const out: FilterInput = {};

  if (qs.filter != null && typeof qs.filter === 'object' && !Array.isArray(qs.filter)) {
    const filters: ColumnFilter[] = [];
    for (const [field, value] of Object.entries(qs.filter as Record<string, unknown>)) {
      filters.push(...toColumnFilters(field, value));
    }
    if (filters.length > 0) out.filters = filters;
  }

  const sort = parseSort(qs.sort);
  if (sort.length > 0) out.sort = sort;

  if (typeof qs.search === 'string' && qs.search.length > 0) out.search = qs.search;

  const { page, size } = parsePagination(qs);
  if (page !== undefined) out.page = page;
  if (size !== undefined) out.size = size;

  return out;
}

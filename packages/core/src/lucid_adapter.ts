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
}

/** Wrap a value as a LIKE pattern with escaped metacharacters. */
function like(value: unknown, kind: 'contains' | 'startsWith' | 'endsWith'): string {
  const v = escapeLike(String(value));
  if (kind === 'startsWith') return `${v}%`;
  if (kind === 'endsWith') return `%${v}`;
  return `%${v}%`;
}

/** Apply a single (leaf) column filter to the builder. */
function applyLeaf(qb: QueryBuilderLike, field: string, operator: FilterOperator, value: unknown) {
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

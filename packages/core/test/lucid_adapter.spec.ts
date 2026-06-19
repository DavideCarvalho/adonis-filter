import { describe, expect, it } from 'vitest';
import { applyColumnFilters, applySearch, applySort } from '../src/lucid_adapter.js';
import type { ColumnFilter } from '../src/operators.js';
import { MockQueryBuilder } from './mock_query_builder.js';

describe('lucid adapter — applyColumnFilters', () => {
  it('translates equals / comparison operators', () => {
    const qb = new MockQueryBuilder();
    applyColumnFilters(qb, [
      { field: 'name', operator: 'equals', value: 'Al' },
      { field: 'age', operator: 'gte', value: 18 },
    ]);
    expect(qb.flatten()).toContainEqual({ method: 'where', args: ['name', 'Al'] });
    expect(qb.flatten()).toContainEqual({ method: 'where', args: ['age', '>=', 18] });
  });

  it('translates contains to an escaped ILIKE pattern', () => {
    const qb = new MockQueryBuilder();
    applyColumnFilters(qb, [{ field: 'name', operator: 'contains', value: '50%_x' }]);
    const call = qb.find('whereILike');
    expect(call?.args[0]).toBe('name');
    // % and _ are escaped, then wrapped.
    expect(call?.args[1]).toBe('%50\\%\\_x%');
  });

  it('translates in / between / null operators', () => {
    const qb = new MockQueryBuilder();
    applyColumnFilters(qb, [
      { field: 'id', operator: 'in', value: [1, 2, 3] },
      { field: 'score', operator: 'between', value: [10, 20] },
      { field: 'deletedAt', operator: 'isNull' },
    ]);
    expect(qb.find('whereIn')?.args).toEqual(['id', [1, 2, 3]]);
    expect(qb.find('whereBetween')?.args).toEqual(['score', [10, 20]]);
    expect(qb.find('whereNull')?.args).toEqual(['deletedAt']);
  });

  it('composes OR groups', () => {
    const qb = new MockQueryBuilder();
    const filter: ColumnFilter = {
      field: '',
      operator: 'equals',
      OR: [
        { field: 'status', operator: 'equals', value: 'active' },
        { field: 'status', operator: 'equals', value: 'pending' },
      ],
    };
    applyColumnFilters(qb, [filter]);
    const flat = qb.flatten();
    expect(flat).toContainEqual({ method: 'where', args: ['status', 'active'] });
    expect(flat).toContainEqual({ method: 'where', args: ['status', 'pending'] });
  });
});

describe('lucid adapter — applySort / applySearch', () => {
  it('applies sort directives in order', () => {
    const qb = new MockQueryBuilder();
    applySort(qb, [
      { field: 'createdAt', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
    expect(qb.flatten()).toEqual([
      { method: 'orderBy', args: ['createdAt', 'desc'] },
      { method: 'orderBy', args: ['name', 'asc'] },
    ]);
  });

  it('applies an OR ILIKE search across columns', () => {
    const qb = new MockQueryBuilder();
    applySearch(qb, 'foo', ['name', 'email']);
    const likes = qb.flatten().filter((c) => c.method === 'orWhereILike');
    expect(likes).toEqual([
      { method: 'orWhereILike', args: ['name', '%foo%'] },
      { method: 'orWhereILike', args: ['email', '%foo%'] },
    ]);
  });

  it('no-ops search with no columns or empty term', () => {
    const qb = new MockQueryBuilder();
    applySearch(qb, '', ['name']);
    applySearch(qb, 'x', []);
    expect(qb.flatten()).toEqual([]);
  });
});

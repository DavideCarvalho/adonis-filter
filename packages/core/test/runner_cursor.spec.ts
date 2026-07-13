import { describe, expect, it } from 'vitest';
import { encodeCursor } from '../src/cursor.js';
import { applyCursor } from '../src/runner.js';
import { MockQueryBuilder } from './mock_query_builder.js';

describe('applyCursor', () => {
  it('orders by the keyset (sort + pk tiebreaker) and fetches size + 1 rows', () => {
    const qb = new MockQueryBuilder();
    const resolved = applyCursor(
      qb,
      { sort: [{ field: 'name', direction: 'asc' }], first: 10 },
      { allowed: ['name'], primaryKey: 'id' },
    );

    expect(resolved.keyset).toEqual([
      { field: 'name', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ]);
    expect(resolved.size).toBe(10);
    expect(resolved.backward).toBe(false);
    expect(resolved.hasCursor).toBe(false);

    const orderBys = qb.flatten().filter((c) => c.method === 'orderBy');
    expect(orderBys).toEqual([
      { method: 'orderBy', args: ['name', 'asc'] },
      { method: 'orderBy', args: ['id', 'asc'] },
    ]);
    expect(qb.find('limit')?.args).toEqual([11]);
  });

  it('applies a keyset seek predicate for a forward `after` cursor', () => {
    const qb = new MockQueryBuilder();
    const cursor = encodeCursor(['Bob', 5]);
    applyCursor(
      qb,
      { sort: [{ field: 'name', direction: 'asc' }], after: cursor, first: 5 },
      { allowed: ['name'], primaryKey: 'id' },
    );
    const flat = qb.flatten();
    expect(flat).toContainEqual({ method: 'where', args: ['name', '>', 'Bob'] });
    expect(flat).toContainEqual({ method: 'where', args: ['id', '>', 5] });
  });

  it('reverses the keyset ordering for a backward `before` cursor', () => {
    const qb = new MockQueryBuilder();
    const cursor = encodeCursor(['Bob', 5]);
    const resolved = applyCursor(
      qb,
      { sort: [{ field: 'name', direction: 'asc' }], before: cursor, last: 5 },
      { allowed: ['name'], primaryKey: 'id' },
    );
    expect(resolved.backward).toBe(true);
    // base keyset stays forward for cursor extraction...
    expect(resolved.keyset).toEqual([
      { field: 'name', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ]);
    // ...but the ORDER BY walks the reversed direction.
    const orderBys = qb.flatten().filter((c) => c.method === 'orderBy');
    expect(orderBys).toEqual([
      { method: 'orderBy', args: ['name', 'desc'] },
      { method: 'orderBy', args: ['id', 'desc'] },
    ]);
  });

  it('drops a disallowed sort column but still keyset-orders by the pk', () => {
    const qb = new MockQueryBuilder();
    const resolved = applyCursor(
      qb,
      { sort: [{ field: 'secret', direction: 'asc' }], first: 5 },
      { allowed: ['name'], primaryKey: 'id' },
    );
    expect(resolved.keyset).toEqual([{ field: 'id', direction: 'asc' }]);
    expect(qb.flatten().filter((c) => c.method === 'orderBy')).toEqual([
      { method: 'orderBy', args: ['id', 'asc'] },
    ]);
  });

  it('applies allow-listed filters through the same boundary as applyFilter', () => {
    const qb = new MockQueryBuilder();
    applyCursor(
      qb,
      { filters: [{ field: 'name', operator: 'equals', value: 'Al' }], first: 5 },
      { allowed: ['name'], primaryKey: 'id' },
    );
    expect(qb.flatten()).toContainEqual({ method: 'where', args: ['name', 'Al'] });
  });

  it('clamps the page size to maxSize', () => {
    const qb = new MockQueryBuilder();
    const resolved = applyCursor(qb, { first: 999 }, { allowed: '*', maxSize: 50 });
    expect(resolved.size).toBe(50);
    expect(qb.find('limit')?.args).toEqual([51]);
  });
});

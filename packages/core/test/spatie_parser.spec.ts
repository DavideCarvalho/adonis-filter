import { describe, expect, it } from 'vitest';
import { parseSpatieRequest } from '../src/spatie_parser.js';

/**
 * `parseSpatieRequest` receives an already query-string-decoded object — the
 * shape AdonisJS `ctx.request.qs()` (bracket notation expanded) produces for
 * spatie-laravel-query-builder / JSON:API style query strings — and maps it onto
 * the library's `SpatieInput` (a superset of `FilterInput`).
 */
describe('parseSpatieRequest', () => {
  it('maps filter[field]=value to an equals column filter', () => {
    const out = parseSpatieRequest({ filter: { name: 'Al' } });
    expect(out.filters).toEqual([{ field: 'name', operator: 'equals', value: 'Al' }]);
  });

  it('splits a comma-separated scalar filter value into an IN', () => {
    const out = parseSpatieRequest({ filter: { id: '1,2,3' } });
    expect(out.filters).toEqual([{ field: 'id', operator: 'in', value: ['1', '2', '3'] }]);
  });

  it('keeps an already-array filter value as an IN', () => {
    const out = parseSpatieRequest({ filter: { id: ['1', '2'] } });
    expect(out.filters).toEqual([{ field: 'id', operator: 'in', value: ['1', '2'] }]);
  });

  it('maps filter[field][operator]=value to an operator column filter', () => {
    const out = parseSpatieRequest({ filter: { name: { contains: 'Al' } } });
    expect(out.filters).toEqual([{ field: 'name', operator: 'contains', value: 'Al' }]);
  });

  it('maps multiple operators on one field to one filter each', () => {
    const out = parseSpatieRequest({
      filter: { createdAt: { gte: '2026-01-01', lte: '2026-12-31' } },
    });
    expect(out.filters).toEqual([
      { field: 'createdAt', operator: 'gte', value: '2026-01-01' },
      { field: 'createdAt', operator: 'lte', value: '2026-12-31' },
    ]);
  });

  it('parses sort into ordered SortItems', () => {
    const out = parseSpatieRequest({ sort: '-createdAt,name' });
    expect(out.sort).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
  });

  it('parses include (comma string) into a relation list', () => {
    const out = parseSpatieRequest({ include: 'posts,comments' });
    expect(out.include).toEqual(['posts', 'comments']);
  });

  it('parses include as an array', () => {
    const out = parseSpatieRequest({ include: ['posts', 'comments'] });
    expect(out.include).toEqual(['posts', 'comments']);
  });

  it('maps fields[resource]=a,b to sparse fieldsets (select)', () => {
    const out = parseSpatieRequest({ fields: { users: 'id,name' } });
    expect(out.select).toEqual(['id', 'name']);
  });

  it('merges + dedups sparse fieldsets across multiple resources', () => {
    const out = parseSpatieRequest({ fields: { users: 'id,name', posts: 'title,id' } });
    expect(out.select).toEqual(['id', 'name', 'title']);
  });

  it('maps page[number]/page[size] to offset pagination', () => {
    const out = parseSpatieRequest({ page: { number: '2', size: '10' } });
    expect(out.page).toBe(2);
    expect(out.size).toBe(10);
    expect(out.after).toBeUndefined();
  });

  it('maps page[after]/page[size] to cursor pagination (forward)', () => {
    const out = parseSpatieRequest({ page: { after: 'abc', size: '10' } });
    expect(out.after).toBe('abc');
    expect(out.first).toBe(10);
    expect(out.page).toBeUndefined();
  });

  it('maps page[before]/page[size] to cursor pagination (backward)', () => {
    const out = parseSpatieRequest({ page: { before: 'xyz', size: '5' } });
    expect(out.before).toBe('xyz');
    expect(out.last).toBe(5);
  });

  it('after wins when both cursor bounds are present', () => {
    const out = parseSpatieRequest({ page: { after: 'a', before: 'b', size: '3' } });
    expect(out.after).toBe('a');
    expect(out.first).toBe(3);
    expect(out.before).toBeUndefined();
  });

  it('preserves a top-level search term', () => {
    const out = parseSpatieRequest({ filter: { name: 'Al' }, search: 'fleet' });
    expect(out.search).toBe('fleet');
  });

  it('ignores unknown top-level keys', () => {
    const out = parseSpatieRequest({ filter: { name: 'Al' }, somethingElse: 'x' });
    expect(out).not.toHaveProperty('somethingElse');
  });

  it('returns an empty object for non-object input', () => {
    expect(parseSpatieRequest(null)).toEqual({});
    expect(parseSpatieRequest('foo')).toEqual({});
  });
});

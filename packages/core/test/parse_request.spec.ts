import { describe, expect, it } from 'vitest';
import { parseDistinct, parseFilterRequest } from '../src/parse_request.js';

describe('parseFilterRequest', () => {
  it('parses scalar, operator-object, and comma-list filters', () => {
    const input = parseFilterRequest({
      filter: { status: 'active', age: { gte: '18' }, id: '1,2,3' },
    });
    expect(input.filters).toEqual([
      { field: 'status', operator: 'equals', value: 'active' },
      { field: 'age', operator: 'gte', value: '18' },
      { field: 'id', operator: 'in', value: ['1', '2', '3'] },
    ]);
  });

  it('parses array filter values as IN', () => {
    const input = parseFilterRequest({ filter: { id: ['1', '2'] } });
    expect(input.filters).toEqual([{ field: 'id', operator: 'in', value: ['1', '2'] }]);
  });

  it('parses sort with direction prefixes', () => {
    const input = parseFilterRequest({ sort: '-createdAt,name' });
    expect(input.sort).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
  });

  it('parses flat and nested pagination + search', () => {
    expect(parseFilterRequest({ page: '2', size: '10', search: 'foo' })).toEqual({
      page: 2,
      size: 10,
      search: 'foo',
    });
    expect(parseFilterRequest({ page: { number: '3', size: '20' } })).toEqual({
      page: 3,
      size: 20,
    });
  });

  it('parses distinct from a comma string and an array, de-duping', () => {
    expect(parseFilterRequest({ distinct: 'afsc,base' }).distinct).toEqual(['afsc', 'base']);
    expect(parseFilterRequest({ distinct: ['afsc', 'base', 'afsc'] }).distinct).toEqual([
      'afsc',
      'base',
    ]);
    // No distinct key → the field is absent (not an empty array).
    expect(parseFilterRequest({}).distinct).toBeUndefined();
  });

  it('returns an empty input for an empty query', () => {
    expect(parseFilterRequest({})).toEqual({});
  });
});

describe('parseDistinct', () => {
  it('splits a comma string, trims, drops empties and dups', () => {
    expect(parseDistinct(' a , b ,a, ,c')).toEqual(['a', 'b', 'c']);
  });
  it('filters non-strings out of an array', () => {
    expect(parseDistinct(['a', 2, null, 'b'])).toEqual(['a', 'b']);
  });
  it('returns [] for nullish/non-string scalars', () => {
    expect(parseDistinct(undefined)).toEqual([]);
    expect(parseDistinct(42)).toEqual([]);
  });
});

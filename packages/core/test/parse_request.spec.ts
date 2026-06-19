import { describe, expect, it } from 'vitest';
import { parseFilterRequest } from '../src/parse_request.js';

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

  it('returns an empty input for an empty query', () => {
    expect(parseFilterRequest({})).toEqual({});
  });
});

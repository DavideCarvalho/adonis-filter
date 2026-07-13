import { describe, expect, it } from 'vitest';
import { resolveInputFromRequest } from '../src/source_resolver.js';

function makeReq(
  method: string,
  query: Record<string, unknown> = {},
  body: Record<string, unknown> = {},
) {
  return { method, query, body };
}

describe('resolveInputFromRequest', () => {
  it('auto: GET uses query only', () => {
    expect(resolveInputFromRequest(makeReq('GET', { a: 1 }, { b: 2 }), 'auto')).toEqual({ a: 1 });
  });

  it('auto: HEAD uses query only', () => {
    expect(resolveInputFromRequest(makeReq('HEAD', { a: 1 }, { b: 2 }), 'auto')).toEqual({ a: 1 });
  });

  it('auto: POST merges query and body; body wins on conflict', () => {
    const r = makeReq('POST', { a: 1, b: 2 }, { b: 99, c: 3 });
    expect(resolveInputFromRequest(r, 'auto')).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('auto: PUT/PATCH/DELETE merge with body winning', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const r = makeReq(method, { a: 1 }, { a: 2 });
      expect(resolveInputFromRequest(r, 'auto')).toEqual({ a: 2 });
    }
  });

  it("explicit 'query' always reads only query", () => {
    expect(resolveInputFromRequest(makeReq('POST', { a: 1 }, { b: 2 }), 'query')).toEqual({ a: 1 });
  });

  it("explicit 'body' always reads only body", () => {
    expect(resolveInputFromRequest(makeReq('GET', { a: 1 }, { b: 2 }), 'body')).toEqual({ b: 2 });
  });

  it('custom extractor function is called with the req', () => {
    const r = makeReq('POST', {}, { filters: { nested: true } });
    const out = resolveInputFromRequest(
      r,
      (req) => (req as typeof r).body.filters as Record<string, unknown>,
    );
    expect(out).toEqual({ nested: true });
  });

  it('returns {} when query/body missing', () => {
    expect(resolveInputFromRequest({ method: 'POST' } as unknown, 'auto')).toEqual({});
  });

  it('dot-path resolves nested object from request', () => {
    const r = { body: { filters: { name: 'foo', age: 25 } } };
    expect(resolveInputFromRequest(r, 'body.filters')).toEqual({ name: 'foo', age: 25 });
  });

  it('dot-path resolves deeply nested paths', () => {
    const r = { body: { data: { nested: { filters: { x: 1 } } } } };
    expect(resolveInputFromRequest(r, 'body.data.nested.filters')).toEqual({ x: 1 });
  });

  it('dot-path returns {} when path/segment is missing or not an object', () => {
    expect(resolveInputFromRequest({ body: { other: 1 } }, 'body.filters')).toEqual({});
    expect(resolveInputFromRequest({ body: null }, 'body.filters')).toEqual({});
    expect(resolveInputFromRequest({ body: { filters: 'not-an-object' } }, 'body.filters')).toEqual(
      {},
    );
  });
});

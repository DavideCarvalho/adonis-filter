import { describe, expect, it } from 'vitest';
import { applyFilterFromRequest } from '../src/apply_from_request.js';
import { defineFilter } from '../src/filter_spec.js';
import { applyColumnFilters, applyVectorSimilarity } from '../src/lucid_adapter.js';
import { applyFilter } from '../src/runner.js';
import { MockQueryBuilder } from './mock_query_builder.js';

describe('lucid adapter — applyVectorSimilarity', () => {
  it('orders nearest-first with the cosine operator by default (embedding as a binding)', () => {
    const qb = new MockQueryBuilder();
    applyVectorSimilarity(qb, { column: 'embedding', vector: [0.1, 0.2, 0.3] });

    const order = qb.find('orderByRaw');
    expect(order?.args[0]).toBe('"embedding" <=> ?::vector asc');
    // The query embedding travels as a positional binding (never interpolated).
    expect(order?.args[1]).toEqual(['[0.1,0.2,0.3]']);
    // No threshold and no topK → no whereRaw / limit.
    expect(qb.find('whereRaw')).toBeUndefined();
    expect(qb.find('limit')).toBeUndefined();
  });

  it('selects the L2 operator for metric "l2"', () => {
    const qb = new MockQueryBuilder();
    applyVectorSimilarity(qb, { column: 'embedding', vector: [1, 2], metric: 'l2' });
    expect(qb.find('orderByRaw')?.args[0]).toBe('"embedding" <-> ?::vector asc');
  });

  it('selects the inner-product operator for metric "innerProduct"', () => {
    const qb = new MockQueryBuilder();
    applyVectorSimilarity(qb, { column: 'embedding', vector: [1, 2], metric: 'innerProduct' });
    expect(qb.find('orderByRaw')?.args[0]).toBe('"embedding" <#> ?::vector asc');
  });

  it('applies a threshold as a max-distance whereRaw with two bindings', () => {
    const qb = new MockQueryBuilder();
    applyVectorSimilarity(qb, { column: 'embedding', vector: [1, 2], threshold: 0.25 });
    const where = qb.find('whereRaw');
    expect(where?.args[0]).toBe('"embedding" <=> ?::vector < ?');
    expect(where?.args[1]).toEqual(['[1,2]', 0.25]);
  });

  it('applies topK as a LIMIT', () => {
    const qb = new MockQueryBuilder();
    applyVectorSimilarity(qb, { column: 'embedding', vector: [1, 2], topK: 5 });
    expect(qb.find('limit')?.args).toEqual([5]);
  });

  it('order:false applies only the threshold filter, no ordering', () => {
    const qb = new MockQueryBuilder();
    applyVectorSimilarity(qb, { column: 'embedding', vector: [1, 2], threshold: 0.5, order: false });
    expect(qb.find('whereRaw')).toBeDefined();
    expect(qb.find('orderByRaw')).toBeUndefined();
  });

  it('quotes a table-qualified column per segment', () => {
    const qb = new MockQueryBuilder();
    applyVectorSimilarity(qb, { column: 'docs.embedding', vector: [1] });
    expect(qb.find('orderByRaw')?.args[0]).toBe('"docs"."embedding" <=> ?::vector asc');
  });

  it('is a no-op for an empty embedding', () => {
    const qb = new MockQueryBuilder();
    applyVectorSimilarity(qb, { column: 'embedding', vector: [] });
    expect(qb.flatten()).toEqual([]);
  });

  it('rejects an unsafe column name', () => {
    const qb = new MockQueryBuilder();
    expect(() =>
      applyVectorSimilarity(qb, { column: 'embedding; DROP TABLE users', vector: [1] }),
    ).toThrow(/Invalid vector column/);
  });

  it('rejects a non-finite embedding component', () => {
    const qb = new MockQueryBuilder();
    expect(() => applyVectorSimilarity(qb, { column: 'embedding', vector: [1, Number.NaN] })).toThrow(
      /finite numbers/,
    );
  });
});

describe('runner — vector search integration', () => {
  it('ranks by vector distance when the policy declares a column and the input carries an embedding', () => {
    const qb = new MockQueryBuilder();
    applyFilter(
      qb,
      {
        filters: [{ field: 'status', operator: 'equals', value: 'published' }],
        vectorSimilarity: [1, 2, 3],
      },
      { allowed: ['status'], vectorSimilarity: { column: 'embedding', topK: 10 } },
    );

    // Normal filter still applied unchanged.
    expect(qb.flatten()).toContainEqual({ method: 'where', args: ['status', 'published'] });
    // Vector ordering + top-K applied.
    expect(qb.find('orderByRaw')?.args[0]).toBe('"embedding" <=> ?::vector asc');
    expect(qb.find('limit')?.args).toEqual([10]);
  });

  it('does not apply vector search when the request carries no embedding', () => {
    const qb = new MockQueryBuilder();
    applyFilter(qb, { filters: [] }, { allowed: '*', vectorSimilarity: { column: 'embedding' } });
    expect(qb.find('orderByRaw')).toBeUndefined();
  });

  it('does not apply vector search when the policy declares no vector column', () => {
    const qb = new MockQueryBuilder();
    applyFilter(qb, { vectorSimilarity: [1, 2, 3] }, { allowed: '*' });
    expect(qb.find('orderByRaw')).toBeUndefined();
  });

  it('vector distance is the primary ordering, allowed sort a tiebreaker', () => {
    const qb = new MockQueryBuilder();
    applyFilter(
      qb,
      { vectorSimilarity: [1, 2], sort: [{ field: 'createdAt', direction: 'desc' }] },
      { allowed: ['createdAt'], vectorSimilarity: { column: 'embedding' } },
    );
    const orders = qb.flatten().filter((c) => c.method === 'orderByRaw' || c.method === 'orderBy');
    expect(orders[0]?.method).toBe('orderByRaw');
    expect(orders[1]).toEqual({ method: 'orderBy', args: ['createdAt', 'desc'] });
  });
});

describe('defineFilter / applyFilterFromRequest — vector search', () => {
  it('projects the spec vector config and injects the embedding from options', () => {
    const spec = defineFilter({
      filterable: ['status'],
      vectorSimilarity: { column: 'embedding', metric: 'l2', threshold: 0.3, topK: 8 },
    });
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, undefined, {
      input: { filters: [] },
      vectorSimilarity: [0.5, 0.6],
    });

    expect(qb.find('whereRaw')?.args).toEqual(['"embedding" <-> ?::vector < ?', ['[0.5,0.6]', 0.3]]);
    expect(qb.find('orderByRaw')?.args[0]).toBe('"embedding" <-> ?::vector asc');
    expect(qb.find('limit')?.args).toEqual([8]);
  });

  it('leaves a non-vector spec untouched when no embedding is supplied', () => {
    const spec = defineFilter({ filterable: ['status'] });
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, undefined, { input: { filters: [] } });
    expect(qb.find('orderByRaw')).toBeUndefined();
    expect(qb.find('whereRaw')).toBeUndefined();
  });

  it('combines a vector search with a normal allow-listed filter from the spec', () => {
    const spec = defineFilter({
      filterable: ['status'],
      vectorSimilarity: { column: 'embedding' },
    });
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, undefined, {
      input: { filters: [{ field: 'status', operator: 'equals', value: 'active' }] },
      vectorSimilarity: [9, 9],
    });
    // Structured filter preserved.
    expect(qb.flatten()).toContainEqual({ method: 'where', args: ['status', 'active'] });
    // Vector ranking applied alongside it.
    expect(qb.find('orderByRaw')?.args[0]).toBe('"embedding" <=> ?::vector asc');
  });
});

// Sanity: the raw seam is co-usable with the existing structured helpers on the
// same mock, proving the package stays framework-free and fully mockable.
describe('raw seam is mockable alongside structured filters', () => {
  it('records whereRaw/orderByRaw next to where translations', () => {
    const qb = new MockQueryBuilder();
    applyColumnFilters(qb, [{ field: 'name', operator: 'equals', value: 'Al' }]);
    applyVectorSimilarity(qb, { column: 'embedding', vector: [1], threshold: 0.1 });
    const methods = qb.flatten().map((c) => c.method);
    expect(methods).toContain('where');
    expect(methods).toContain('whereRaw');
    expect(methods).toContain('orderByRaw');
  });
});

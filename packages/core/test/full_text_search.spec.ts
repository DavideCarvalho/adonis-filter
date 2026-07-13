import { describe, expect, it } from 'vitest';
import { applyFilterFromRequest } from '../src/apply_from_request.js';
import { defineFilter } from '../src/filter_spec.js';
import { applyColumnFilters, applyFullTextSearch } from '../src/lucid_adapter.js';
import { applyFilter } from '../src/runner.js';
import { MockQueryBuilder } from './mock_query_builder.js';

describe('lucid adapter — applyFullTextSearch', () => {
  it('matches a tsvector column with websearch_to_tsquery, query as a binding (never in SQL)', () => {
    const qb = new MockQueryBuilder();
    applyFullTextSearch(qb, { query: 'foo bar', column: 'search_vector' });

    const where = qb.find('whereRaw');
    expect(where?.args[0]).toBe(`"search_vector" @@ websearch_to_tsquery('english', ?)`);
    // The user query travels as a positional binding, never spliced into SQL.
    expect(where?.args[1]).toEqual(['foo bar']);
    expect(String(where?.args[0])).not.toContain('foo bar');
    // Match-only by default → no ordering.
    expect(qb.find('orderByRaw')).toBeUndefined();
  });

  it('adds a ts_rank DESC ordering when rank is set (query still a binding)', () => {
    const qb = new MockQueryBuilder();
    applyFullTextSearch(qb, { query: 'quick brown fox', column: 'search_vector', rank: true });

    const where = qb.find('whereRaw');
    expect(where?.args[0]).toBe(`"search_vector" @@ websearch_to_tsquery('english', ?)`);
    expect(where?.args[1]).toEqual(['quick brown fox']);

    const order = qb.find('orderByRaw');
    expect(order?.args[0]).toBe(
      `ts_rank("search_vector", websearch_to_tsquery('english', ?)) desc`,
    );
    expect(order?.args[1]).toEqual(['quick brown fox']);
    expect(String(order?.args[0])).not.toContain('quick brown fox');
  });

  it('honors a configurable language for both the tsquery and to_tsvector', () => {
    const qb = new MockQueryBuilder();
    applyFullTextSearch(qb, {
      query: 'olá mundo',
      column: 'body',
      language: 'portuguese',
      columnKind: 'text',
      rank: true,
    });
    expect(qb.find('whereRaw')?.args[0]).toBe(
      `to_tsvector('portuguese', coalesce("body", '')) @@ websearch_to_tsquery('portuguese', ?)`,
    );
    expect(qb.find('orderByRaw')?.args[0]).toBe(
      `ts_rank(to_tsvector('portuguese', coalesce("body", '')), websearch_to_tsquery('portuguese', ?)) desc`,
    );
  });

  it('wraps multiple text columns into a to_tsvector document (coalesced, space-joined)', () => {
    const qb = new MockQueryBuilder();
    applyFullTextSearch(qb, { query: 'hello', column: ['title', 'body'] });
    expect(qb.find('whereRaw')?.args[0]).toBe(
      `to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", '')) @@ websearch_to_tsquery('english', ?)`,
    );
  });

  it('treats an explicit single text column via columnKind: text', () => {
    const qb = new MockQueryBuilder();
    applyFullTextSearch(qb, { query: 'hi', column: 'body', columnKind: 'text' });
    expect(qb.find('whereRaw')?.args[0]).toBe(
      `to_tsvector('english', coalesce("body", '')) @@ websearch_to_tsquery('english', ?)`,
    );
  });

  it('quotes a table-qualified column per segment', () => {
    const qb = new MockQueryBuilder();
    applyFullTextSearch(qb, { query: 'x', column: 'docs.search_vector' });
    expect(qb.find('whereRaw')?.args[0]).toBe(
      `"docs"."search_vector" @@ websearch_to_tsquery('english', ?)`,
    );
  });

  it('is a no-op for a blank query', () => {
    const qb = new MockQueryBuilder();
    applyFullTextSearch(qb, { query: '   ', column: 'search_vector' });
    expect(qb.flatten()).toEqual([]);
  });

  it('rejects an unsafe column name', () => {
    const qb = new MockQueryBuilder();
    expect(() =>
      applyFullTextSearch(qb, { query: 'x', column: 'search_vector; DROP TABLE users' }),
    ).toThrow(/Invalid full-text search column/);
  });

  it('rejects an unsafe language config', () => {
    const qb = new MockQueryBuilder();
    expect(() =>
      applyFullTextSearch(qb, { query: 'x', column: 'search_vector', language: "english'); --" }),
    ).toThrow(/Invalid full-text search language/);
  });
});

describe('runner — full-text search integration', () => {
  it('routes the request search string through tsvector FTS when fullText is configured', () => {
    const qb = new MockQueryBuilder();
    applyFilter(
      qb,
      { search: 'graph databases', filters: [{ field: 'status', operator: 'equals', value: 'live' }] },
      { allowed: ['status'], fullText: { column: 'search_vector', rank: true } },
    );

    // Normal filter still applied unchanged.
    expect(qb.flatten()).toContainEqual({ method: 'where', args: ['status', 'live'] });
    // FTS match + rank applied; query is a binding.
    const where = qb.find('whereRaw');
    expect(where?.args[0]).toBe(`"search_vector" @@ websearch_to_tsquery('english', ?)`);
    expect(where?.args[1]).toEqual(['graph databases']);
    expect(qb.find('orderByRaw')?.args[0]).toBe(
      `ts_rank("search_vector", websearch_to_tsquery('english', ?)) desc`,
    );
    // No ILIKE fallback ran.
    expect(qb.find('whereILike')).toBeUndefined();
    expect(qb.find('orWhereILike')).toBeUndefined();
  });

  it('falls back to ILIKE applySearch when no fullText config is declared', () => {
    const qb = new MockQueryBuilder();
    applyFilter(qb, { search: 'foo' }, { allowed: '*', searchable: ['name'] });
    expect(qb.find('orWhereILike')).toBeDefined();
    expect(qb.find('whereRaw')).toBeUndefined();
  });

  it('does not run FTS for a blank search term', () => {
    const qb = new MockQueryBuilder();
    applyFilter(qb, { search: '   ' }, { allowed: '*', fullText: { column: 'search_vector' } });
    expect(qb.find('whereRaw')).toBeUndefined();
  });
});

describe('defineFilter / applyFilterFromRequest — full-text search', () => {
  it('projects the spec fullText config and searches the request query string', () => {
    const spec = defineFilter({
      filterable: ['status'],
      fullText: { column: 'search_vector', language: 'english', rank: true },
    });
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, undefined, {
      input: { search: 'full text', filters: [] },
    });

    const where = qb.find('whereRaw');
    expect(where?.args[0]).toBe(`"search_vector" @@ websearch_to_tsquery('english', ?)`);
    expect(where?.args[1]).toEqual(['full text']);
    expect(qb.find('orderByRaw')?.args[0]).toBe(
      `ts_rank("search_vector", websearch_to_tsquery('english', ?)) desc`,
    );
  });

  it('combines FTS with a normal allow-listed filter from the spec', () => {
    const spec = defineFilter({
      filterable: ['status'],
      fullText: { column: ['title', 'body'] },
    });
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, undefined, {
      input: {
        search: 'needle',
        filters: [{ field: 'status', operator: 'equals', value: 'active' }],
      },
    });
    expect(qb.flatten()).toContainEqual({ method: 'where', args: ['status', 'active'] });
    expect(qb.find('whereRaw')?.args[0]).toBe(
      `to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", '')) @@ websearch_to_tsquery('english', ?)`,
    );
  });

  it('a spec with only searchable (no fullText) still uses ILIKE search', () => {
    const spec = defineFilter({ filterable: ['name'], searchable: ['name'] });
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, undefined, { input: { search: 'al' } });
    expect(qb.find('orWhereILike')).toBeDefined();
    expect(qb.find('whereRaw')).toBeUndefined();
  });
});

// Sanity: the raw FTS seam co-exists with structured helpers on the same mock.
describe('full-text raw seam is mockable alongside structured filters', () => {
  it('records whereRaw/orderByRaw next to where translations', () => {
    const qb = new MockQueryBuilder();
    applyColumnFilters(qb, [{ field: 'name', operator: 'equals', value: 'Al' }]);
    applyFullTextSearch(qb, { query: 'hi', column: 'search_vector', rank: true });
    const methods = qb.flatten().map((c) => c.method);
    expect(methods).toContain('where');
    expect(methods).toContain('whereRaw');
    expect(methods).toContain('orderByRaw');
  });
});

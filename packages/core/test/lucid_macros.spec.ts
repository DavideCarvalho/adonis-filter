import { HttpContext } from '@adonisjs/core/http';
import { describe, expect, it, vi } from 'vitest';
import type { FilterRequestContext } from '../src/apply_from_request.js';
import { defineFilter } from '../src/filter_spec.js';
import { registerFilterMacros } from '../src/lucid_macros.js';
import type { FilterInput } from '../src/types.js';
import { MockQueryBuilder } from './mock_query_builder.js';

/**
 * A stand-in for Lucid's `ModelQueryBuilder`: the static `.macro(name, fn)`
 * (Adonis' Macroable) defines `fn` on the prototype so instances gain the
 * method, and instances record filter calls via {@link MockQueryBuilder} and a
 * spy `paginate`. This lets us prove `registerFilterMacros` wires the chainable
 * macros to `applyFilterFromRequest` without booting a real AdonisJS app.
 */
class FakeModelQueryBuilder extends MockQueryBuilder {
  paginateArgs: [number, number] | null = null;

  static macro(name: string, fn: (this: unknown, ...args: never[]) => unknown): void {
    (FakeModelQueryBuilder.prototype as Record<string, unknown>)[name] = fn;
  }

  paginate(page: number, perPage: number): { page: number; perPage: number } {
    this.paginateArgs = [page, perPage];
    return { page, perPage };
  }
}

registerFilterMacros(FakeModelQueryBuilder);

type FilterableQuery = FakeModelQueryBuilder & {
  applyFilterFromRequest(spec: unknown, ctx: unknown, options?: unknown): FilterableQuery;
  filterPaginate(spec: unknown, ctx: unknown, options?: unknown): { page: number; perPage: number };
};

const spec = defineFilter({ filterable: ['name'] });
const input: FilterInput = {
  filters: [
    { field: 'name', operator: 'equals', value: 'Al' },
    { field: 'secret', operator: 'equals', value: 'x' },
  ],
  page: 2,
  size: 10,
};

describe('registerFilterMacros', () => {
  it('applyFilterFromRequest applies the allow-listed filter and returns the query for chaining', () => {
    const query = new FakeModelQueryBuilder() as FilterableQuery;
    const returned = query.applyFilterFromRequest(spec, {}, { input });

    expect(returned).toBe(query);
    const flat = query.flatten();
    expect(flat).toContainEqual({ method: 'where', args: ['name', 'Al'] });
    // The disallowed field is dropped by the spec's allow-list.
    expect(flat.find((c) => c.args.includes('secret'))).toBeUndefined();
  });

  it('filterPaginate applies the filter and paginates with the resolved page/size', () => {
    const query = new FakeModelQueryBuilder() as FilterableQuery;
    const result = query.filterPaginate(spec, {}, { input });

    expect(query.paginateArgs).toEqual([2, 10]);
    expect(result).toEqual({ page: 2, perPage: 10 });
    expect(query.flatten()).toContainEqual({ method: 'where', args: ['name', 'Al'] });
  });

  it('sem ctx cai no HttpContext ativo (getOrFail) em vez de exigir o ctx explícito', () => {
    const fakeCtx: FilterRequestContext = {};
    const spy = vi
      .spyOn(HttpContext, 'getOrFail')
      .mockReturnValue(fakeCtx as unknown as HttpContext);
    try {
      const query = new FakeModelQueryBuilder() as FilterableQuery;
      const returned = query.applyFilterFromRequest(spec, undefined, { input });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(returned).toBe(query);
      expect(query.flatten()).toContainEqual({ method: 'where', args: ['name', 'Al'] });
    } finally {
      spy.mockRestore();
    }
  });
});

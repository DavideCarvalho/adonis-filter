import { describe, expect, it } from 'vitest';
import { applyFilterFromRequest } from '../src/apply_from_request.js';
import { defineFilter } from '../src/filter_spec.js';
import { MockQueryBuilder } from './mock_query_builder.js';

/**
 * The colocated `filterable` form: field name and its type in ONE place.
 *
 * The array form forces every non-string field to be written twice — once in `filterable`, once in
 * `fieldTypes` — which is pure ceremony for a list that is usually short. The map form declares
 * both at once and desugars to exactly the same spec.
 */
function ctx(qs: Record<string, unknown>) {
  return { request: { qs: () => qs } };
}

describe('filterable as a colocated map', () => {
  const mapped = defineFilter({
    filterable: { advisorId: 'string', dayOfWeek: 'number', isRecurring: 'boolean' },
  });

  it('the keys become the allow-list', () => {
    expect(mapped.isFilterable('dayOfWeek')).toBe(true);
    expect(mapped.isFilterable('advisorId')).toBe(true);
    expect(mapped.isFilterable('secretColumn')).toBe(false);
  });

  it('the values become fieldTypes — no second declaration', () => {
    expect(mapped.fieldTypes).toEqual({
      advisorId: { kind: 'string' },
      dayOfWeek: { kind: 'number' },
      isRecurring: { kind: 'boolean' },
    });
  });

  it('coercion works exactly as with the array + fieldTypes form', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, mapped, ctx({ filter: { dayOfWeek: { equals: '3' } } }));
    expect(qb.find('where')?.args).toEqual(['dayOfWeek', 3]);
  });

  it('an uncoercible value is still dropped', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, mapped, ctx({ filter: { isRecurring: { equals: 'xyz' } } }));
    expect(qb.flatten().flatMap((c) => c.args)).not.toContain('isRecurring');
  });

  it('sortable defaults to the map keys, exactly like the array form', () => {
    expect(mapped.isSortable('dayOfWeek')).toBe(true);
    expect(mapped.isSortable('secretColumn')).toBe(false);
  });

  it('desugars to the same spec the array + fieldTypes form produces', () => {
    const arrayForm = defineFilter({
      filterable: ['advisorId', 'dayOfWeek', 'isRecurring'],
      fieldTypes: {
        advisorId: { kind: 'string' },
        dayOfWeek: { kind: 'number' },
        isRecurring: { kind: 'boolean' },
      },
    });
    expect(mapped.filterable).toEqual(arrayForm.filterable);
    expect(mapped.fieldTypes).toEqual(arrayForm.fieldTypes);
  });

  it('an explicit fieldTypes entry still wins (richer codegen info)', () => {
    const spec = defineFilter({
      filterable: { status: 'string' },
      fieldTypes: { status: { kind: 'string', enumValues: ['A', 'B'] } },
    });
    expect(spec.fieldTypes?.status).toEqual({ kind: 'string', enumValues: ['A', 'B'] });
  });

  it('an explicit sortable still overrides the map keys', () => {
    const spec = defineFilter({
      filterable: { a: 'string', b: 'number' },
      sortable: ['a'],
    });
    expect(spec.isSortable('a')).toBe(true);
    expect(spec.isSortable('b')).toBe(false);
  });

  it('the array form is untouched (backwards compatible)', () => {
    const spec = defineFilter({ filterable: ['a', 'b'] });
    expect(spec.filterable).toEqual(['a', 'b']);
    expect(spec.fieldTypes).toBeUndefined();
    expect(spec.isFilterable('a')).toBe(true);
  });

  it("'*' is untouched", () => {
    const spec = defineFilter({ filterable: '*' });
    expect(spec.filterable).toBe('*');
    expect(spec.isFilterable('anything')).toBe(true);
  });
});

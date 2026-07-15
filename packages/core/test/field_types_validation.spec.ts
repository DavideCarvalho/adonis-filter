import { describe, expect, it } from 'vitest';
import { applyFilterFromRequest } from '../src/apply_from_request.js';
import { defineFilter } from '../src/filter_spec.js';
import { InvalidColumnFilterError } from '../src/runner.js';
import { MockQueryBuilder } from './mock_query_builder.js';

/**
 * Server-side value validation driven by `fieldTypes`.
 *
 * The bug this closes, verified against a real Postgres 17: a query-string filter value is always
 * a string, and Postgres implicitly casts the benign cases (`is_recurring = 'false'` works fine),
 * so nothing looks wrong until a client sends something uncastable — `is_recurring = 'xyz'` raises
 * `invalid input syntax for type boolean` AT THE DATABASE, i.e. a 500 on a public endpoint caused
 * by user input. The allow-list guarded which FIELD could be filtered; nothing guarded the VALUE.
 */
const spec = defineFilter({
  filterable: ['dayOfWeek', 'isRecurring', 'name', 'createdAt'],
  fieldTypes: {
    dayOfWeek: { kind: 'number' },
    isRecurring: { kind: 'boolean' },
    createdAt: { kind: 'date' },
    // `name` deliberately undeclared -> stays uncoerced (backwards compatible).
  },
});

const strictSpec = defineFilter({
  filterable: ['dayOfWeek', 'isRecurring'],
  fieldTypes: { dayOfWeek: { kind: 'number' }, isRecurring: { kind: 'boolean' } },
  throwOnInvalid: true,
});

function ctx(qs: Record<string, unknown>) {
  return { request: { qs: () => qs } };
}

/**
 * Every argument this query builder ever saw, INCLUDING inside group callbacks.
 *
 * `applyColumnFilters` wraps filters in `where((qb) => ...)`, which the mock records at the top
 * level as the opaque marker `['<group>']` while the real calls go to a child recorder. Reading
 * only `qb.calls` therefore never sees a field name, and a "field must not appear" assertion
 * passes no matter what — so this flattens through children, the same way the mock's own `find`
 * does.
 */
function touchedArgs(qb: MockQueryBuilder): unknown[] {
  return qb.flatten().flatMap((c) => c.args);
}

describe('fieldTypes: server-side value validation', () => {
  it('coerces a numeric string to a real number', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, ctx({ filter: { dayOfWeek: { equals: '3' } } }));
    expect(qb.find('where')?.args).toEqual(['dayOfWeek', 3]);
  });

  it('coerces boolean spellings', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, ctx({ filter: { isRecurring: { equals: 'false' } } }));
    expect(qb.find('where')?.args).toEqual(['isRecurring', false]);
  });

  it('DROPS an uncoercible boolean by default (never reaches the column)', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, ctx({ filter: { isRecurring: { equals: 'xyz' } } }));
    expect(touchedArgs(qb)).not.toContain('isRecurring');
  });

  it('DROPS an uncoercible number', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, ctx({ filter: { dayOfWeek: { equals: 'abc' } } }));
    expect(touchedArgs(qb)).not.toContain('dayOfWeek');
  });

  it('THROWS on an uncoercible value under throwOnInvalid (-> 400, not 500)', () => {
    const qb = new MockQueryBuilder();
    expect(() =>
      applyFilterFromRequest(qb, strictSpec, ctx({ filter: { isRecurring: { equals: 'xyz' } } })),
    ).toThrow(InvalidColumnFilterError);
  });

  it('leaves an UNDECLARED field uncoerced (backwards compatible)', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, ctx({ filter: { name: { equals: '42' } } }));
    // Still the string '42' — no fieldTypes entry means no opinion.
    expect(qb.find('where')?.args).toEqual(['name', '42']);
  });

  it('coerces every element of an array-valued operator (in)', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, ctx({ filter: { dayOfWeek: { in: ['1', '2'] } } }));
    expect(qb.find('whereIn')?.args).toEqual(['dayOfWeek', [1, 2]]);
  });

  it('drops an array-valued operator when ANY element is uncoercible', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, ctx({ filter: { dayOfWeek: { in: ['1', 'abc'] } } }));
    expect(touchedArgs(qb)).not.toContain('dayOfWeek');
  });

  it('does NOT coerce string-matching operators to the column kind (LIKE patterns stay strings)', () => {
    const qb = new MockQueryBuilder();
    applyFilterFromRequest(qb, spec, ctx({ filter: { dayOfWeek: { contains: '3' } } }));
    // `contains` is a LIKE pattern; coercing it to the number 3 would break the pattern.
    expect(qb.find('whereILike')?.args).toEqual(['dayOfWeek', '%3%']);
  });

  it('rejects an unparseable date but accepts an ISO one', () => {
    const ok = new MockQueryBuilder();
    applyFilterFromRequest(ok, spec, ctx({ filter: { createdAt: { gte: '2026-07-15' } } }));
    expect(ok.find('where')?.args).toEqual(['createdAt', '>=', '2026-07-15']);

    const bad = new MockQueryBuilder();
    applyFilterFromRequest(bad, spec, ctx({ filter: { createdAt: { gte: 'not-a-date' } } }));
    expect(touchedArgs(bad)).not.toContain('createdAt');
  });
});

describe('fieldTypes: one declaration feeds the codegen too', () => {
  it("the generated client inherits the spec's fieldTypes without repeating them in the manifest", async () => {
    const { generateFilterClient } = await import('../src/generate_client.js');
    const out = generateFilterClient(spec, { name: 'availability' });
    // Declared on the spec only — no `fieldTypes` passed to the generator.
    expect(out).toContain('"dayOfWeek": number');
    expect(out).toContain('"isRecurring": boolean');
  });

  it('an explicit manifest fieldTypes still overrides the spec (codegen-only richness)', async () => {
    const { generateFilterClient } = await import('../src/generate_client.js');
    const out = generateFilterClient(spec, {
      name: 'availability',
      fieldTypes: { dayOfWeek: { enumValues: [1, 2, 3] } },
    });
    expect(out).toContain('1 | 2 | 3');
  });
});

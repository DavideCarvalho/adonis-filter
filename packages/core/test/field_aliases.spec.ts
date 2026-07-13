import { describe, expect, it } from 'vitest';
import { remapFilterAliases, remapSortAliases, resolveFieldAlias } from '../src/field_aliases.js';
import type { ColumnFilter } from '../src/operators.js';
import { applyFilter } from '../src/runner.js';
import { MockQueryBuilder } from './mock_query_builder.js';

describe('resolveFieldAlias (unit)', () => {
  it('returns the field unchanged when aliases are undefined', () => {
    expect(resolveFieldAlias(undefined, 'name')).toBe('name');
  });

  it('returns the field unchanged when the map has no such key', () => {
    expect(resolveFieldAlias({ baseId: 'base' }, 'otherField')).toBe('otherField');
  });

  it('resolves a declared alias to its target', () => {
    expect(resolveFieldAlias({ baseId: 'base' }, 'baseId')).toBe('base');
  });

  it('resolves a relation-path / JSON sub-path target', () => {
    expect(resolveFieldAlias({ tierAlias: 'metadata.tier' }, 'tierAlias')).toBe('metadata.tier');
  });

  it('never treats prototype-pollution-style keys as alias lookup keys', () => {
    const aliases = { legit: 'name' };
    for (const blocked of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']) {
      expect(resolveFieldAlias(aliases, blocked)).toBe(blocked);
    }
  });

  it('does not cascade: A → B where B is also an alias key resolves to B', () => {
    expect(resolveFieldAlias({ a: 'b', b: 'c' }, 'a')).toBe('b');
  });
});

describe('remapFilterAliases', () => {
  it('resolves the field and every AND/OR child field', () => {
    const filter: ColumnFilter = {
      field: '',
      operator: 'equals',
      AND: [
        { field: 'baseId', operator: 'equals', value: 'b1' },
        { field: 'tierAlias', operator: 'equals', value: 'gold' },
      ],
    };
    expect(remapFilterAliases(filter, { baseId: 'base', tierAlias: 'metadata.tier' })).toEqual({
      field: '',
      operator: 'equals',
      AND: [
        { field: 'base', operator: 'equals', value: 'b1' },
        { field: 'metadata.tier', operator: 'equals', value: 'gold' },
      ],
    });
  });
});

describe('remapSortAliases', () => {
  it('resolves each sort field', () => {
    expect(
      remapSortAliases([{ field: 'legacyStatus', direction: 'desc' }], { legacyStatus: 'status' }),
    ).toEqual([{ field: 'status', direction: 'desc' }]);
  });
});

describe('applyFilter honors config.aliases', () => {
  it('resolves a where-column alias BEFORE allow-listing, then applies the target', () => {
    const qb = new MockQueryBuilder();
    applyFilter(
      qb,
      { filters: [{ field: 'baseId', operator: 'equals', value: 'b1' }] },
      { allowed: ['base'], aliases: { baseId: 'base' } },
    );
    expect(qb.flatten()).toContainEqual({ method: 'where', args: ['base', 'b1'] });
  });

  it('an alias to an allow-listed target passes even though the alias key is not allow-listed', () => {
    const qb = new MockQueryBuilder();
    const resolved = applyFilter(
      qb,
      { sort: [{ field: 'legacyStatus', direction: 'asc' }] },
      { allowed: ['status'], aliases: { legacyStatus: 'status' } },
    );
    expect(qb.flatten()).toContainEqual({ method: 'orderBy', args: ['status', 'asc'] });
    expect(resolved.page).toBe(1);
  });

  it('drops an aliased sort whose resolved target is not sortable', () => {
    const qb = new MockQueryBuilder();
    applyFilter(
      qb,
      { sort: [{ field: 'legacyCreated', direction: 'desc' }] },
      { allowed: ['name'], sortable: ['name'], aliases: { legacyCreated: 'createdAt' } },
    );
    expect(qb.flatten().filter((c) => c.method === 'orderBy')).toEqual([]);
  });
});

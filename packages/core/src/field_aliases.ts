import type { ColumnFilter } from './operators.js';
import type { SortItem } from './types.js';

/**
 * Field names that would resolve to inherited `Object.prototype` members
 * (`__proto__`, `constructor`, `prototype`, `toString`, `valueOf`) if looked up
 * on a plain-object `aliases` map without an own-property check. A
 * client-supplied field name is never trusted as an alias-map lookup key without
 * this guard, even though the `Object.hasOwn` check below already excludes
 * inherited properties; kept as explicit defense-in-depth.
 */
const BLOCKED_ALIAS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
]);

/** A declarative field-name remapping: client-facing alias → resolved target column. */
export type FieldAliases = Record<string, string>;

/**
 * Resolves a client-supplied field name to its declared `aliases` target, or
 * returns `field` unchanged when no alias applies.
 *
 * This is the single choke point for alias resolution — call it wherever a
 * client-supplied field name is about to be resolved against the entity (column
 * filters and sort). It must run FIRST, before any validation (allow-listing,
 * field-charset checks) — those all evaluate the resolved target, never the
 * alias key.
 *
 * Aliases do not cascade: the returned target is never re-run through the alias
 * map, even when it happens to also be a declared alias key itself — this is
 * what makes alias cycles structurally impossible.
 */
export function resolveFieldAlias(aliases: FieldAliases | undefined, field: string): string {
  if (!aliases || BLOCKED_ALIAS_KEYS.has(field) || !Object.hasOwn(aliases, field)) {
    return field;
  }
  return aliases[field] ?? field;
}

/**
 * Returns a copy of a {@link ColumnFilter} with its own field and every nested
 * AND/OR child field resolved through the alias map. Pure — the input tree is
 * left untouched.
 */
export function remapFilterAliases(filter: ColumnFilter, aliases: FieldAliases): ColumnFilter {
  const next: ColumnFilter = {
    field: resolveFieldAlias(aliases, filter.field),
    operator: filter.operator,
  };
  if (filter.value !== undefined) next.value = filter.value;
  if (filter.AND) next.AND = filter.AND.map((f) => remapFilterAliases(f, aliases));
  if (filter.OR) next.OR = filter.OR.map((f) => remapFilterAliases(f, aliases));
  return next;
}

/** Resolves every sort directive's field through the alias map (returns a new array). */
export function remapSortAliases(sorts: SortItem[], aliases: FieldAliases): SortItem[] {
  return sorts.map((sort) => ({
    field: resolveFieldAlias(aliases, sort.field),
    direction: sort.direction,
  }));
}

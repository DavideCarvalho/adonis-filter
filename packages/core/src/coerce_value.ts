import type { FilterFieldKind } from './types.js';

/** Outcome of coercing one filter value against its declared {@link FilterFieldKind}. */
export type CoerceResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Coerce a raw filter value to its declared column kind, or reject it.
 *
 * Why this exists: a filter value arriving over a query string is ALWAYS a string
 * (`?filter[dayOfWeek][equals]=3` yields `'3'`). Postgres papers over the benign cases with an
 * implicit cast — `day_of_week = '3'` and `is_recurring = 'false'` both work — so the gap is
 * invisible until a client sends something that ISN'T castable: `is_recurring = 'xyz'` raises
 * `invalid input syntax for type boolean` at the database, which surfaces as a 500 on a public
 * endpoint from pure user input. The allow-list guards which FIELD may be filtered; this guards
 * what VALUE may reach the column.
 *
 * Rejection is not an exception here: the caller maps it onto the spec's existing `throwOnInvalid`
 * semantics, so a bad value behaves exactly like a disallowed field — dropped by default, or a
 * loud `InvalidColumnFilterError` (→ 400) when the spec asks for it.
 */
export function coerceFilterValue(value: unknown, kind: FilterFieldKind): CoerceResult {
  // `null` is meaningful for every kind (`equals: null` is a legitimate IS NULL comparison) and
  // never triggers a cast error, so it short-circuits before any kind-specific parsing.
  if (value === null) return { ok: true, value: null };

  switch (kind) {
    case 'number': {
      if (typeof value === 'number') {
        return Number.isFinite(value)
          ? { ok: true, value }
          : { ok: false, reason: 'not a finite number' };
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Number('') === 0 and Number(' ') === 0 — both would silently become a valid 0, so an
        // empty string is rejected up front rather than coerced into a filter nobody asked for.
        if (trimmed === '') return { ok: false, reason: 'empty string is not a number' };
        const n = Number(trimmed);
        // Number('12abc') is NaN, which is what rejects partial garbage.
        return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: 'not a number' };
      }
      return { ok: false, reason: 'not a number' };
    }

    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (v === 'true' || v === '1') return { ok: true, value: true };
        if (v === 'false' || v === '0') return { ok: true, value: false };
        return { ok: false, reason: 'not a boolean' };
      }
      return { ok: false, reason: 'not a boolean' };
    }

    case 'date': {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime())
          ? { ok: false, reason: 'invalid date' }
          : { ok: true, value };
      }
      if (typeof value === 'string') {
        const t = Date.parse(value);
        // The string is handed back VERBATIM rather than as a Date: the driver already parses ISO
        // strings, and converting here would silently re-zone a date-only value ('2026-07-15'
        // becomes midnight UTC, which shifts the day for any negative-offset client). Date.parse is
        // used only to reject, never to rewrite.
        return Number.isNaN(t) ? { ok: false, reason: 'invalid date' } : { ok: true, value };
      }
      return { ok: false, reason: 'not a date' };
    }

    case 'string': {
      if (typeof value === 'string') return { ok: true, value };
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { ok: true, value: String(value) };
      }
      return { ok: false, reason: 'not a string' };
    }

    // No column-level contract to enforce — pass through untouched.
    default:
      return { ok: true, value };
  }
}

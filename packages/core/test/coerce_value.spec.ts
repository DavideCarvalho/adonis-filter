import { describe, expect, it } from 'vitest';
import { coerceFilterValue } from '../src/coerce_value.js';

describe('coerceFilterValue', () => {
  describe('number', () => {
    it('coerces a numeric string (query strings are ALWAYS strings)', () => {
      expect(coerceFilterValue('3', 'number')).toEqual({ ok: true, value: 3 });
      expect(coerceFilterValue('-2.5', 'number')).toEqual({ ok: true, value: -2.5 });
    });
    it('passes a real number through', () => {
      expect(coerceFilterValue(7, 'number')).toEqual({ ok: true, value: 7 });
    });
    it("REJECTS garbage — this is the whole point: Postgres would 500 on `day_of_week = 'abc'`", () => {
      expect(coerceFilterValue('abc', 'number').ok).toBe(false);
      expect(coerceFilterValue('', 'number').ok).toBe(false);
      expect(coerceFilterValue('12abc', 'number').ok).toBe(false);
      expect(coerceFilterValue(Number.NaN, 'number').ok).toBe(false);
      expect(coerceFilterValue(Number.POSITIVE_INFINITY, 'number').ok).toBe(false);
    });
  });

  describe('boolean', () => {
    it('coerces the usual truthy/falsy spellings', () => {
      for (const t of ['true', 'TRUE', '1', true]) {
        expect(coerceFilterValue(t, 'boolean')).toEqual({ ok: true, value: true });
      }
      for (const f of ['false', 'FALSE', '0', false]) {
        expect(coerceFilterValue(f, 'boolean')).toEqual({ ok: true, value: false });
      }
    });
    it("REJECTS garbage — Postgres 500s on `is_recurring = 'xyz'`", () => {
      expect(coerceFilterValue('xyz', 'boolean').ok).toBe(false);
      expect(coerceFilterValue('2', 'boolean').ok).toBe(false);
      expect(coerceFilterValue('', 'boolean').ok).toBe(false);
    });
  });

  describe('date', () => {
    it('accepts an ISO date/datetime and keeps it a string (Postgres parses it)', () => {
      expect(coerceFilterValue('2026-07-15', 'date')).toEqual({ ok: true, value: '2026-07-15' });
      const dt = '2026-07-15T12:00:00.000Z';
      expect(coerceFilterValue(dt, 'date')).toEqual({ ok: true, value: dt });
    });
    it('accepts a Date instance', () => {
      const d = new Date('2026-07-15T00:00:00.000Z');
      expect(coerceFilterValue(d, 'date')).toEqual({ ok: true, value: d });
    });
    it('REJECTS an unparseable date', () => {
      expect(coerceFilterValue('not-a-date', 'date').ok).toBe(false);
      expect(coerceFilterValue('2026-13-45', 'date').ok).toBe(false);
    });
  });

  describe('string / json / unknown', () => {
    it('string accepts scalars and stringifies numbers', () => {
      expect(coerceFilterValue('x', 'string')).toEqual({ ok: true, value: 'x' });
      expect(coerceFilterValue(5, 'string')).toEqual({ ok: true, value: '5' });
    });
    it('json and unknown pass through untouched (no opinion to enforce)', () => {
      const o = { a: 1 };
      expect(coerceFilterValue(o, 'json')).toEqual({ ok: true, value: o });
      expect(coerceFilterValue(o, 'unknown')).toEqual({ ok: true, value: o });
      expect(coerceFilterValue('abc', 'unknown')).toEqual({ ok: true, value: 'abc' });
    });
  });

  describe('null', () => {
    it('lets null through for every kind (isNull-style comparisons stay valid)', () => {
      for (const k of ['number', 'boolean', 'date', 'string'] as const) {
        expect(coerceFilterValue(null, k)).toEqual({ ok: true, value: null });
      }
    });
  });
});

import { BaseModel, column } from '@adonisjs/lucid/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFilterRequest } from '../src/parse_request.js';
import { applyFilter } from '../src/runner.js';
import type { FilterConfig } from '../src/types.js';
import { type PgHarness, createPgHarness, pgReachable } from './support/pg.js';

/**
 * DISTINCT is the client/server contract this batch fixes: the client emits a
 * `distinct` query param but the server used to drop it on the floor. These
 * tests run against real Postgres and prove the projection actually dedups rows
 * — and, by comparison against the un-distinct query, that it was a genuine
 * no-op before the fix.
 */

let harness: PgHarness;
let available = false;

// Columns are applied programmatically (rather than with `@column` decorator
// syntax) so the test suite does not depend on SWC legacy-decorator transform
// config — the decorator *is* a plain function, and this is the exact call the
// syntax desugars to.
class Sighting extends BaseModel {
  static table = 'sightings';
  declare id: number;
  declare city: string;
  declare species: string;
}
column({ isPrimary: true })(Sighting.prototype, 'id');
column()(Sighting.prototype, 'city');
column()(Sighting.prototype, 'species');

beforeAll(async () => {
  harness = createPgHarness();
  available = await pgReachable(harness);
  if (!available) return;
  await harness.raw('drop table if exists sightings');
  await harness.raw(
    'create table sightings (id serial primary key, city text not null, species text not null)',
  );
  // 6 rows across 3 distinct cities (NYC x3, LA x2, SF x1).
  await harness.raw(
    "insert into sightings (city, species) values ('NYC','hawk'),('NYC','robin'),('NYC','crow'),('LA','robin'),('LA','crow'),('SF','hawk')",
  );
});

afterAll(async () => {
  if (harness) await harness.close();
});

const config: FilterConfig = { allowed: ['city', 'species'] };

describe('distinct projection against real Postgres', () => {
  it('baseline (no distinct) returns every matching row — the pre-fix behavior', async () => {
    if (!available) return expect.unreachable('Postgres not reachable');
    const query = Sighting.query().select('city');
    // No distinct in input → applyFilter must not add one.
    applyFilter(query as never, { sort: [{ field: 'city', direction: 'asc' }] }, config);
    const rows = await query;
    expect(rows.map((r) => r.city)).toEqual(['LA', 'LA', 'NYC', 'NYC', 'NYC', 'SF']);
  });

  it('distinct([city]) dedups to one row per city (the fix)', async () => {
    if (!available) return expect.unreachable('Postgres not reachable');
    const input = parseFilterRequest({ distinct: 'city', sort: 'city' });
    expect(input.distinct).toEqual(['city']);
    const query = Sighting.query().select('city');
    applyFilter(query as never, input, config);
    const rows = await query;
    // Deduped: 3 cities, not 6 sightings. This is exactly what the client asked
    // for and what the server ignored before the fix.
    expect(rows.map((r) => r.city)).toEqual(['LA', 'NYC', 'SF']);
  });

  it('distinct composes with an active where filter', async () => {
    if (!available) return expect.unreachable('Postgres not reachable');
    const input = parseFilterRequest({ filter: { species: 'robin' }, distinct: 'city', sort: 'city' });
    const query = Sighting.query().select('city');
    applyFilter(query as never, input, config);
    const rows = await query;
    // 'robin' seen in NYC and LA → two distinct cities.
    expect(rows.map((r) => r.city)).toEqual(['LA', 'NYC']);
  });

  it('resolves a distinct alias to its target column before the allow-list', async () => {
    if (!available) return expect.unreachable('Postgres not reachable');
    const input = parseFilterRequest({ distinct: 'town', sort: 'city' });
    const query = Sighting.query().select('city');
    applyFilter(query as never, input, { allowed: ['city'], aliases: { town: 'city' } });
    const rows = await query;
    expect(rows.map((r) => r.city)).toEqual(['LA', 'NYC', 'SF']);
  });

  it('drops a disallowed distinct field (no dedup applied)', async () => {
    if (!available) return expect.unreachable('Postgres not reachable');
    const input = parseFilterRequest({ distinct: 'species', sort: 'city' });
    const query = Sighting.query().select('city');
    // 'species' not in allow-list → distinct dropped → every row survives.
    applyFilter(query as never, input, { allowed: ['city'] });
    const rows = await query;
    expect(rows).toHaveLength(6);
  });
});

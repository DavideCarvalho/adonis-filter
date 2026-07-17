import { Emitter } from '@adonisjs/core/events';
import { AppFactory } from '@adonisjs/core/factories/app';
import { Logger } from '@adonisjs/core/logger';
import { Database } from '@adonisjs/lucid/database';
import { BaseModel } from '@adonisjs/lucid/orm';

/**
 * A real Lucid + Postgres harness for the integration tests. The library is
 * unit-tested against the recording `MockQueryBuilder`, but the SQL-executing
 * features (DISTINCT dedup, correlated-subquery aggregates, injection safety)
 * can only be *proven* against a real database — the mock records calls, it does
 * not run SQL. This spins up a standalone Lucid `Database` (no full AdonisJS app)
 * pointed at a throwaway Postgres.
 *
 * Connection comes from `FILTER_TEST_PG_*` env (or the throwaway container the
 * test run boots on port 55432). A single `Database` is shared across the suite.
 */

export interface PgHarness {
  db: Database;
  /** Run raw SQL (DDL/seed). */
  raw(sql: string, bindings?: unknown[]): Promise<unknown>;
  /** Close all connections. */
  close(): Promise<void>;
}

function connectionConfig() {
  return {
    host: process.env.FILTER_TEST_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.FILTER_TEST_PG_PORT ?? 55432),
    user: process.env.FILTER_TEST_PG_USER ?? 'postgres',
    password: process.env.FILTER_TEST_PG_PASSWORD ?? 'postgres',
    database: process.env.FILTER_TEST_PG_DATABASE ?? 'filter_test',
    // Fail fast when no Postgres is reachable so the reachability probe (and the
    // whole suite) doesn't hang on a filtered/absent host — the pg-backed specs
    // then skip cleanly instead of timing out.
    connectionTimeoutMillis: 2000,
  };
}

export function createPgHarness(): PgHarness {
  const app = new AppFactory().create(new URL('file:///tmp/filter-test/'), () => {});
  const logger = new Logger({ enabled: false });
  const emitter = new Emitter(app);
  const db = new Database(
    {
      connection: 'pg',
      connections: {
        pg: {
          client: 'pg',
          connection: connectionConfig(),
          // Keep the pool tiny and don't wait long to acquire — a down host
          // should surface quickly rather than block hooks until they time out.
          pool: { min: 0, max: 2, acquireTimeoutMillis: 3000 },
        },
      },
    },
    // Standalone Lucid wiring — the factory app's logger/emitter shapes satisfy
    // Lucid at runtime; the assertions bridge the nominal type gap.
    logger as any,
    emitter as any,
  );
  BaseModel.useAdapter(db.modelAdapter());
  return {
    db,
    raw: (sql, bindings) => db.rawQuery(sql, bindings ?? []),
    close: () => db.manager.closeAll(),
  };
}

/** True when a Postgres reachable at the configured connection accepts a query. */
export async function pgReachable(harness: PgHarness): Promise<boolean> {
  try {
    await harness.raw('select 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * One-shot reachability probe used at module-collection time (top-level await)
 * so the pg-backed specs can `describe.skipIf(!pgUp)` — the whole block is
 * skipped (not failed) when no Postgres is reachable, keeping the suite green in
 * environments without one. Spins up its own throwaway harness and tears it down.
 */
export async function probePgReachable(): Promise<boolean> {
  const harness = createPgHarness();
  try {
    return await pgReachable(harness);
  } finally {
    await harness.close().catch(() => {});
  }
}

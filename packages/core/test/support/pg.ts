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
  };
}

export function createPgHarness(): PgHarness {
  const app = new AppFactory().create(new URL('file:///tmp/filter-test/'), () => {});
  const logger = new Logger({ enabled: false });
  const emitter = new Emitter(app);
  const db = new Database(
    {
      connection: 'pg',
      connections: { pg: { client: 'pg', connection: connectionConfig() } },
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

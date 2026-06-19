import type { QueryBuilderLike } from '../src/lucid_adapter.js';

/** A recorded query-builder call: method name + its scalar args. */
export interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * A recording stand-in for a Lucid query builder. Nested `where`/`orWhere`
 * closures run against child recorders; {@link flatten} collects every leaf call
 * (across all groups) so tests can assert a translation appeared without caring
 * about the exact grouping nesting.
 */
export class MockQueryBuilder implements QueryBuilderLike {
  calls: RecordedCall[] = [];
  children: MockQueryBuilder[] = [];

  private record(method: string, ...args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  private group(method: string, cb: (qb: QueryBuilderLike) => void): this {
    const child = new MockQueryBuilder();
    this.children.push(child);
    this.calls.push({ method, args: ['<group>'] });
    cb(child);
    return this;
  }

  // biome-ignore lint/suspicious/noExplicitAny: structural overloads for the mock.
  where(a: any, b?: any, c?: any): this {
    if (typeof a === 'function') return this.group('where', a);
    return c !== undefined ? this.record('where', a, b, c) : this.record('where', a, b);
  }
  orWhere(cb: (qb: QueryBuilderLike) => void): this {
    return this.group('orWhere', cb);
  }
  whereNot(column: string, value: unknown): this {
    return this.record('whereNot', column, value);
  }
  whereIn(column: string, values: unknown[]): this {
    return this.record('whereIn', column, values);
  }
  whereNotIn(column: string, values: unknown[]): this {
    return this.record('whereNotIn', column, values);
  }
  whereNull(column: string): this {
    return this.record('whereNull', column);
  }
  whereNotNull(column: string): this {
    return this.record('whereNotNull', column);
  }
  whereBetween(column: string, range: [unknown, unknown]): this {
    return this.record('whereBetween', column, range);
  }
  whereNotBetween(column: string, range: [unknown, unknown]): this {
    return this.record('whereNotBetween', column, range);
  }
  whereILike(column: string, value: string): this {
    return this.record('whereILike', column, value);
  }
  orWhereILike(column: string, value: string): this {
    return this.record('orWhereILike', column, value);
  }
  orderBy(column: string, direction: 'asc' | 'desc'): this {
    return this.record('orderBy', column, direction);
  }

  /** Every recorded call across this builder and all nested groups (excludes the group markers). */
  flatten(): RecordedCall[] {
    const own = this.calls.filter((c) => c.args[0] !== '<group>');
    return [...own, ...this.children.flatMap((c) => c.flatten())];
  }

  /** Find the first flattened call matching `method`. */
  find(method: string): RecordedCall | undefined {
    return this.flatten().find((c) => c.method === method);
  }
}

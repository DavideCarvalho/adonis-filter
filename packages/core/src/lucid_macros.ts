import { HttpContext } from '@adonisjs/core/http';
import type { LucidModel } from '@adonisjs/lucid/types/model';
import {
  type ApplyFromRequestOptions,
  type FilterRequestContext,
  applyFilterFromRequest,
} from './apply_from_request.js';
import type { FilterSpec } from './filter_spec.js';
import type { QueryBuilderLike } from './lucid_adapter.js';

/**
 * O ctx da request para o macro: explícito, ou o `HttpContext` ativo lido do AsyncLocalStorage do
 * Adonis quando omitido. `getOrFail()` lança quando não há request em escopo (ex.: chamada dentro de
 * um job/command) — nesse caso passe o ctx explicitamente. Fica no macro (camada Adonis); o
 * `applyFilterFromRequest` livre continua framework-agnostic, exigindo o ctx.
 */
function resolveCtx(ctx: FilterRequestContext | undefined): FilterRequestContext {
  return ctx ?? HttpContext.getOrFail();
}

/**
 * The static slice of a Lucid query-builder class we register onto: Adonis'
 * `Macroable.macro(name, fn)` adds `fn` to the builder prototype so every query
 * instance gains the method. Declared structurally so this module never
 * hard-imports `@adonisjs/lucid` at runtime (the provider passes the real
 * `ModelQueryBuilder` in) — matching how the rest of the package stays
 * framework-free.
 */
export interface MacroableQueryBuilder {
  macro(name: string, fn: (this: unknown, ...args: never[]) => unknown): void;
}

/**
 * Register the chainable filter macros onto a Lucid query-builder class (the
 * method-call form of {@link applyFilterFromRequest}). Call this from a provider's
 * `boot()` with `ModelQueryBuilder` (from `@adonisjs/lucid/orm`); the
 * `@adonis-agora/filter` provider does exactly that.
 *
 * Two macros are added:
 *
 * - `query.applyFilterFromRequest(spec, ctx, options?)` — applies the spec's
 *   server scope + allow-listed filter/sort/search and returns the query so it
 *   chains (`User.query().applyFilterFromRequest(spec, ctx).orderBy(...)`). The
 *   resolved pagination is dropped; use `filterPaginate` (or the free function)
 *   when you need it.
 * - `query.filterPaginate(spec, ctx, options?)` — applies the same and then
 *   `paginate(page, size)` with the resolved pagination, returning Lucid's
 *   paginator (`await User.query().filterPaginate(spec, ctx)`).
 *
 * Idempotent enough to call once at boot; calling twice re-defines the macros to
 * the same implementations.
 */
export function registerFilterMacros(ModelQueryBuilder: MacroableQueryBuilder): void {
  ModelQueryBuilder.macro('applyFilterFromRequest', function (
    this: QueryBuilderLike,
    spec: FilterSpec,
    ctx?: FilterRequestContext,
    options?: ApplyFromRequestOptions,
  ) {
    applyFilterFromRequest(this, spec, resolveCtx(ctx), options);
    return this;
  } as (this: unknown, ...args: never[]) => unknown);

  ModelQueryBuilder.macro('filterPaginate', function (
    this: QueryBuilderLike & { paginate(page: number, perPage: number): unknown },
    spec: FilterSpec,
    ctx?: FilterRequestContext,
    options?: ApplyFromRequestOptions,
  ) {
    const { page, size } = applyFilterFromRequest(this, spec, resolveCtx(ctx), options);
    return this.paginate(page, size);
  } as (this: unknown, ...args: never[]) => unknown);
}

declare module '@adonisjs/lucid/types/model' {
  interface ModelQueryBuilderContract<Model extends LucidModel, Result = InstanceType<Model>> {
    /**
     * Apply a {@link FilterSpec} from the request context (server scope +
     * allow-listed filter/sort/search) and return the query for chaining — the
     * method form of the free `applyFilterFromRequest`. Pagination is resolved
     * but not returned here; use {@link filterPaginate} when you need it.
     *
     * `ctx` is optional: when omitted, the active `HttpContext` is read from
     * AsyncLocalStorage (`HttpContext.getOrFail()`). Pass it explicitly outside a
     * request scope (e.g. a job/command), where there is no ambient context.
     */
    applyFilterFromRequest(
      spec: FilterSpec,
      ctx?: FilterRequestContext,
      options?: ApplyFromRequestOptions,
    ): this;
    /**
     * Apply a {@link FilterSpec} from the request context and paginate with the
     * resolved `{ page, size }`, returning Lucid's paginator — filter + paginate
     * in one terminal call. `ctx` is optional (see {@link applyFilterFromRequest}).
     */
    filterPaginate(
      spec: FilterSpec,
      ctx?: FilterRequestContext,
      options?: ApplyFromRequestOptions,
    ): ReturnType<this['paginate']>;
  }
}

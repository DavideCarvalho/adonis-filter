import type { ApplicationService } from '@adonisjs/core/types';
import { registerFilterMacros } from '../src/lucid_macros.js';

/**
 * Wires `@adonis-agora/filter`'s chainable Lucid macros into the application.
 *
 * On boot it registers the `applyFilterFromRequest` and `filterPaginate` macros
 * onto Lucid's `ModelQueryBuilder`, so any model query gains the method-call form
 * of the free `applyFilterFromRequest` helper:
 *
 * ```ts
 * const rows = await User.query()
 *   .where('tenantId', tenant.id)
 *   .applyFilterFromRequest(userFilter, ctx)
 *   .orderBy('createdAt', 'desc')
 *
 * const page = await User.query().filterPaginate(userFilter, ctx)
 * ```
 *
 * Register it in `adonisrc.ts` (`providers`). The free functions
 * (`applyFilterFromRequest`, `applyCursorFromRequest`) work without it — this
 * provider only adds the chainable sugar, so `@adonisjs/lucid` is loaded lazily
 * here (not a hard dependency of the package).
 */
export default class FilterProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    const { ModelQueryBuilder } = await import('@adonisjs/lucid/orm');
    registerFilterMacros(ModelQueryBuilder);
  }
}

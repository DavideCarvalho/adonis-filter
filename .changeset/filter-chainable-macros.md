---
"@adonis-agora/filter": minor
---

Add chainable Lucid query-builder macros via an optional `FilterProvider`

Register `@adonis-agora/filter/filter_provider` to get the method-call form of
`applyFilterFromRequest` on any Lucid query builder:

```ts
// filter + sort + search, then keep chaining:
const rows = await User.query()
  .where('tenantId', tenant.id)
  .applyFilterFromRequest(userFilter, ctx)
  .orderBy('createdAt', 'desc')

// filter + paginate in one terminal call (returns Lucid's paginator):
const page = await User.query().filterPaginate(userFilter, ctx)
```

`applyFilterFromRequest` applies the spec's server scope + allow-listed
filter/sort/search and returns the query for chaining (pagination resolved but
not applied); `filterPaginate` additionally calls `paginate(page, size)`. The
free functions are unchanged and work without the provider — the macros only add
the chainable sugar, so `@adonisjs/lucid` is an optional peer. `registerFilterMacros`
is also exported for manual registration.

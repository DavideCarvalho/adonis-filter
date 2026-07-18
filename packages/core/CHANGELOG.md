# @adonis-agora/filter

## 0.6.0

### Minor Changes

- Parity sync from nestjs-filter: execute the server-side `distinct` projection (was a silent no-op), computed (virtual) fields for filter + sort (verbatim-string + `({alias}) => sql` forms), and native to-many aggregate fields (`$count`/`$sum`/`$avg`/`$min`/`$max`) auto-discovered from Lucid relation metadata — value stays parameterized (injection-safe), identifiers quoted.

## 0.5.0

### Minor Changes

- [#6](https://github.com/DavideCarvalho/adonis-filter/pull/6) [`e39da2c`](https://github.com/DavideCarvalho/adonis-filter/commit/e39da2c6f7e47553990f3295414b23d508894c9a) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Os macros `query.applyFilterFromRequest(spec, ctx?)` e `query.filterPaginate(spec, ctx?)` passam a aceitar `ctx` opcional: quando omitido, leem o `HttpContext` ativo do AsyncLocalStorage do Adonis (`HttpContext.getOrFail()`). Nos controllers (99% dos casos) você chama `query.applyFilterFromRequest(spec)` sem passar o ctx. Fora de uma request (job/command), passe o ctx explicitamente. O default vive só no macro (camada Adonis); a função livre `applyFilterFromRequest` continua framework-agnostic, exigindo o ctx.

## 0.4.0

### Minor Changes

- [#4](https://github.com/DavideCarvalho/adonis-filter/pull/4) [`76b2ca8`](https://github.com/DavideCarvalho/adonis-filter/commit/76b2ca82d27811b09dbd98629be6964e9aee6167) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Add chainable Lucid query-builder macros via an optional `FilterProvider`

  Register `@adonis-agora/filter/filter_provider` to get the method-call form of
  `applyFilterFromRequest` on any Lucid query builder:

  ```ts
  // filter + sort + search, then keep chaining:
  const rows = await User.query()
    .where("tenantId", tenant.id)
    .applyFilterFromRequest(userFilter, ctx)
    .orderBy("createdAt", "desc");

  // filter + paginate in one terminal call (returns Lucid's paginator):
  const page = await User.query().filterPaginate(userFilter, ctx);
  ```

  `applyFilterFromRequest` applies the spec's server scope + allow-listed
  filter/sort/search and returns the query for chaining (pagination resolved but
  not applied); `filterPaginate` additionally calls `paginate(page, size)`. The
  free functions are unchanged and work without the provider — the macros only add
  the chainable sugar, so `@adonisjs/lucid` is an optional peer. `registerFilterMacros`
  is also exported for manual registration.

## 0.3.1

### Patch Changes

- [`e6fb05c`](https://github.com/DavideCarvalho/adonis-filter/commit/e6fb05c0e137cd4ab3bad1f9ce5626216e670a8f) - Fix `QueryBuilderLike` rejecting every real Lucid query builder

  Passing a Lucid builder to `applyFilterFromRequest` (or any adapter entry
  point) failed to typecheck in consuming apps:

  ```
  Argument of type 'ModelQueryBuilderContract<typeof Post, Post>' is not
  assignable to parameter of type 'QueryBuilderLike'.
    Types of property 'where' are incompatible.
  ```

  The message blames `where`, but `where` was fine — TS reports the first member
  it tries. The real culprit was `whereHas`, declared here as
  `whereHas(relation: string, ...)`. Lucid types its own as
  `<Name extends ExtractModelRelations<Model>>(relation: Name, ...)`, a union of
  the model's literal relation names, and `string` is not assignable to that
  union under the contravariant parameter check — so no real builder ever
  satisfied the interface. Runtime was always fine; this was types-only.

  `relation` is now `any`, which is the only type that both accepts the `string`
  the adapter passes and is assignable to each model's relation-name union.
  Marking the member optional does not help: an optional member that is present
  is still checked.

  A compile-time guard against real `@adonisjs/lucid` types now covers this
  (`test/types/lucid_compat.types.ts`, run by `pnpm typecheck`). Lucid is a
  devDependency only — nothing under `src/` imports it, so the package stays
  framework-free. A hand-transcribed stub of Lucid's types was tried first and
  compiled clean while real Lucid did not, so the guard uses Lucid's own `.d.ts`.

## 0.3.0

### Minor Changes

- [`d20245c`](https://github.com/DavideCarvalho/adonis-filter/commit/d20245cc6818120098d0f9027b59284380fd9f7e) - `filterable` accepts a colocated map: field name and its kind in one place

  The array form makes every non-string field appear twice — once in `filterable`, once in
  `fieldTypes` — which is ceremony for what is usually a short list:

  ```ts
  filterable: ['advisorId', 'dayOfWeek', 'isRecurring'],
  fieldTypes: { dayOfWeek: { kind: 'number' }, isRecurring: { kind: 'boolean' } },
  ```

  `filterable` now also accepts a map, declaring both at once:

  ```ts
  filterable: { advisorId: 'string', dayOfWeek: 'number', isRecurring: 'boolean' },
  ```

  It desugars at the `defineFilter` boundary — the keys become the allow-list, the values become
  `fieldTypes` — so everything downstream (predicates, runner, codegen) sees exactly the spec the
  array form produces. An explicit `fieldTypes` entry still wins per field, which is how a caller
  adds codegen-only richness (`enumValues`/`typeRef`) on top of a bare kind.

  Both existing forms (`string[]` and `'*'`) are untouched and remain the right choice when no field
  needs a declared type — `'string'` is the no-op kind, so a spec of only string columns should keep
  using the array.

## 0.2.0

### Minor Changes

- [`058f0c0`](https://github.com/DavideCarvalho/adonis-filter/commit/058f0c0ef3dd224277663e6a5d40c0ef58e6bbd7) - `fieldTypes` on `defineFilter`: server-side value validation, and one type declaration for both ends

  A filter value arriving over a query string is always a string, and Postgres implicitly casts the
  benign cases — `day_of_week = '3'` and `is_recurring = 'false'` both work — so the gap stayed
  invisible. It surfaces when a client sends something uncastable: `?filter[isRecurring][equals]=xyz`
  becomes `is_recurring = 'xyz'`, which Postgres rejects with `invalid input syntax for type boolean`.
  That is a **500 on a public endpoint, driven entirely by user input**. The allow-list guarded which
  FIELD could be filtered; nothing guarded the VALUE that reached the column.

  `defineFilter` now accepts `fieldTypes`, and a declared field has its value coerced before it ever
  reaches the driver. An uncoercible value is treated exactly like a disallowed field — dropped by
  default, or a loud `InvalidColumnFilterError` (→ 400 instead of 500) under `throwOnInvalid`. The
  existing semantics are reused rather than a second error path invented.

  ```ts
  export const availabilityFilter = defineFilter({
    filterable: ["advisorId", "dayOfWeek", "isRecurring"],
    fieldTypes: {
      dayOfWeek: { kind: "number" },
      isRecurring: { kind: "boolean" },
    },
  });
  ```

  The same declaration now also feeds `make:filter-client`, which previously required repeating the
  types in the codegen manifest. Declaring a kind once drives both value coercion and the client's
  operator narrowing; an explicit manifest `fieldTypes` still wins when the client wants richer
  codegen-only info (`enumValues`/`typeRef`).

  Details:

  - Array-valued operators (`in`, `between`, ...) coerce element-wise and fail as a whole if any
    element fails — a partially-coerced list would filter on something the client never asked for.
  - Pattern operators (`contains`, `startsWith`, ...) are never coerced: their argument is a LIKE
    pattern, so turning `contains: '3'` into the number `3` would destroy it.
  - `date` values are validated but handed back verbatim, never rewritten — converting `'2026-07-15'`
    to a `Date` would silently re-zone a date-only value and shift the day for negative-offset clients.
  - Undeclared fields are untouched, so this is backwards compatible and opt-in.
  - `FilterFieldKind` moved from `generate_client.ts` to `types.ts` (it is no longer codegen-only) and
    is re-exported from its old path.

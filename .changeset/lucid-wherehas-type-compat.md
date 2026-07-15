---
'@adonis-agora/filter': patch
---

Fix `QueryBuilderLike` rejecting every real Lucid query builder

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

---
'@adonis-agora/filter': minor
---

`filterable` accepts a colocated map: field name and its kind in one place

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

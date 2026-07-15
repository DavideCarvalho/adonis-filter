---
'@adonis-agora/filter': minor
---

`fieldTypes` on `defineFilter`: server-side value validation, and one type declaration for both ends

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
  filterable: ['advisorId', 'dayOfWeek', 'isRecurring'],
  fieldTypes: { dayOfWeek: { kind: 'number' }, isRecurring: { kind: 'boolean' } },
})
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

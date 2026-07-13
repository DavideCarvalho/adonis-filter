# `@adonis-agora/filter`

Server-side query filtering, sorting, and pagination for AdonisJS. Parses the
Spatie/JSON:API query the `@agora/filter-client` builder emits, applies it to a
Lucid query through a field allow-list, and resolves offset or keyset (cursor)
pagination.

```ts
import { parseFilterRequest, applyFilter } from '@adonis-agora/filter'

const input = parseFilterRequest(ctx.request.qs())
const query = User.query()
const { page, size } = applyFilter(query, input, {
  allowed: ['name', 'email', 'age'],
  searchable: ['name', 'email'],
})
return query.paginate(page, size)
```

Operators: equals/notEquals, contains/iContains/startsWith/endsWith, gt/gte/lt/lte,
between/notBetween, in/notIn/isAnyOf, isNull/isNotNull/isEmpty/isNotEmpty, plus
AND/OR composition. The `allowed`/`sortable`/`searchable` lists are the security
boundary. The Lucid binding is structural (`QueryBuilderLike`) so any Lucid query
builder works and the adapter is unit-testable.

See the [repository README](https://github.com/DavideCarvalho/adonis-filter).

## License

MIT © Davi Carvalho

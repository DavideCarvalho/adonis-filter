# `@agora/filter`

> Query filtering, sorting, and pagination for **AdonisJS** — Spatie/JSON:API
> style. Part of the [Agora](https://github.com/DavideCarvalho) ecosystem.

## Packages

| Package | What |
|---|---|
| [`@agora/filter`](./packages/core) | server-side: parse request → apply to a Lucid query under a field allow-list, resolve pagination |
| [`@agora/filter-client`](./packages/client) | framework-agnostic client query builder (+ TanStack Table sync) |

```ts
// client
import { filterQuery } from '@agora/filter-client'
const qs = filterQuery().where('age', 'gte', 18).sort('createdAt', 'desc').toQueryString()

// server (AdonisJS controller)
import { parseFilterRequest, applyFilter } from '@agora/filter'
const input = parseFilterRequest(ctx.request.qs())
const query = User.query()
const { page, size } = applyFilter(query, input, { allowed: ['age', 'createdAt'] })
return query.paginate(page, size)
```

The server core covers column operators, AND/OR, sort, ILIKE search, offset
pagination, and field allow-listing. Advanced surfaces from the NestJS original
(relation filtering, cursor pagination, computed/vector/distinct) are extensible
via the `QueryBuilderLike` adapter and planned as follow-ups.

## License

MIT © Davi Carvalho

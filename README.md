# `@agora/filter`

> Filter library for **AdonisJS** — Spatie-style query filtering, sorting, and
> pagination. Part of the [Agora](https://github.com/DavideCarvalho) ecosystem.

## Packages

| Package | Status | What |
|---|---|---|
| [`@agora/filter-client`](./packages/client) | ✅ shipped | framework-agnostic client query builder (+ TanStack Table sync) |
| `@agora/filter` (core + Lucid adapter) | 🚧 planned | server-side filter runner with a Lucid ORM adapter |

The client builds the query string a browser sends; the core (planned) parses it
on the server and applies it to a Lucid query, with whitelisted filterable fields,
relation filtering, search, cursor/offset pagination, and `agora:filter`
diagnostics.

## License

MIT © Davi Carvalho

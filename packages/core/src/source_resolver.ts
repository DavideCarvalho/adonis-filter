import type { InputSource } from './types.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const READ_METHODS = new Set(['GET', 'HEAD']);

interface ReqLike {
  method?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

/**
 * Resolve the raw structured input from a request according to an
 * {@link InputSource}:
 *
 * - a function — a custom extractor, called with the request.
 * - `'query'` / `'body'` — always that container.
 * - `'auto'` (or any other bare token) — query on reads (GET/HEAD), query+body
 *   merged (body wins) on writes (POST/PUT/PATCH/DELETE).
 * - a dot-path (e.g. `'body.filters'`) — the nested object at that path, or `{}`
 *   when the path is missing or does not resolve to an object.
 *
 * The `req` is treated structurally (`{ method, query, body }`), so an AdonisJS
 * `HttpContext.request` — whose `qs()`/`body()` you pass in — or a plain object
 * both work. The result is always a fresh shallow copy.
 */
export function resolveInputFromRequest(
  req: unknown,
  source: InputSource,
): Record<string, unknown> {
  if (typeof source === 'function') {
    const r = source(req);
    return { ...(r ?? {}) } as Record<string, unknown>;
  }
  const r = (req ?? {}) as ReqLike;
  const query = (r.query ?? {}) as Record<string, unknown>;
  const body = (r.body ?? {}) as Record<string, unknown>;

  switch (source) {
    case 'query':
      return { ...query };
    case 'body':
      return { ...body };
    case 'auto': {
      const method = (r.method ?? 'GET').toUpperCase();
      if (READ_METHODS.has(method)) return { ...query };
      if (WRITE_METHODS.has(method)) return { ...query, ...body };
      return { ...query };
    }
    default: {
      if (source.includes('.')) {
        const resolved = resolveDotPath(r, source);
        return { ...(resolved ?? {}) };
      }
      const method = (r.method ?? 'GET').toUpperCase();
      if (READ_METHODS.has(method)) return { ...query };
      if (WRITE_METHODS.has(method)) return { ...query, ...body };
      return { ...query };
    }
  }
}

function resolveDotPath(obj: unknown, path: string): Record<string, unknown> | undefined {
  let current: unknown = obj;
  for (const segment of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  if (current == null || typeof current !== 'object') return undefined;
  return current as Record<string, unknown>;
}

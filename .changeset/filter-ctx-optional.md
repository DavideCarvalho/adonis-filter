---
'@adonis-agora/filter': minor
---

Os macros `query.applyFilterFromRequest(spec, ctx?)` e `query.filterPaginate(spec, ctx?)` passam a aceitar `ctx` opcional: quando omitido, leem o `HttpContext` ativo do AsyncLocalStorage do Adonis (`HttpContext.getOrFail()`). Nos controllers (99% dos casos) você chama `query.applyFilterFromRequest(spec)` sem passar o ctx. Fora de uma request (job/command), passe o ctx explicitamente. O default vive só no macro (camada Adonis); a função livre `applyFilterFromRequest` continua framework-agnostic, exigindo o ctx.

# Phase 10 Vercel Read-Only Prototype

This prototype adds a Vercel deployment boundary for the exported Next frontend plus a small public cache read API. It is intentionally not a migration of KoeScope's local backend.

## Deployment Shape

- `vercel.json` runs `npm run web:build` and serves only `web/out` as the frontend output.
- The only Vercel function in this prototype is `api/public-search-cache.js`.
- The function route is `GET /api/public-search-cache?queryKey=<public-query-key>`.
- `HEAD` is accepted for lightweight cache checks. Mutating methods return `405`.
- The function uses Vercel edge cache-friendly headers: `public, max-age=0, s-maxage=60, stale-while-revalidate=600`.

## Data Boundary

The Vercel API reads only public cache payloads. It does not import the monitor service, local SQLite connection, Chrome Companion import paths, DLsite cookies, account points, purchase snapshots, watchlist state, annotations, subscriptions, or local maintenance operations.

Current prototype source:

- `KOESCOPE_PUBLIC_SEARCH_CACHE_JSON`: JSON array or object of public cache payloads, useful for a tiny deployment smoke test.

Future provider-backed variants can replace the static environment repository with a Turso/libSQL or Postgres read adapter while keeping the same `getSearchResult(queryKey)` contract.

## Local Verification

- `test/publicSearchCacheReadApi.test.js` proves the API is read-only, validates query keys before repository access, strips private/local overlay fields, omits local refresh job ids, and checks the Vercel config only exposes the exported frontend plus the single read function.
- Full deployment was not executed locally because no Vercel project/token is configured in this workspace.

## Sources

- https://vercel.com/docs/project-configuration
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/headers/cache-control-headers

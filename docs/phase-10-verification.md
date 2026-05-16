# Phase 10 Verification

This pass verifies the cloud-cache boundary while keeping local-first behavior intact.

## Verified Behavior

- Repeated searches can opt into `preferCache: true`.
- When a public cache entry exists, `/api/search/progressive` returns the cached public payload first and still starts a background refresh job.
- Stale cache reads keep `cache.read.source = "cache"` and `cache.read.isStale = true`, while `cache.refresh` carries the running refresh job state.
- With `preferCache: false`, or when no public cache is configured, the endpoint keeps the existing live local search path and does not read the cache.
- Public cache serialization strips local watchlist, annotations, account, subscription, local image-cache paths, and local overlay fields.
- Local overlay data is applied only after public cache reads and remains removable through `buildPublicSearchCachePayload()`.

## Test Evidence

- `test/publicSearchCacheFirst.test.js`
- `test/publicSearchCacheRepository.test.js`
- `test/localSearchOverlay.test.js`
- `test/publicSearchCacheReadApi.test.js`
- `test/publicSearchRefreshPlanner.test.js`
- full `npm test`
- `npm run web:build`

Live cloud deployment remains outside this local verification run because no Vercel project/token is configured here.

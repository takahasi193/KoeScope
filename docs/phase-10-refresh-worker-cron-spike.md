# Phase 10 Refresh Worker And Cron Spike

This spike defines a lightweight refresh scheduling boundary for public DLsite search cache rows. It keeps Vercel Cron as a dispatcher only; the cron function does not fetch DLsite, read local cookies, touch local SQLite, or mutate account/watchlist/subscription data.

## Current Implementation

- `planPublicSearchRefresh(entries, options)` selects stale public query rows, respects retry backoff, stops exhausted entries, and returns a bounded queue plan.
- `api/public-search-refresh.js` exposes a Vercel-friendly `GET/HEAD` cron endpoint that returns only the plan.
- `vercel.json` schedules `/api/public-search-refresh` every six hours and caps both public functions at short runtimes.
- `KOESCOPE_PUBLIC_SEARCH_REFRESH_ENTRIES_JSON` is the prototype input for cron smoke tests.

## Retry Model

- Fresh rows are skipped.
- Stale rows with no prior failures are queued as `stale`.
- Failed rows are queued as `retry_due` only after exponential backoff.
- Entries at `maxAttempts` are skipped as exhausted.
- If due rows exceed the cron batch limit, `requiresWorker: true` signals that a real queue/worker layer should own the heavier refresh work.

## Boundary

Allowed public fields:

- `queryKey`
- `publicQuery`
- public freshness timestamps such as `cachedAt` and `expiresAt`
- public popularity hints such as search or subscription counts, without local account identity
- retry counters and public refresh timestamps

Disallowed fields:

- DLsite cookies or browser sessions
- account points, purchase history, wishlist, local watchlist, annotations, or target prices
- local SQLite file paths or maintenance controls

## Sources

- https://vercel.com/docs/cron-jobs
- https://vercel.com/docs/project-configuration

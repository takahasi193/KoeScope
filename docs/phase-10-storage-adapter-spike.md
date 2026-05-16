# Phase 10 Storage Adapter Spike

This spike keeps KoeScope local-first while making public DLsite search-result caching portable to a future cloud read API.

## Boundary

Public cache rows may contain:

- `queryKey`, `queryVersion`, and `publicQuery`
- public search request shape: keyword, person id/name/public aliases, scope, order, pagination limits
- public DLsite result fields such as product id, title, URL, image URL, circle, floor, type, age, price, sales, matched aliases, and verification status
- cache freshness metadata: `cachedAt`, `expiresAt`, and stale/fresh read state

Public cache rows must not contain:

- DLsite cookie/session data
- account points, purchase history, wishlist, collection state, or account import status
- local watchlist state, target prices, notes, annotations, tags, or subscription overlay fields
- local-only cached image paths such as `/cache/...`

## Current Implementation

- Default adapter: local SQLite table `public_search_cache` in the existing monitor database.
- Runtime entry point: `createPublicSearchCacheRepository()`.
- Search completion writes public-only cache snapshots through `createSearchJobStore({ searchCacheRepository })`.
- Reads are available through `getSearchResult(queryKey)`, but the main UI still uses live searches. Cache-first rendering is intentionally left for the later Phase 10 verification/local-overlay work.

## Provider Evaluation

### Neon / Postgres

Neon is a good Vercel/serverless candidate because its docs recommend pooled connections for serverless functions and describe PgBouncer-backed pooling for high client connection counts. The Neon serverless driver also supports querying over HTTP or WebSockets from serverless and edge environments.

Fit: strong for Vercel read APIs and future analytics. Tradeoff: requires a Postgres-flavored adapter and care with transaction-pooler limitations.

Sources:
- https://neon.com/docs/connect/connection-pooling
- https://neon.com/docs/serverless/serverless-driver

### Supabase / Postgres

Supabase is also viable for Postgres-backed public cache storage. Its docs direct serverless or edge function traffic toward pooler transaction mode through Supavisor, and note that connection pooling improves scalability by reusing connections.

Fit: strong if future work wants Supabase Data APIs/RLS around public cache rows. Tradeoff: transaction mode does not support prepared statements, so the adapter should avoid relying on session-level behavior.

Source:
- https://supabase.com/docs/guides/database/connecting-to-postgres

### Turso / libSQL

Turso/libSQL is closest to the current local SQLite shape. The TypeScript docs recommend local embedded packages for local use, a serverless package for remote over-the-network use, and note `@libsql/client` compatibility. Turso Sync also supports explicit local-first push/pull.

Fit: lowest migration friction from the current SQLite schema and attractive for local-first sync experiments. Tradeoff: less standard than Postgres for Vercel ecosystem examples and SQL dialect portability.

Source:
- https://docs.turso.tech/sdk/ts/quickstart

## Recommendation

Keep the adapter contract database-neutral now:

- `saveSearchResult(payload, { cachedAt, ttlMs })`
- `getSearchResult(queryKey, { now })`
- public payload sanitization before any adapter write

Use local SQLite as the default implementation in KoeScope. For a cloud prototype, evaluate Turso/libSQL first for minimum schema friction, and Neon second if the Vercel read-only API needs Postgres ecosystem maturity.

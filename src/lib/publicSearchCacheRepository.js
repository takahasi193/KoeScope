import { normalizeSpace } from "./cache.js";
import { openMonitorDatabase } from "./monitor/db/connection.js";
import { asJson, parseJson } from "./monitor/db/utils.js";
import { buildPublicSearchCachePayload } from "./publicSearchCachePayload.js";
import { withSearchCacheRuntimeState } from "./searchCacheKey.js";

const DEFAULT_PUBLIC_SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export { buildPublicSearchCachePayload } from "./publicSearchCachePayload.js";

function toIsoTime(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function toExpiresAt(cachedAt, ttlMs) {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return null;
  return new Date(Date.parse(cachedAt) + ttl).toISOString();
}

function isExpired(row, now) {
  if (!row?.expires_at) return false;
  return Date.parse(row.expires_at) <= Date.parse(toIsoTime(now));
}

function mapCacheRow(row, { now = new Date() } = {}) {
  if (!row) return null;
  const payload = parseJson(row.payload_json, {});
  const cache = {
    queryKey: row.query_key,
    queryVersion: row.query_version,
    publicQuery: parseJson(row.public_query_json, {}),
    read: {
      source: "cache",
      isStale: isExpired(row, now),
      cachedAt: row.cached_at,
    },
  };
  return {
    ...payload,
    cache: withSearchCacheRuntimeState(cache, {
      status: "idle",
      updatedAt: row.updated_at,
    }),
  };
}

export function createPublicSearchCacheRepository({
  db = null,
  dbPath,
  adapterName = "local-sqlite",
  defaultTtlMs = DEFAULT_PUBLIC_SEARCH_CACHE_TTL_MS,
} = {}) {
  const resolvedDb = db ?? openMonitorDatabase({ dbPath });
  const ownsDb = !db;

  const upsertCacheEntry = resolvedDb.prepare(`
    INSERT INTO public_search_cache (
      query_key, query_version, public_query_json, payload_json,
      cached_at, expires_at, updated_at, source_adapter
    )
    VALUES (
      @queryKey, @queryVersion, @publicQueryJson, @payloadJson,
      @cachedAt, @expiresAt, @updatedAt, @sourceAdapter
    )
    ON CONFLICT(query_key) DO UPDATE SET
      query_version = excluded.query_version,
      public_query_json = excluded.public_query_json,
      payload_json = excluded.payload_json,
      cached_at = excluded.cached_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at,
      source_adapter = excluded.source_adapter
  `);

  const getCacheEntry = resolvedDb.prepare("SELECT * FROM public_search_cache WHERE query_key = ?");

  function saveSearchResult(payload, { cachedAt = new Date(), ttlMs = defaultTtlMs } = {}) {
    const publicPayload = buildPublicSearchCachePayload(payload);
    const queryKey = normalizeSpace(publicPayload.cache.queryKey);
    if (!queryKey) {
      const error = new Error("cache.queryKey is required to store public search results.");
      error.statusCode = 400;
      throw error;
    }

    const savedAt = toIsoTime(cachedAt);
    upsertCacheEntry.run({
      queryKey,
      queryVersion: normalizeSpace(publicPayload.cache.queryVersion) || "unknown",
      publicQueryJson: asJson(publicPayload.cache.publicQuery),
      payloadJson: asJson(publicPayload),
      cachedAt: savedAt,
      expiresAt: toExpiresAt(savedAt, ttlMs),
      updatedAt: savedAt,
      sourceAdapter: adapterName,
    });

    return getSearchResult(queryKey, { now: savedAt });
  }

  function getSearchResult(queryKey, options = {}) {
    const key = normalizeSpace(queryKey);
    if (!key) return null;
    return mapCacheRow(getCacheEntry.get(key), options);
  }

  function close() {
    if (ownsDb) resolvedDb.close();
  }

  return {
    adapterName,
    db: resolvedDb,
    saveSearchResult,
    getSearchResult,
    close,
  };
}

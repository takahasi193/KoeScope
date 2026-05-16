import { normalizeSpace } from "./cache.js";
import { buildPublicSearchCachePayload } from "./publicSearchCachePayload.js";

const READ_METHODS = new Set(["GET", "HEAD"]);
const ALLOW_HEADER = "GET, HEAD, OPTIONS";
const PUBLIC_CACHE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
  "access-control-allow-origin": "*",
};
const NO_STORE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

function jsonResponse(body, { status = 200, headers = PUBLIC_CACHE_HEADERS, head = false } = {}) {
  return new Response(head ? null : `${JSON.stringify(body)}\n`, { status, headers });
}

function normalizeMethod(method) {
  return normalizeSpace(method || "GET").toUpperCase();
}

function normalizeEntries(entries) {
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === "object") return Object.values(entries);
  return [];
}

export function isPublicSearchQueryKey(value) {
  const queryKey = normalizeSpace(value);
  return /^[a-z0-9][a-z0-9-]{2,63}:[A-Za-z0-9_-]{16,64}$/.test(queryKey);
}

export function createStaticPublicSearchCacheRepository({ entries = [] } = {}) {
  const payloads = new Map();

  for (const entry of normalizeEntries(entries)) {
    const payload = buildPublicSearchCachePayload(entry);
    const queryKey = normalizeSpace(payload.cache.queryKey);
    if (isPublicSearchQueryKey(queryKey)) payloads.set(queryKey, payload);
  }

  return {
    async getSearchResult(queryKey) {
      return payloads.get(normalizeSpace(queryKey)) ?? null;
    },
  };
}

export function createEnvPublicSearchCacheRepository(env = process.env) {
  const rawJson = normalizeSpace(env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON);
  if (!rawJson) return null;
  try {
    return createStaticPublicSearchCacheRepository({ entries: JSON.parse(rawJson) });
  } catch {
    return null;
  }
}

export async function handlePublicSearchCacheRequest(request, { repository = null, now = new Date() } = {}) {
  const method = normalizeMethod(request.method);
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        allow: ALLOW_HEADER,
        "access-control-allow-methods": ALLOW_HEADER,
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "cache-control": "no-store",
      },
    });
  }

  if (!READ_METHODS.has(method)) {
    return jsonResponse(
      { error: "Public search cache API is read-only." },
      {
        status: 405,
        headers: { ...NO_STORE_HEADERS, allow: ALLOW_HEADER },
        head: method === "HEAD",
      }
    );
  }

  const url = new URL(request.url);
  const queryKey = normalizeSpace(url.searchParams.get("queryKey") ?? url.searchParams.get("key"));
  if (!queryKey) {
    return jsonResponse(
      { error: "queryKey is required." },
      { status: 400, headers: NO_STORE_HEADERS, head: method === "HEAD" }
    );
  }
  if (!isPublicSearchQueryKey(queryKey)) {
    return jsonResponse(
      { error: "queryKey is not a public search cache key." },
      { status: 400, headers: NO_STORE_HEADERS, head: method === "HEAD" }
    );
  }
  if (!repository?.getSearchResult) {
    return jsonResponse(
      { error: "Public search cache backend is not configured." },
      { status: 503, headers: NO_STORE_HEADERS, head: method === "HEAD" }
    );
  }

  const payload = await repository.getSearchResult(queryKey, { now });
  if (!payload) {
    return jsonResponse(
      { error: "Public search cache entry not found." },
      { status: 404, headers: NO_STORE_HEADERS, head: method === "HEAD" }
    );
  }

  return jsonResponse(buildPublicSearchCachePayload(payload), { head: method === "HEAD" });
}

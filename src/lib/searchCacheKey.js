import { createHash } from "node:crypto";
import { normalizeSpace } from "./cache.js";
import { normalizeSearchOrder } from "./dlsite.js";

export const SEARCH_CACHE_QUERY_VERSION = "dlsite-search-v1";

const SEARCH_SCOPES = new Set(["all", "adult", "nonAdult"]);

function normalizePublicText(value) {
  return normalizeSpace(value).normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function normalizePersonId(value) {
  const personId = Number(value);
  return Number.isFinite(personId) && personId > 0 ? Math.trunc(personId) : null;
}

function normalizeScope(value) {
  const scope = normalizeSpace(value);
  return SEARCH_SCOPES.has(scope) ? scope : "all";
}

function normalizeAliases(values = []) {
  const seen = new Set();
  const aliases = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const alias = normalizePublicText(value);
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    aliases.push(alias);
  }
  return aliases;
}

export function createPublicSearchQuery({
  keyword,
  personId,
  aliases,
  scope,
  order,
  version = SEARCH_CACHE_QUERY_VERSION,
} = {}) {
  const publicQuery = {
    version: normalizeSpace(version) || SEARCH_CACHE_QUERY_VERSION,
    keyword: normalizePublicText(keyword),
    personId: normalizePersonId(personId),
    aliases: normalizeAliases(aliases),
    scope: normalizeScope(scope),
    order: normalizeSearchOrder(order),
  };
  const digest = createHash("sha256").update(JSON.stringify(publicQuery)).digest("base64url").slice(0, 32);
  return {
    queryKey: `${publicQuery.version}:${digest}`,
    queryVersion: publicQuery.version,
    publicQuery,
  };
}

function normalizeReadSource(value) {
  return value === "cache" ? "cache" : "live";
}

function normalizeRefreshStatus(value) {
  return ["idle", "running", "verifying", "completed", "failed"].includes(value) ? value : "idle";
}

export function withSearchCacheRuntimeState(cache, { jobId = "", status = "idle", updatedAt = null } = {}) {
  const refreshStatus = normalizeRefreshStatus(status);
  return {
    ...cache,
    read: {
      source: normalizeReadSource(cache?.read?.source),
      isStale: Boolean(cache?.read?.isStale),
      cachedAt: cache?.read?.cachedAt ?? null,
    },
    refresh: {
      jobId: normalizeSpace(jobId),
      status: refreshStatus,
      isRefreshing: refreshStatus === "running" || refreshStatus === "verifying",
      updatedAt,
    },
  };
}

import { normalizeSpace } from "./cache.js";
import { isPublicSearchQueryKey } from "./publicSearchCacheReadApi.js";

const DEFAULT_MAX_BATCH = 5;
const DEFAULT_STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_RETRY_BASE_MS = 1000 * 60 * 5;
const DEFAULT_RETRY_MAX_MS = 1000 * 60 * 60;
const DEFAULT_MAX_ATTEMPTS = 4;
const PUBLIC_QUERY_FIELDS = ["version", "keyword", "personId", "aliases", "scope", "order"];

function toIsoTime(value, fallback = "") {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

function toTimeMs(value) {
  const iso = toIsoTime(value);
  return iso ? Date.parse(iso) : NaN;
}

function positiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function publicQueryFields(source = {}) {
  const publicQuery = source.publicQuery ?? source.cache?.publicQuery ?? {};
  const result = {};
  for (const field of PUBLIC_QUERY_FIELDS) {
    if (publicQuery[field] !== undefined) result[field] = publicQuery[field];
  }
  return result;
}

function readAttempts(entry = {}) {
  return Math.max(0, Math.trunc(Number(entry.refresh?.attempts ?? entry.attempts ?? 0)) || 0);
}

function retryDelayMs(attempts, { retryBaseMs, retryMaxMs }) {
  if (attempts <= 0) return 0;
  return Math.min(retryBaseMs * 2 ** Math.max(0, attempts - 1), retryMaxMs);
}

function nextRetryTime(entry, attempts, options) {
  if (attempts <= 0) return 0;
  const lastAttemptMs = toTimeMs(entry.refresh?.lastAttemptAt ?? entry.lastAttemptAt);
  if (!Number.isFinite(lastAttemptMs)) return 0;
  return lastAttemptMs + retryDelayMs(attempts, options);
}

function normalizeEntry(entry = {}, options) {
  const queryKey = normalizeSpace(entry.queryKey ?? entry.cache?.queryKey);
  if (!isPublicSearchQueryKey(queryKey)) return { invalid: true };

  const cachedAt = toIsoTime(entry.cachedAt ?? entry.cache?.read?.cachedAt);
  const cachedAtMs = toTimeMs(cachedAt);
  if (!Number.isFinite(cachedAtMs)) return { invalid: true };

  const nowMs = options.nowMs;
  const expiresAt = toIsoTime(entry.expiresAt);
  const expiresAtMs = toTimeMs(expiresAt);
  const isExpired = Number.isFinite(expiresAtMs)
    ? expiresAtMs <= nowMs
    : cachedAtMs + options.staleAfterMs <= nowMs;
  const attempts = readAttempts(entry);
  const nextRetryMs = nextRetryTime(entry, attempts, options);
  const searchCount = Math.max(0, Math.trunc(Number(entry.popularity?.searchCount ?? entry.searchCount ?? 0)) || 0);
  const subscriptionCount =
    Math.max(0, Math.trunc(Number(entry.popularity?.subscriptionCount ?? entry.subscriptionCount ?? 0)) || 0);

  return {
    queryKey,
    publicQuery: publicQueryFields(entry),
    cachedAt,
    expiresAt,
    attempts,
    nextRetryAt: nextRetryMs ? new Date(nextRetryMs).toISOString() : null,
    searchCount,
    subscriptionCount,
    isExpired,
    retryPending: attempts > 0 && nextRetryMs > nowMs,
    exhausted: attempts >= options.maxAttempts,
    staleMs: Math.max(0, nowMs - cachedAtMs),
  };
}

function priorityScore(entry) {
  return entry.subscriptionCount * 100000 + entry.searchCount * 1000 + Math.floor(entry.staleMs / (1000 * 60 * 60));
}

export function readEnvPublicSearchRefreshEntries(env = process.env) {
  const rawJson = normalizeSpace(env.KOESCOPE_PUBLIC_SEARCH_REFRESH_ENTRIES_JSON);
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return Object.values(parsed);
  } catch {
    return null;
  }
  return null;
}

export function planPublicSearchRefresh(entries = [], options = {}) {
  const now = toIsoTime(options.now, new Date().toISOString());
  const plannerOptions = {
    nowMs: Date.parse(now),
    staleAfterMs: positiveInteger(options.staleAfterMs, DEFAULT_STALE_AFTER_MS),
    retryBaseMs: positiveInteger(options.retryBaseMs, DEFAULT_RETRY_BASE_MS),
    retryMaxMs: positiveInteger(options.retryMaxMs, DEFAULT_RETRY_MAX_MS),
    maxAttempts: positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS),
  };
  const maxBatch = positiveInteger(options.maxBatch, DEFAULT_MAX_BATCH);
  const skipped = { fresh: 0, retryPending: 0, exhausted: 0, invalid: 0 };
  const due = [];

  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const entry = normalizeEntry(rawEntry, plannerOptions);
    if (entry.invalid) {
      skipped.invalid += 1;
      continue;
    }
    if (entry.exhausted) {
      skipped.exhausted += 1;
      continue;
    }
    if (!entry.isExpired) {
      skipped.fresh += 1;
      continue;
    }
    if (entry.retryPending) {
      skipped.retryPending += 1;
      continue;
    }

    due.push({
      queryKey: entry.queryKey,
      publicQuery: entry.publicQuery,
      reason: entry.attempts > 0 ? "retry_due" : "stale",
      attempt: entry.attempts + 1,
      cachedAt: entry.cachedAt,
      expiresAt: entry.expiresAt || null,
      nextRetryAt: entry.nextRetryAt,
      priorityScore: priorityScore(entry),
    });
  }

  due.sort((a, b) => b.priorityScore - a.priorityScore || a.queryKey.localeCompare(b.queryKey));
  const queued = due.slice(0, maxBatch);

  return {
    mode: "cron-dispatch",
    now,
    maxBatch,
    executesRefreshJobs: false,
    dueTotal: due.length,
    queued,
    overflow: Math.max(0, due.length - queued.length),
    requiresWorker: due.length > queued.length,
    skipped,
  };
}

import { normalizeSpace } from "./cache.js";
import { PUBLIC_SEARCH_QUERY_FIELDS } from "./searchCacheKey.js";

const PUBLIC_PERSON_FIELDS = [
  "id",
  "name",
  "image",
  "career",
  "type",
  "personCategory",
  "personCategoryLabel",
  "sourceUrl",
  "dataSource",
];
const PUBLIC_ALIAS_FIELDS = ["value", "type", "isPenName", "sources", "sourceKeys"];
const PUBLIC_OPTION_FIELDS = [
  "scope",
  "order",
  "orderLabel",
  "verifyDetails",
  "maxAliases",
  "maxPagesPerAlias",
  "perPage",
];
const PUBLIC_PROGRESS_FIELDS = [
  "status",
  "isComplete",
  "completedAliases",
  "totalAliases",
  "pagesFetched",
  "totalPageBudget",
  "updatedAt",
];
const PUBLIC_CACHE_READ_FIELDS = ["source", "isStale", "cachedAt"];
const PUBLIC_CACHE_REFRESH_FIELDS = ["status", "isRefreshing", "updatedAt"];
const PUBLIC_ITEM_FIELDS = [
  "productId",
  "title",
  "url",
  "image",
  "imageUrl",
  "circle",
  "circleUrl",
  "floor",
  "type",
  "typeLabel",
  "ageCategory",
  "ageLabel",
  "category",
  "priceJpy",
  "sales",
  "ratingCount",
  "matchedAliases",
  "matchedPages",
  "sourceOrder",
  "verification",
];

function pickFields(source, fields) {
  const result = {};
  for (const field of fields) {
    if (source?.[field] !== undefined) result[field] = source[field];
  }
  return result;
}

function publicPerson(person = {}) {
  const result = pickFields(person, PUBLIC_PERSON_FIELDS);
  if (Array.isArray(person.aliases)) {
    result.aliases = person.aliases.map((alias) => pickFields(alias, PUBLIC_ALIAS_FIELDS));
  }
  return result;
}

function publicWorkItem(item = {}) {
  return pickFields(item, PUBLIC_ITEM_FIELDS);
}

function publicCacheMetadata(cache = {}) {
  const result = {
    queryKey: normalizeSpace(cache.queryKey),
    queryVersion: normalizeSpace(cache.queryVersion),
    publicQuery: pickFields(cache.publicQuery ?? {}, PUBLIC_SEARCH_QUERY_FIELDS),
  };
  if (cache.read) result.read = pickFields(cache.read, PUBLIC_CACHE_READ_FIELDS);
  if (cache.refresh) result.refresh = pickFields(cache.refresh, PUBLIC_CACHE_REFRESH_FIELDS);
  return result;
}

export function buildPublicSearchCachePayload(payload = {}) {
  return {
    keyword: normalizeSpace(payload.keyword),
    person: publicPerson(payload.person),
    searchedAliases: Array.isArray(payload.searchedAliases) ? payload.searchedAliases.map(normalizeSpace) : [],
    options: pickFields(payload.options ?? {}, PUBLIC_OPTION_FIELDS),
    cache: publicCacheMetadata(payload.cache),
    timing: payload.timing ?? {},
    progress: pickFields(payload.progress ?? {}, PUBLIC_PROGRESS_FIELDS),
    total: Number(payload.total) || 0,
    items: Array.isArray(payload.items) ? payload.items.map(publicWorkItem) : [],
    order: normalizeSpace(payload.order),
    orderLabel: normalizeSpace(payload.orderLabel),
    groups: payload.groups ?? {},
    ageGroups: payload.ageGroups ?? {},
    aliasSummaries: Array.isArray(payload.aliasSummaries) ? payload.aliasSummaries : [],
    truncated: Boolean(payload.truncated),
    truncatedAliases: Array.isArray(payload.truncatedAliases) ? payload.truncatedAliases : [],
    errors: Array.isArray(payload.errors) ? payload.errors : [],
  };
}

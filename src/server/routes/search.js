import { getPerson, searchPersons } from "../../lib/bangumi.js";
import { normalizeSpace } from "../../lib/cache.js";
import { normalizeSearchOrder, searchOrderLabel } from "../../lib/dlsite.js";
import { applyLocalSearchOverlay } from "../../lib/localSearchOverlay.js";
import { createPublicSearchQuery, withSearchCacheRuntimeState } from "../../lib/searchCacheKey.js";
import { asyncHandler } from "../http.js";
import {
  readOptionalScope,
  readOptionalSearchOrder,
  readPerPage,
  readPersonWorkAge,
  readPersonWorkLimit,
  readPersonWorkSort,
  readPersonWorkType,
  readRequestedAliases,
  readScope,
  readSearchHistoryAliases,
  readSearchHistoryLimit,
  readSearchPageLimit,
} from "../query.js";

async function resolvePerson({ keyword, personId }) {
  if (personId) return getPerson(personId, keyword);

  const persons = await searchPersons(keyword, 10);
  const person = persons.persons[0];
  if (!person) {
    const error = new Error("Bangumi 没有找到候选人物。");
    error.statusCode = 404;
    throw error;
  }
  return person;
}

function aliasKey(value) {
  return normalizeSpace(value).normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function uniqueAliasValues(values, limit = 80) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const alias = normalizeSpace(value);
    const key = aliasKey(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeOptionalPersonId(value) {
  const personId = Number(value);
  return Number.isFinite(personId) && personId > 0 ? Math.trunc(personId) : null;
}

function readPersonAliasValues(person) {
  if (!Array.isArray(person?.aliases)) return [];
  return person.aliases.map((alias) => normalizeSpace(alias?.value ?? alias?.name ?? alias)).filter(Boolean);
}

function readPersonAliasMap(person) {
  const aliases = new Map();
  if (!Array.isArray(person?.aliases)) return aliases;
  for (const alias of person.aliases) {
    const value = normalizeSpace(alias?.value ?? alias?.name ?? alias);
    const key = aliasKey(value);
    if (!key) continue;
    aliases.set(key, typeof alias === "object" ? { ...alias, value } : { value });
  }
  return aliases;
}

function createManualSearchPerson({ keyword, personId = null, aliases = [], person = null }) {
  const sourcePerson = person && typeof person === "object" ? person : {};
  const sourceAliases = readPersonAliasMap(sourcePerson);
  const aliasValues = uniqueAliasValues([keyword, ...aliases, ...readPersonAliasValues(sourcePerson)]);
  const name = normalizeSpace(sourcePerson.name) || normalizeSpace(keyword) || aliasValues[0] || "";
  return {
    id: normalizeOptionalPersonId(sourcePerson.id ?? personId),
    name,
    image: normalizeSpace(sourcePerson.image),
    career: Array.isArray(sourcePerson.career) ? sourcePerson.career.map(normalizeSpace).filter(Boolean) : [],
    type: sourcePerson.type ?? null,
    personCategory: normalizeSpace(sourcePerson.personCategory),
    personCategoryLabel: normalizeSpace(sourcePerson.personCategoryLabel),
    sourceUrl: normalizeSpace(sourcePerson.sourceUrl),
    aliases: aliasValues.map((value, index) => ({
      ...(sourceAliases.get(aliasKey(value)) ?? {}),
      value,
      sources: sourceAliases.get(aliasKey(value))?.sources ?? [index === 0 ? "input" : "request"],
      sourceKeys: sourceAliases.get(aliasKey(value))?.sourceKeys ?? [index === 0 ? "input:keyword" : "request:alias"],
      isPenName: Boolean(sourceAliases.get(aliasKey(value))?.isPenName) || index === 0,
    })),
    dataSource: {
      kind: "manual_keyword",
      label: "Manual keyword",
    },
  };
}

function selectAliasValues(person, requestedAliases, maxAliases) {
  const allAliases = person.aliases ?? [];
  return uniqueAliasValues(
    requestedAliases.length ? requestedAliases : allAliases.map((alias) => alias.value).slice(0, maxAliases)
  );
}

async function resolveSearchPerson({ keyword, personId, requestedAliases, requestPerson }) {
  if (requestedAliases.length || !personId) {
    return createManualSearchPerson({ keyword, personId, aliases: requestedAliases, person: requestPerson });
  }

  try {
    return await resolvePerson({ keyword, personId });
  } catch (error) {
    if (!keyword) throw error;
    return createManualSearchPerson({ keyword, personId, aliases: requestedAliases, person: requestPerson });
  }
}

function readPreferCache(value) {
  return value === true || value === "true" || value === "1";
}

function readCachedSearchPayload(searchCache, queryKey) {
  if (!searchCache?.getSearchResult) return null;
  try {
    return searchCache.getSearchResult(queryKey);
  } catch {
    return null;
  }
}

function productIdKey(value) {
  return normalizeSpace(value).toUpperCase();
}

function payloadProductIdSet(payload = {}) {
  return new Set((payload.items ?? []).map((item) => productIdKey(item?.productId)).filter(Boolean));
}

function filterItemsByProductIds(items, productIds) {
  return (Array.isArray(items) ? items : []).filter((item) => productIds.has(productIdKey(item?.productId)));
}

function filterAccountListsByProductIds(lists = {}, productIds) {
  return Object.fromEntries(
    Object.entries(lists ?? {}).map(([listType, list]) => [
      listType,
      {
        ...list,
        productIds: (Array.isArray(list?.productIds) ? list.productIds : []).filter((productId) =>
          productIds.has(productIdKey(productId))
        ),
      },
    ])
  );
}

function annotationHasPrivateContext(annotation) {
  return Boolean(
    annotation?.updatedAt ||
      annotation?.createdAt ||
      annotation?.note ||
      annotation?.status ||
      (Array.isArray(annotation?.tags) && annotation.tags.length)
  );
}

function readCachedPayloadLocalOverlay(cachedPayload, monitor) {
  try {
    const productIds = payloadProductIdSet(cachedPayload);
    const accountSyncState = monitor?.getAccountSyncState?.() ?? {};
    const personId = cachedPayload?.person?.id ?? cachedPayload?.cache?.publicQuery?.personId;
    const subscription = personId ? monitor?.getPersonSubscription?.(personId) : null;

    return {
      watchlist: filterItemsByProductIds(monitor?.getWatchlist?.() ?? [], productIds),
      annotations: [...productIds]
        .map((productId) => monitor?.getWorkAnnotation?.(productId))
        .filter(annotationHasPrivateContext),
      account: monitor?.getAccountProfile?.() ?? {},
      accountLists: filterAccountListsByProductIds(accountSyncState.lists, productIds),
      subscriptions: subscription ? [subscription] : [],
    };
  } catch {
    return null;
  }
}

function cachePayloadWithBackgroundRefresh(cachedPayload, refreshPayload, monitor) {
  const refresh = refreshPayload?.cache?.refresh ?? {};
  const jobId = refresh.jobId || refreshPayload?.progress?.jobId || "";
  const status = refresh.status || refreshPayload?.progress?.status || "running";
  const localOverlay = readCachedPayloadLocalOverlay(cachedPayload, monitor);
  const overlaidPayload = localOverlay ? applyLocalSearchOverlay(cachedPayload, localOverlay) : cachedPayload;
  return {
    ...overlaidPayload,
    cache: withSearchCacheRuntimeState(cachedPayload.cache, {
      jobId,
      status,
      updatedAt: refresh.updatedAt ?? refreshPayload?.progress?.updatedAt ?? null,
    }),
    backgroundRefresh: {
      jobId,
      status,
    },
  };
}

function unavailableMoegirlProfile(error = null) {
  return {
    status: error ? "unavailable" : "not_found",
    sourceName: "萌娘百科",
    title: "",
    sourceUrl: "",
    summary: "",
    representativeText: "",
    notableWorks: [],
    matchedBy: "",
    fetchedAt: new Date().toISOString(),
    ...(error ? { error: error.message || "萌娘百科资料暂时无法读取。" } : {}),
  };
}

async function enrichPersonProfileWithMoegirl(profile, moegirl) {
  if (!moegirl?.findPersonProfile) return { ...profile, moegirl: unavailableMoegirlProfile() };
  try {
    const moegirlProfile = await moegirl.findPersonProfile({
      person: profile.person,
      aliases: profile.aliases,
    });
    return { ...profile, moegirl: moegirlProfile };
  } catch (error) {
    return { ...profile, moegirl: unavailableMoegirlProfile(error) };
  }
}

export function registerSearchRoutes(app, { monitor, searchHistory, searchJobStore, searchCache = null, moegirl = null }) {
  app.post(
    "/api/persons",
    asyncHandler(async (req, res) => {
      const keyword = normalizeSpace(req.body.keyword);
      if (!keyword) return res.status(400).json({ error: "请输入人物名。" });

      const result = await searchPersons(keyword, Number(req.body.limit) || 10, {
        personCategory: req.body.personCategory ?? req.body.category,
        careers: req.body.careers ?? req.body.career,
      });
      res.json(result);
    })
  );

  app.post(
    "/api/search/progressive",
    asyncHandler(async (req, res) => {
      const keyword = normalizeSpace(req.body.keyword);
      const personId = normalizeOptionalPersonId(req.body.personId);
      const maxAliases = Math.min(Math.max(Number(req.body.maxAliases) || 12, 1), 80);
      const maxPages = readSearchPageLimit(req.body.maxPagesPerAlias);
      const perPage = readPerPage(req.body.perPage);
      const scope = readScope(req.body.scope);
      const order = normalizeSearchOrder(req.body.order ?? req.body.sortOrder);
      const verifyDetails = Boolean(req.body.verifyDetails);
      const requestedAliases = uniqueAliasValues([keyword, ...readRequestedAliases(req.body.aliases)]);
      const requestPerson = req.body.person;

      if (!keyword && !personId) return res.status(400).json({ error: "请输入人物名。" });

      const person = await resolveSearchPerson({ keyword, personId, requestedAliases, requestPerson });
      const selectedAliasValues = selectAliasValues(person, requestedAliases, maxAliases);
      if (selectedAliasValues.length === 0) {
        return res.status(400).json({ error: "请至少选择一个别名。" });
      }

      const options = {
        scope,
        order,
        orderLabel: searchOrderLabel(order),
        verifyDetails,
        maxAliases,
        maxPagesPerAlias: maxPages,
        perPage,
      };

      const cache = createPublicSearchQuery({
        keyword,
        personId: person.id ?? personId,
        aliases: selectedAliasValues,
        scope,
        order,
      });
      const cachedPayload = readPreferCache(req.body.preferCache)
        ? readCachedSearchPayload(searchCache, cache.queryKey)
        : null;
      const payload = searchJobStore.create({
        keyword,
        person,
        selectedAliasValues,
        options,
        cache,
      });
      if (cachedPayload) return res.status(202).json(cachePayloadWithBackgroundRefresh(cachedPayload, payload, monitor));
      res.status(202).json(payload);
    })
  );

  app.get(
    "/api/search/progressive/:id",
    asyncHandler(async (req, res) => {
      const payload = searchJobStore.get(req.params.id);
      if (!payload) return res.status(404).json({ error: "搜索任务不存在或已过期。" });
      res.json(payload);
    })
  );

  app.get("/api/search/history", (req, res) => {
    res.json(
      searchHistory.listSearches({
        limit: readSearchHistoryLimit(req.query.limit),
        personId: req.query.personId,
        keyword: normalizeSpace(req.query.keyword),
        aliases: readSearchHistoryAliases(req.query.aliases ?? req.query.alias),
        order: readOptionalSearchOrder(req.query.order ?? req.query.sortOrder),
        scope: readOptionalScope(req.query.scope),
      })
    );
  });

  app.get(
    "/api/search/history/:id",
    asyncHandler(async (req, res) => {
      const payload = searchHistory.getSearch(req.params.id);
      if (!payload) return res.status(404).json({ error: "Search history not found." });
      res.json(payload);
    })
  );

  app.get("/api/persons/:id/searches", (req, res) => {
    res.json(
      searchHistory.getPersonSearches(req.params.id, {
        limit: readSearchHistoryLimit(req.query.limit),
        keyword: normalizeSpace(req.query.keyword),
        aliases: readSearchHistoryAliases(req.query.aliases ?? req.query.alias),
        order: readOptionalSearchOrder(req.query.order ?? req.query.sortOrder),
        scope: readOptionalScope(req.query.scope),
      })
    );
  });

  app.get(
    "/api/persons/:id/profile",
    asyncHandler(async (req, res) => {
      const payload = searchHistory.getPersonProfile(req.params.id, {
        recentLimit: readSearchHistoryLimit(req.query.limit),
      });
      if (!payload) return res.status(404).json({ error: "本地搜索历史中还没有这个人物。" });
      res.json(await enrichPersonProfileWithMoegirl(payload, moegirl));
    })
  );

  app.get(
    "/api/persons/:id/works",
    asyncHandler(async (req, res) => {
      const payload = searchHistory.getPersonWorks(req.params.id, {
        sort: readPersonWorkSort(req.query.sort),
        type: readPersonWorkType(req.query.type),
        age: readPersonWorkAge(req.query.age),
        sessionId: normalizeSpace(req.query.sessionId),
        limit: readPersonWorkLimit(req.query.limit),
      });
      if (!payload) return res.status(404).json({ error: "本地搜索历史中还没有这个人物。" });
      res.json(payload);
    })
  );

  app.put(
    "/api/persons/:id/subscription",
    asyncHandler(async (req, res) => {
      res.json(
        monitor.savePersonSubscription({
          personId: req.params.id,
          personName: req.body?.personName,
          personImage: req.body?.personImage,
          sourceUrl: req.body?.sourceUrl,
          keyword: req.body?.keyword,
          aliases: req.body?.aliases,
        })
      );
    })
  );

  app.delete("/api/persons/:id/subscription", (req, res) => {
    const deleted = monitor.deletePersonSubscription(req.params.id);
    res.json({ ok: true, deleted });
  });

  app.post(
    "/api/persons/:id/subscription/check",
    asyncHandler(async (req, res) => {
      const payload = await monitor.checkPersonSubscription(req.params.id, {
        reason: req.body?.reason || "manual",
      });
      res.json(payload);
    })
  );
}

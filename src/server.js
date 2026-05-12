import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPerson, searchPersons } from "./lib/bangumi.js";
import {
  DEFAULT_MAX_PAGES_PER_ALIAS,
  MAX_PAGES_PER_ALIAS,
  normalizeSearchOrder,
  searchOrderLabel,
} from "./lib/dlsite.js";
import { normalizeSpace } from "./lib/cache.js";
import { createDlsiteMonitor } from "./lib/monitor/service.js";
import { createSearchHistoryRepository } from "./lib/searchHistoryRepository.js";
import { createSearchJobStore } from "./lib/searchJobs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function readRequestedAliases(value) {
  return Array.isArray(value) ? value.map(normalizeSpace).filter(Boolean) : [];
}

function readScope(value) {
  const allowedScopes = new Set(["all", "adult", "nonAdult", "allR18"]);
  return allowedScopes.has(value) ? value : "all";
}

function readPerPage(value) {
  return Math.min(Math.max(Number(value) || 100, 10), 100);
}

function readSearchPageLimit(value) {
  return Math.min(Math.max(Number(value) || DEFAULT_MAX_PAGES_PER_ALIAS, 1), MAX_PAGES_PER_ALIAS);
}

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

function selectAliasValues(person, requestedAliases, maxAliases) {
  const allAliases = person.aliases ?? [];
  return [
    ...new Set(
      requestedAliases.length
        ? requestedAliases
        : allAliases.map((alias) => alias.value).slice(0, maxAliases)
    ),
  ].slice(0, 80);
}

function readRankingFloor(value) {
  return ["home", "maniax"].includes(value) ? value : "home";
}

function readRankingPeriod(value) {
  return ["day", "week", "month"].includes(value) ? value : "week";
}

function readRankingCategory(value) {
  return ["all", "voice", "game", "manga"].includes(value) ? value : "all";
}

function readAlertStatus(value) {
  return value === "all" ? "all" : "unread";
}

function readAlertLimit(value) {
  return Math.min(Math.max(Number(value) || 50, 1), 100);
}

function readActivityStatus(value) {
  return ["active", "all", "endingSoon", "unread"].includes(value) ? value : "active";
}

function readActivityBenefit(value) {
  const allowedBenefits = new Set(["all", "point", "coupon", "discount", "free", "bonus", "info"]);
  return allowedBenefits.has(value) ? value : "all";
}

function readActivityLimit(value) {
  return Math.min(Math.max(Number(value) || 50, 1), 100);
}

function readActivitySearch(value) {
  return normalizeSpace(value).slice(0, 120);
}

function readBooleanQuery(value) {
  return value === "1" || value === "true" || value === "yes";
}

function readAccountMaxPages(value) {
  return Math.min(Math.max(Number(value) || 3, 1), 10);
}

function readAccountSyncMode(value) {
  return value === "quick" ? "quick" : "full";
}

function readRecommendationLimit(value) {
  return Math.min(Math.max(Number(value) || 10, 1), 30);
}

function readActivityAlertSummaryLimit(value) {
  return Math.min(Math.max(Number(value) || 3, 1), 10);
}

function readSearchHistoryLimit(value) {
  return Math.min(Math.max(Number(value) || 20, 1), 100);
}

function readSearchHistoryAliases(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item ?? "").split(","))
    .map(normalizeSpace)
    .filter(Boolean);
}

function readOptionalSearchOrder(value) {
  return value ? normalizeSearchOrder(value) : "";
}

function readOptionalScope(value) {
  return value ? readScope(value) : "";
}

function readPersonWorkSort(value) {
  return value === "latest" ? "latest" : "hot";
}

function readPersonWorkType(value) {
  const allowedTypes = new Set(["all", "voice", "game", "manga", "cg", "video", "other"]);
  return allowedTypes.has(value) ? value : "all";
}

function readPersonWorkAge(value) {
  const allowedAges = new Set(["all", "r18", "general", "r15", "unknown"]);
  return allowedAges.has(value) ? value : "all";
}

function readPersonWorkLimit(value) {
  return Math.min(Math.max(Number(value) || 100, 1), 300);
}

export function createApp({ monitor = null, searchHistory = null, searchJobStore = null } = {}) {
  const resolvedSearchHistory = searchHistory ?? createSearchHistoryRepository();
  const resolvedMonitor = monitor ?? createDlsiteMonitor({ searchHistoryRepository: resolvedSearchHistory });
  const resolvedSearchJobStore =
    searchJobStore ?? createSearchJobStore({ searchHistoryRepository: resolvedSearchHistory });
  const app = express();

  app.use(express.json({ limit: "5mb" }));
  app.use("/vendor/chart.js", express.static(path.join(__dirname, "..", "node_modules", "chart.js", "dist")));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    "/api/persons",
    asyncHandler(async (req, res) => {
      const keyword = normalizeSpace(req.body.keyword);
      if (!keyword) return res.status(400).json({ error: "请输入声优名。" });

      const result = await searchPersons(keyword, Number(req.body.limit) || 10);
      res.json(result);
    })
  );

  app.post(
    "/api/search/progressive",
    asyncHandler(async (req, res) => {
      const keyword = normalizeSpace(req.body.keyword);
      const personId = Number(req.body.personId);
      const maxAliases = Math.min(Math.max(Number(req.body.maxAliases) || 12, 1), 80);
      const maxPages = readSearchPageLimit(req.body.maxPagesPerAlias);
      const perPage = readPerPage(req.body.perPage);
      const scope = readScope(req.body.scope);
      const order = normalizeSearchOrder(req.body.order ?? req.body.sortOrder);
      const verifyDetails = Boolean(req.body.verifyDetails);
      const requestedAliases = readRequestedAliases(req.body.aliases);

      if (!keyword && !personId) return res.status(400).json({ error: "请输入声优名。" });

      const person = await resolvePerson({ keyword, personId });
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

      const payload = resolvedSearchJobStore.create({
        keyword,
        person,
        selectedAliasValues,
        options,
      });
      res.status(202).json(payload);
    })
  );

  app.get(
    "/api/search/progressive/:id",
    asyncHandler(async (req, res) => {
      const payload = resolvedSearchJobStore.get(req.params.id);
      if (!payload) return res.status(404).json({ error: "搜索任务不存在或已过期。" });
      res.json(payload);
    })
  );

  app.get("/api/search/history", (req, res) => {
    res.json(
      resolvedSearchHistory.listSearches({
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
      const payload = resolvedSearchHistory.getSearch(req.params.id);
      if (!payload) return res.status(404).json({ error: "Search history not found." });
      res.json(payload);
    })
  );

  app.get("/api/persons/:id/searches", (req, res) => {
    res.json(
      resolvedSearchHistory.getPersonSearches(req.params.id, {
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
      const payload = resolvedSearchHistory.getPersonProfile(req.params.id, {
        recentLimit: readSearchHistoryLimit(req.query.limit),
      });
      if (!payload) return res.status(404).json({ error: "本地搜索历史中还没有这个人物。" });
      res.json(payload);
    })
  );

  app.get(
    "/api/persons/:id/works",
    asyncHandler(async (req, res) => {
      const payload = resolvedSearchHistory.getPersonWorks(req.params.id, {
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
        resolvedMonitor.savePersonSubscription({
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
    const deleted = resolvedMonitor.deletePersonSubscription(req.params.id);
    res.json({ ok: true, deleted });
  });

  app.post(
    "/api/persons/:id/subscription/check",
    asyncHandler(async (req, res) => {
      const payload = await resolvedMonitor.checkPersonSubscription(req.params.id, {
        reason: req.body?.reason || "manual",
      });
      res.json(payload);
    })
  );

  app.post(
    "/api/sync/dlsite-rankings",
    asyncHandler(async (req, res) => {
      const payload = resolvedMonitor.startSync({
        reason: "manual",
        priority: req.body?.priority ?? null,
      });
      res.status(payload.alreadyRunning ? 200 : 202).json(payload);
    })
  );

  app.get("/api/sync/status", (_req, res) => {
    res.json(resolvedMonitor.getStatus());
  });

  app.post(
    "/api/sync/dlsite-activities",
    asyncHandler(async (req, res) => {
      const payload = resolvedMonitor.startActivitySync({
        reason: req.body?.reason || "manual",
      });
      res.status(payload.alreadyRunning ? 200 : 202).json(payload);
    })
  );

  app.get("/api/activities/status", (_req, res) => {
    res.json(resolvedMonitor.getActivityStatus());
  });

  app.get("/api/dashboard/summary", (_req, res) => {
    res.json(resolvedMonitor.getDashboardSummary());
  });

  app.get("/api/activity-alerts/summary", (req, res) => {
    res.json(
      resolvedMonitor.getActivityAlertSummary({
        limit: readActivityAlertSummaryLimit(req.query.limit),
      })
    );
  });

  app.get("/api/activities", (req, res) => {
    res.json(
      resolvedMonitor.getActivities({
        status: readActivityStatus(req.query.status),
        benefit: readActivityBenefit(req.query.benefit),
        limit: readActivityLimit(req.query.limit),
        search: readActivitySearch(req.query.search),
        relatedOnly: readBooleanQuery(req.query.related),
      })
    );
  });

  app.get("/api/rankings", (req, res) => {
    res.json(
      resolvedMonitor.getRankings({
        floor: readRankingFloor(req.query.floor),
        period: readRankingPeriod(req.query.period),
        category: readRankingCategory(req.query.category),
      })
    );
  });

  app.get(
    "/api/works/:id/history",
    asyncHandler(async (req, res) => {
      const payload = resolvedMonitor.getWorkHistory(req.params.id);
      if (!payload) return res.status(404).json({ error: "作品尚未同步。" });
      res.json(payload);
    })
  );

  app.post(
    "/api/watchlist",
    asyncHandler(async (req, res) => {
      const productId = normalizeSpace(req.body.productId);
      if (!productId) return res.status(400).json({ error: "productId is required." });
      res.status(201).json(
        resolvedMonitor.addWatchlist({
          productId,
          targetPriceJpy: req.body.targetPriceJpy,
          note: req.body.note,
        })
      );
    })
  );

  app.post(
    "/api/watchlist/import",
    asyncHandler(async (req, res) => {
      const work = req.body.work ?? {};
      const productId = normalizeSpace(work.productId ?? req.body.productId);
      if (!productId) return res.status(400).json({ error: "productId is required." });
      res.status(201).json(
        resolvedMonitor.importWorkToWatchlist({
          work: {
            ...work,
            productId,
          },
          targetPriceJpy: req.body.targetPriceJpy,
          note: req.body.note,
        })
      );
    })
  );

  app.delete("/api/watchlist/:id", (req, res) => {
    const deleted = resolvedMonitor.deleteWatchlist(req.params.id);
    res.json({ ok: true, deleted });
  });

  app.get("/api/watchlist", (_req, res) => {
    res.json({ items: resolvedMonitor.getWatchlist() });
  });

  app.get("/api/works/:id/annotation", (req, res) => {
    res.json(resolvedMonitor.getWorkAnnotation(req.params.id));
  });

  app.put(
    "/api/works/:id/annotation",
    asyncHandler(async (req, res) => {
      res.json(
        resolvedMonitor.saveWorkAnnotation({
          productId: req.params.id,
          note: req.body?.note,
          tags: req.body?.tags,
          status: req.body?.status,
        })
      );
    })
  );

  app.delete("/api/works/:id/annotation", (req, res) => {
    const deleted = resolvedMonitor.deleteWorkAnnotation(req.params.id);
    res.json({ ok: true, deleted, annotation: resolvedMonitor.getWorkAnnotation(req.params.id) });
  });

  app.get("/api/alerts", (req, res) => {
    res.json({
      items: resolvedMonitor.getAlerts({
        status: readAlertStatus(req.query.status),
        limit: readAlertLimit(req.query.limit),
      }),
    });
  });

  app.post("/api/alerts/:id/read", (req, res) => {
    const updated = resolvedMonitor.markAlertRead(req.params.id);
    res.json({ ok: true, updated });
  });

  app.post("/api/activity-alerts/:id/read", (req, res) => {
    const updated = resolvedMonitor.markActivityAlertRead(req.params.id);
    res.json({ ok: true, updated });
  });

  app.get("/api/account/dlsite", (_req, res) => {
    res.json(resolvedMonitor.getAccountProfile());
  });

  app.get("/api/account/dlsite/sync-state", (_req, res) => {
    res.json(resolvedMonitor.getAccountSyncState());
  });

  app.post(
    "/api/account/dlsite/session",
    asyncHandler(async (req, res) => {
      const profile = resolvedMonitor.saveAccountSession({
        cookieHeader: req.body.cookieHeader,
        loginState: "pending",
      });

      if (req.body.syncNow === false) return res.status(201).json({ profile });

      const payload = await resolvedMonitor.syncAccount({ maxPages: readAccountMaxPages(req.body.maxPages) });
      res.status(201).json(payload);
    })
  );

  app.post(
    "/api/account/dlsite/sync",
    asyncHandler(async (req, res) => {
      const payload = await resolvedMonitor.syncAccount({ maxPages: readAccountMaxPages(req.body?.maxPages) });
      res.json(payload);
    })
  );

  app.post(
    "/api/account/dlsite/import-pages",
    asyncHandler(async (req, res) => {
      const payload = resolvedMonitor.importAccountPages({
        pages: req.body?.pages,
        syncMode: readAccountSyncMode(req.body?.syncMode),
      });
      res.json(payload);
    })
  );

  app.delete("/api/account/dlsite/session", (_req, res) => {
    res.json({ ok: true, profile: resolvedMonitor.clearAccountSession() });
  });

  app.get("/api/recommendations/affordable", (req, res) => {
    res.json(
      resolvedMonitor.getAffordableRecommendations({
        budgetJpy: req.query.budgetJpy,
        limit: readRecommendationLimit(req.query.limit),
        excludeCollection: req.query.excludeCollection !== "0",
      })
    );
  });

  app.get("/api/recommendations/bundles", (req, res) => {
    res.json(
      resolvedMonitor.getBundleRecommendations({
        budgetJpy: req.query.budgetJpy,
        limit: readRecommendationLimit(req.query.limit),
        excludeCollection: req.query.excludeCollection !== "0",
      })
    );
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || error.status || 500;
    if (statusCode >= 500) console.error(error);
    res.status(statusCode).json({
      error: error.message || "服务器内部错误。",
    });
  });

  return app;
}

export function startServer({ port = Number(process.env.PORT) || 5178 } = {}) {
  const searchHistory = createSearchHistoryRepository();
  const monitor = createDlsiteMonitor({ searchHistoryRepository: searchHistory });
  const app = createApp({ monitor, searchHistory });
  monitor.startDailyScheduler();
  return app.listen(port, () => {
    console.log(`KoeScope is running at http://localhost:${port}`);
  });
}

if (process.argv[1] === __filename) {
  startServer();
}

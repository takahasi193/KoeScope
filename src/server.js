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

function readAccountMaxPages(value) {
  return Math.min(Math.max(Number(value) || 3, 1), 10);
}

function readAccountSyncMode(value) {
  return value === "quick" ? "quick" : "full";
}

function readRecommendationLimit(value) {
  return Math.min(Math.max(Number(value) || 10, 1), 30);
}

export function createApp({
  monitor = createDlsiteMonitor(),
  searchJobStore = createSearchJobStore(),
} = {}) {
  const app = express();

  app.use(express.json({ limit: "5mb" }));
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

      const payload = searchJobStore.create({
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
      const payload = searchJobStore.get(req.params.id);
      if (!payload) return res.status(404).json({ error: "搜索任务不存在或已过期。" });
      res.json(payload);
    })
  );

  app.post(
    "/api/sync/dlsite-rankings",
    asyncHandler(async (req, res) => {
      const payload = monitor.startSync({
        reason: "manual",
        priority: req.body?.priority ?? null,
      });
      res.status(payload.alreadyRunning ? 200 : 202).json(payload);
    })
  );

  app.get("/api/sync/status", (_req, res) => {
    res.json(monitor.getStatus());
  });

  app.get("/api/dashboard/summary", (_req, res) => {
    res.json(monitor.getDashboardSummary());
  });

  app.get("/api/rankings", (req, res) => {
    res.json(
      monitor.getRankings({
        floor: readRankingFloor(req.query.floor),
        period: readRankingPeriod(req.query.period),
        category: readRankingCategory(req.query.category),
      })
    );
  });

  app.get(
    "/api/works/:id/history",
    asyncHandler(async (req, res) => {
      const payload = monitor.getWorkHistory(req.params.id);
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
        monitor.addWatchlist({
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
        monitor.importWorkToWatchlist({
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
    const deleted = monitor.deleteWatchlist(req.params.id);
    res.json({ ok: true, deleted });
  });

  app.get("/api/watchlist", (_req, res) => {
    res.json({ items: monitor.getWatchlist() });
  });

  app.get("/api/alerts", (req, res) => {
    res.json({ items: monitor.getAlerts({ status: readAlertStatus(req.query.status) }) });
  });

  app.post("/api/alerts/:id/read", (req, res) => {
    const updated = monitor.markAlertRead(req.params.id);
    res.json({ ok: true, updated });
  });

  app.get("/api/account/dlsite", (_req, res) => {
    res.json(monitor.getAccountProfile());
  });

  app.get("/api/account/dlsite/sync-state", (_req, res) => {
    res.json(monitor.getAccountSyncState());
  });

  app.post(
    "/api/account/dlsite/session",
    asyncHandler(async (req, res) => {
      const profile = monitor.saveAccountSession({
        cookieHeader: req.body.cookieHeader,
        loginState: "pending",
      });

      if (req.body.syncNow === false) return res.status(201).json({ profile });

      const payload = await monitor.syncAccount({ maxPages: readAccountMaxPages(req.body.maxPages) });
      res.status(201).json(payload);
    })
  );

  app.post(
    "/api/account/dlsite/sync",
    asyncHandler(async (req, res) => {
      const payload = await monitor.syncAccount({ maxPages: readAccountMaxPages(req.body?.maxPages) });
      res.json(payload);
    })
  );

  app.post(
    "/api/account/dlsite/import-pages",
    asyncHandler(async (req, res) => {
      const payload = monitor.importAccountPages({
        pages: req.body?.pages,
        syncMode: readAccountSyncMode(req.body?.syncMode),
      });
      res.json(payload);
    })
  );

  app.delete("/api/account/dlsite/session", (_req, res) => {
    res.json({ ok: true, profile: monitor.clearAccountSession() });
  });

  app.get("/api/recommendations/affordable", (req, res) => {
    res.json(
      monitor.getAffordableRecommendations({
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
  const monitor = createDlsiteMonitor();
  const app = createApp({ monitor });
  monitor.startDailyScheduler();
  return app.listen(port, () => {
    console.log(`DL Voice Search is running at http://localhost:${port}`);
  });
}

if (process.argv[1] === __filename) {
  startServer();
}

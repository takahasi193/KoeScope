import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDlsiteMonitor } from "./lib/monitor/service.js";
import { createPublicSearchCacheRepository } from "./lib/publicSearchCacheRepository.js";
import { createSearchHistoryRepository } from "./lib/searchHistoryRepository.js";
import { createSearchJobStore } from "./lib/searchJobs.js";
import { registerErrorHandler } from "./server/http.js";
import { registerAccountRoutes } from "./server/routes/account.js";
import { registerActivityRoutes } from "./server/routes/activity.js";
import { registerMaintenanceRoutes } from "./server/routes/maintenance.js";
import { registerMonitorRoutes } from "./server/routes/monitor.js";
import { registerSearchRoutes } from "./server/routes/search.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "public");

function getNextOutRoot() {
  return process.env.KOESCOPE_NEXT_OUT || path.join(PROJECT_ROOT, "web", "out");
}

export function resolveFrontendPage(outRoot, pageName) {
  const normalized = pageName === "index" ? "index" : String(pageName).replace(/\.html$/i, "");
  const candidates =
    normalized === "index"
      ? [path.join(outRoot, "index.html")]
      : [path.join(outRoot, `${normalized}.html`), path.join(outRoot, normalized, "index.html")];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function sendFrontendPage(outRoot, pageName, res, next) {
  const filePath = resolveFrontendPage(outRoot, pageName);
  if (!filePath) return next();
  return res.sendFile(filePath);
}

function sendExportedPagePayload(outRoot, pageName, res, next) {
  const filePath = path.join(outRoot, pageName, `__next.${pageName}`, "__PAGE__.txt");
  if (!fs.existsSync(filePath)) return next();
  return res.sendFile(filePath);
}

function mountFrontend(app) {
  const nextOutRoot = getNextOutRoot();
  if (fs.existsSync(nextOutRoot)) {
    app.use(
      express.static(nextOutRoot, {
        extensions: ["html"],
        fallthrough: true,
      })
    );
    app.get(["/", "/index.html"], (_req, res, next) => sendFrontendPage(nextOutRoot, "index", res, next));
    app.get(["/person", "/person.html"], (_req, res, next) => sendFrontendPage(nextOutRoot, "person", res, next));
    app.get(["/dashboard", "/dashboard.html"], (_req, res, next) =>
      sendFrontendPage(nextOutRoot, "dashboard", res, next)
    );
    app.get(["/activities", "/activities.html"], (_req, res, next) =>
      sendFrontendPage(nextOutRoot, "activities", res, next)
    );
    for (const pageName of ["person", "dashboard", "activities"]) {
      app.get(`/${pageName}/__next.${pageName}.__PAGE__.txt`, (_req, res, next) =>
        sendExportedPagePayload(nextOutRoot, pageName, res, next)
      );
    }
  }

  app.use(express.static(PUBLIC_ROOT));
}

export function createApp({ monitor = null, searchHistory = null, searchJobStore = null, searchCache = null } = {}) {
  const resolvedSearchHistory = searchHistory ?? createSearchHistoryRepository();
  const resolvedSearchCache =
    searchCache ?? (resolvedSearchHistory?.db ? createPublicSearchCacheRepository({ db: resolvedSearchHistory.db }) : null);
  const resolvedMonitor = monitor ?? createDlsiteMonitor({ searchHistoryRepository: resolvedSearchHistory });
  const resolvedSearchJobStore =
    searchJobStore ??
    createSearchJobStore({
      searchHistoryRepository: resolvedSearchHistory,
      searchCacheRepository: resolvedSearchCache,
    });
  const app = express();

  app.use(express.json({ limit: "5mb" }));
  app.use("/vendor/chart.js", express.static(path.join(PROJECT_ROOT, "node_modules", "chart.js", "dist")));
  mountFrontend(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  registerSearchRoutes(app, {
    monitor: resolvedMonitor,
    searchHistory: resolvedSearchHistory,
    searchJobStore: resolvedSearchJobStore,
  });
  registerMonitorRoutes(app, { monitor: resolvedMonitor });
  registerActivityRoutes(app, { monitor: resolvedMonitor });
  registerAccountRoutes(app, { monitor: resolvedMonitor });
  registerMaintenanceRoutes(app, { monitor: resolvedMonitor, searchHistory: resolvedSearchHistory });
  registerErrorHandler(app);

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

import { normalizeSpace } from "../../lib/cache.js";
import { buildDashboardState } from "../dashboardState.js";
import { asyncHandler } from "../http.js";
import {
  readAlertLimit,
  readAlertStatus,
  readRankingCategory,
  readRankingFloor,
  readRankingPeriod,
  readRecommendationLimit,
} from "../query.js";

export function registerMonitorRoutes(app, { monitor }) {
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

  app.get("/api/dashboard/state", (req, res) => {
    res.json(buildDashboardState(monitor, req.query));
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

  app.get("/api/works/:id/annotation", (req, res) => {
    res.json(monitor.getWorkAnnotation(req.params.id));
  });

  app.put(
    "/api/works/:id/annotation",
    asyncHandler(async (req, res) => {
      res.json(
        monitor.saveWorkAnnotation({
          productId: req.params.id,
          note: req.body?.note,
          tags: req.body?.tags,
          status: req.body?.status,
        })
      );
    })
  );

  app.delete("/api/works/:id/annotation", (req, res) => {
    const deleted = monitor.deleteWorkAnnotation(req.params.id);
    res.json({ ok: true, deleted, annotation: monitor.getWorkAnnotation(req.params.id) });
  });

  app.get("/api/alerts", (req, res) => {
    res.json({
      items: monitor.getAlerts({
        status: readAlertStatus(req.query.status),
        limit: readAlertLimit(req.query.limit),
      }),
    });
  });

  app.post("/api/alerts/:id/read", (req, res) => {
    const updated = monitor.markAlertRead(req.params.id);
    res.json({ ok: true, updated });
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

  app.get("/api/recommendations/bundles", (req, res) => {
    res.json(
      monitor.getBundleRecommendations({
        budgetJpy: req.query.budgetJpy,
        limit: readRecommendationLimit(req.query.limit),
        excludeCollection: req.query.excludeCollection !== "0",
      })
    );
  });
}

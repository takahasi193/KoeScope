import { asyncHandler } from "../http.js";
import {
  readActivityAlertSummaryLimit,
  readActivityBenefit,
  readActivityLimit,
  readActivitySearch,
  readActivityStatus,
  readBooleanQuery,
} from "../query.js";

export function registerActivityRoutes(app, { monitor }) {
  app.post(
    "/api/sync/dlsite-activities",
    asyncHandler(async (req, res) => {
      const payload = monitor.startActivitySync({
        reason: req.body?.reason || "manual",
      });
      res.status(payload.alreadyRunning ? 200 : 202).json(payload);
    })
  );

  app.get("/api/activities/status", (_req, res) => {
    res.json(monitor.getActivityStatus());
  });

  app.get("/api/activity-alerts/summary", (req, res) => {
    res.json(
      monitor.getActivityAlertSummary({
        limit: readActivityAlertSummaryLimit(req.query.limit),
      })
    );
  });

  app.get("/api/activities", (req, res) => {
    res.json(
      monitor.getActivities({
        status: readActivityStatus(req.query.status),
        benefit: readActivityBenefit(req.query.benefit),
        limit: readActivityLimit(req.query.limit),
        search: readActivitySearch(req.query.search),
        relatedOnly: readBooleanQuery(req.query.related),
      })
    );
  });

  app.post("/api/activity-alerts/:id/read", (req, res) => {
    const updated = monitor.markActivityAlertRead(req.params.id);
    res.json({ ok: true, updated });
  });
}

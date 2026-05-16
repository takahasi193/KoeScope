import { asyncHandler } from "../http.js";
import { readAccountMaxPages, readAccountSyncMode } from "../query.js";

export function registerAccountRoutes(app, { monitor }) {
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
}

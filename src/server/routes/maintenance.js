import { asyncHandler } from "../http.js";
import {
  readImageCacheMaxBytes,
  readImageCacheRetentionDays,
  readMaintenanceDryRun,
  readMaintenanceRetentionDays,
  readSearchHistoryCleanupKeepLimit,
  readSearchHistoryCleanupRetentionDays,
} from "../query.js";

function readImageCacheCleanupOptions(payload = {}, { dryRun = true } = {}) {
  return {
    dryRun: readMaintenanceDryRun(payload.dryRun ?? dryRun),
    retentionDays: readImageCacheRetentionDays(payload.retentionDays),
    maxBytes: readImageCacheMaxBytes(payload.maxBytes),
  };
}

function readSearchHistoryCleanupOptions(payload = {}, { dryRun = true } = {}) {
  return {
    dryRun: readMaintenanceDryRun(payload.dryRun ?? dryRun),
    retentionDays: readSearchHistoryCleanupRetentionDays(payload.retentionDays),
    keepPerPerson: readSearchHistoryCleanupKeepLimit(payload.keepPerPerson),
    keepAnonymous: readSearchHistoryCleanupKeepLimit(payload.keepAnonymous),
  };
}

export function registerMaintenanceRoutes(app, { monitor, searchHistory }) {
  app.get("/api/maintenance/snapshot-cleanup", (req, res) => {
    res.json(
      monitor.runSnapshotCleanup({
        dryRun: true,
        retentionDays: readMaintenanceRetentionDays(req.query.retentionDays),
      })
    );
  });

  app.post("/api/maintenance/snapshot-cleanup", (req, res) => {
    res.json(
      monitor.runSnapshotCleanup({
        dryRun: readMaintenanceDryRun(req.body?.dryRun),
        retentionDays: readMaintenanceRetentionDays(req.body?.retentionDays),
      })
    );
  });

  app.get(
    "/api/maintenance/image-cache",
    asyncHandler(async (req, res) => {
      res.json(await monitor.runImageCacheCleanup(readImageCacheCleanupOptions(req.query, { dryRun: true })));
    })
  );

  app.post(
    "/api/maintenance/image-cache",
    asyncHandler(async (req, res) => {
      res.json(await monitor.runImageCacheCleanup(readImageCacheCleanupOptions(req.body, { dryRun: true })));
    })
  );

  app.get(
    "/api/maintenance/search-history",
    asyncHandler(async (req, res) => {
      res.json(searchHistory.runSearchHistoryCleanup(readSearchHistoryCleanupOptions(req.query, { dryRun: true })));
    })
  );

  app.post(
    "/api/maintenance/search-history",
    asyncHandler(async (req, res) => {
      res.json(searchHistory.runSearchHistoryCleanup(readSearchHistoryCleanupOptions(req.body, { dryRun: true })));
    })
  );
}

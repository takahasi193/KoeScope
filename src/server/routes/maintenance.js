import { readMaintenanceDryRun, readMaintenanceRetentionDays } from "../query.js";

export function registerMaintenanceRoutes(app, { monitor }) {
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
}

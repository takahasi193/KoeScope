import { readDashboardStateQuery } from "./query.js";

export function buildDashboardState(monitor, rawQuery = {}) {
  const query = readDashboardStateQuery(rawQuery);
  return {
    summary: monitor.getDashboardSummary(),
    syncStatus: monitor.getStatus(),
    activityStatus: monitor.getActivityStatus(),
    activities: monitor.getActivities({
      status: "active",
      benefit: "all",
      limit: query.activityLimit,
    }),
    activityAlerts: monitor.getActivityAlertSummary({ limit: 5 }),
    rankings: monitor.getRankings({
      floor: query.floor,
      period: query.period,
      category: query.category,
    }),
    alerts: {
      items: monitor.getAlerts({
        status: query.alertsStatus,
        limit: query.alertLimit,
      }),
    },
    watchlist: { items: monitor.getWatchlist() },
    account: monitor.getAccountProfile(),
    recommendations: monitor.getAffordableRecommendations({ limit: 8 }),
    bundles: monitor.getBundleRecommendations({ limit: 4 }),
    maintenance: monitor.runSnapshotCleanup({
      dryRun: true,
      retentionDays: query.retentionDays,
    }),
  };
}

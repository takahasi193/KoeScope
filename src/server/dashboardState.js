import { readDashboardStateQuery } from "./query.js";

function sectionIsEnabled(sections, section) {
  return sections === null || sections.has(section);
}

export function buildDashboardState(monitor, rawQuery = {}) {
  const query = readDashboardStateQuery(rawQuery);
  const { sections } = query;
  const state = {};

  if (sectionIsEnabled(sections, "summary")) {
    state.summary = monitor.getDashboardSummary();
  }
  if (sectionIsEnabled(sections, "statuses")) {
    state.syncStatus = monitor.getStatus();
    state.activityStatus = monitor.getActivityStatus();
  }
  if (sectionIsEnabled(sections, "activities")) {
    state.activities = monitor.getActivities({
      status: "active",
      benefit: "all",
      limit: query.activityLimit,
    });
  }
  if (sectionIsEnabled(sections, "activityAlerts")) {
    state.activityAlerts = monitor.getActivityAlertSummary({ limit: 5 });
  }
  if (sectionIsEnabled(sections, "rankings")) {
    state.rankings = monitor.getRankings({
      floor: query.floor,
      period: query.period,
      category: query.category,
    });
  }
  if (sectionIsEnabled(sections, "alerts")) {
    state.alerts = {
      items: monitor.getAlerts({
        status: query.alertsStatus,
        limit: query.alertLimit,
      }),
    };
  }
  if (sectionIsEnabled(sections, "watchlist")) {
    state.watchlist = { items: monitor.getWatchlist() };
  }
  if (sectionIsEnabled(sections, "account")) {
    state.account = monitor.getAccountProfile();
  }
  if (sectionIsEnabled(sections, "recommendations")) {
    state.recommendations = monitor.getAffordableRecommendations({ limit: 8 });
  }
  if (sectionIsEnabled(sections, "bundles")) {
    state.bundles = monitor.getBundleRecommendations({ limit: 4 });
  }
  if (sectionIsEnabled(sections, "maintenance")) {
    state.maintenance = monitor.runSnapshotCleanup({
      dryRun: true,
      retentionDays: query.retentionDays,
    });
  }

  return state;
}

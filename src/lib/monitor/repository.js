import { createAccountRepository } from "./db/accountRepository.js";
import { createActivitiesRepository } from "./db/activitiesRepository.js";
import { createAlertsRepository } from "./db/alertsRepository.js";
import { openMonitorDatabase } from "./db/connection.js";
import { createRankingsRepository } from "./db/rankingsRepository.js";
import { prepareMonitorStatements } from "./db/statements.js";
import { createWatchlistRepository } from "./db/watchlistRepository.js";
import { createWorksRepository } from "./db/worksRepository.js";

export function createMonitorRepository(options = {}) {
  const db = openMonitorDatabase(options);
  const statements = prepareMonitorStatements(db);

  const works = createWorksRepository({ db, statements });
  const rankings = createRankingsRepository({ db, statements });
  const account = createAccountRepository({ db, statements });
  const activities = createActivitiesRepository({
    db,
    statements,
    getAccountProfile: account.getAccountProfile,
  });
  const alerts = createAlertsRepository({ db, statements });
  const watchlist = createWatchlistRepository({
    db,
    statements,
    saveImportedWork: works.saveImportedWork,
  });

  function getDashboardSummary() {
    const workStats = works.getWorkStats();
    const watchStats = watchlist.getWatchStats();
    const unreadAlerts = alerts.getUnreadAlertCount();
    const latestRun = rankings.getLatestSyncRun();
    const notableDrops = works.getNotablePriceDrops(8);
    const activityStats = activities.getActivityDashboardStats();
    const activityMatchStats = activities.getActivityWorkMatchSummary();

    return {
      totalWorks: workStats.totalWorks ?? 0,
      pricedWorks: workStats.pricedWorks ?? 0,
      discountedWorks: workStats.discountedWorks ?? 0,
      watchedWorks: watchStats.watchedWorks ?? 0,
      unreadAlerts,
      ...activityStats,
      activityWorkMatches: activityMatchStats.totalMatches,
      activityMatchedWorks: activityMatchStats.matchedWorks,
      activityMatchedActivities: activityMatchStats.matchedActivities,
      activityFollowedWorks: activityMatchStats.followedWorks,
      latestRun,
      notableDrops,
    };
  }

  function close() {
    db.close();
  }

  return {
    db,
    createSyncRun: rankings.createSyncRun,
    updateSyncRun: rankings.updateSyncRun,
    getSyncRun: rankings.getSyncRun,
    getLatestSyncRun: rankings.getLatestSyncRun,
    createActivitySyncRun: activities.createActivitySyncRun,
    updateActivitySyncRun: activities.updateActivitySyncRun,
    getActivitySyncRun: activities.getActivitySyncRun,
    getLatestActivitySyncRun: activities.getLatestActivitySyncRun,
    saveSyncedProducts: works.saveSyncedProducts,
    saveActivities: activities.saveActivities,
    getDashboardSummary,
    getActivities: activities.getActivities,
    getActivityAlertSummary: activities.getActivityAlertSummary,
    getActivityPersonalSummary: activities.getActivityPersonalSummary,
    getRankings: rankings.getRankings,
    getWorkHistory: works.getWorkHistory,
    addWatchlist: watchlist.addWatchlist,
    importWorkToWatchlist: watchlist.importWorkToWatchlist,
    deleteWatchlist: watchlist.deleteWatchlist,
    getWatchlist: watchlist.getWatchlist,
    getAlerts: alerts.getAlerts,
    markAlertRead: alerts.markAlertRead,
    markActivityAlertRead: activities.markActivityAlertRead,
    saveAccountSession: account.saveAccountSession,
    saveAccountSyncResult: account.saveAccountSyncResult,
    getAccountProfile: account.getAccountProfile,
    getAccountSyncState: account.getAccountSyncState,
    clearAccountSession: account.clearAccountSession,
    getAffordableRecommendations: account.getAffordableRecommendations,
    close,
  };
}

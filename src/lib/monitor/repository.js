import { createAccountRepository } from "./db/accountRepository.js";
import { createAnnotationsRepository } from "./db/annotationsRepository.js";
import { createActivitiesRepository } from "./db/activitiesRepository.js";
import { createAlertsRepository } from "./db/alertsRepository.js";
import { openMonitorDatabase } from "./db/connection.js";
import { createMaintenanceRepository } from "./db/maintenanceRepository.js";
import { createRankingsRepository } from "./db/rankingsRepository.js";
import { prepareMonitorStatements } from "./db/statements.js";
import { createSubscriptionsRepository } from "./db/subscriptionsRepository.js";
import { createWatchlistRepository } from "./db/watchlistRepository.js";
import { createWorksRepository } from "./db/worksRepository.js";

export function createMonitorRepository(options = {}) {
  const db = openMonitorDatabase(options);
  const statements = prepareMonitorStatements(db);

  const works = createWorksRepository({ db, statements });
  const rankings = createRankingsRepository({ db, statements });
  const account = createAccountRepository({ db, statements });
  const annotations = createAnnotationsRepository({ db, statements });
  const activities = createActivitiesRepository({
    db,
    statements,
    getAccountProfile: account.getAccountProfile,
  });
  const alerts = createAlertsRepository({ db, statements });
  const maintenance = createMaintenanceRepository({ db });
  const watchlist = createWatchlistRepository({
    db,
    statements,
    saveImportedWork: works.saveImportedWork,
  });
  const subscriptions = createSubscriptionsRepository({
    db,
    statements,
  });

  function getDashboardSummary() {
    const workStats = works.getWorkStats();
    const watchStats = watchlist.getWatchStats();
    const unreadAlerts = alerts.getUnreadAlertCount();
    const latestRun = rankings.getLatestSyncRun();
    const notableDrops = works.getNotablePriceDrops(8);
    const activityStats = activities.getActivityDashboardStats();
    const activityMatchStats = activities.getActivityWorkMatchSummary();
    const subscriptionStats = subscriptions.getSubscriptionStats();

    return {
      totalWorks: workStats.totalWorks ?? 0,
      pricedWorks: workStats.pricedWorks ?? 0,
      discountedWorks: workStats.discountedWorks ?? 0,
      watchedWorks: watchStats.watchedWorks ?? 0,
      unreadAlerts,
      subscribedPersons: subscriptionStats.subscribedPersons ?? 0,
      ...activityStats,
      activityWorkMatches: activityMatchStats.totalMatches,
      activityMatchedWorks: activityMatchStats.matchedWorks,
      activityMatchedActivities: activityMatchStats.matchedActivities,
      activityFollowedWorks: activityMatchStats.followedWorks,
      latestRun,
      notableDrops,
    };
  }

  function getImageCacheReferences() {
    const workRows = db
      .prepare("SELECT image_url AS imageUrl FROM works WHERE image_url IS NOT NULL AND image_url <> ''")
      .all();
    const activityRows = db
      .prepare("SELECT image_url AS imageUrl FROM activities WHERE image_url IS NOT NULL AND image_url <> ''")
      .all();

    return {
      work: workRows.map((row) => row.imageUrl).filter(Boolean),
      activity: activityRows.map((row) => row.imageUrl).filter(Boolean),
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
    saveImportedWork: works.saveImportedWork,
    saveActivities: activities.saveActivities,
    getDashboardSummary,
    getImageCacheReferences,
    getActivities: activities.getActivities,
    getActivityAlertSummary: activities.getActivityAlertSummary,
    getActivityPersonalSummary: activities.getActivityPersonalSummary,
    getRankings: rankings.getRankings,
    getWorkHistory: works.getWorkHistory,
    addWatchlist: watchlist.addWatchlist,
    importWorkToWatchlist: watchlist.importWorkToWatchlist,
    deleteWatchlist: watchlist.deleteWatchlist,
    getWatchlist: watchlist.getWatchlist,
    getWorkAnnotation: annotations.getWorkAnnotation,
    saveWorkAnnotation: annotations.saveWorkAnnotation,
    deleteWorkAnnotation: annotations.deleteWorkAnnotation,
    getPersonSubscription: subscriptions.getPersonSubscription,
    savePersonSubscription: subscriptions.savePersonSubscription,
    deletePersonSubscription: subscriptions.deletePersonSubscription,
    listDuePersonSubscriptions: subscriptions.listDuePersonSubscriptions,
    updatePersonSubscriptionCheck: subscriptions.updatePersonSubscriptionCheck,
    createPossibleNewWorkAlert: subscriptions.createPossibleNewWorkAlert,
    getAlerts: alerts.getAlerts,
    markAlertRead: alerts.markAlertRead,
    markActivityAlertRead: activities.markActivityAlertRead,
    saveAccountSession: account.saveAccountSession,
    saveAccountSyncResult: account.saveAccountSyncResult,
    getAccountProfile: account.getAccountProfile,
    getAccountSyncState: account.getAccountSyncState,
    clearAccountSession: account.clearAccountSession,
    getAffordableRecommendations: account.getAffordableRecommendations,
    getBundleRecommendations: account.getBundleRecommendations,
    runSnapshotCleanup: maintenance.runSnapshotCleanup,
    close,
  };
}

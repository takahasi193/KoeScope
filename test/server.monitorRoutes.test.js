import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server.js";

function createMockMonitor({ calls = null } = {}) {
  let annotation = { note: "", tags: [], status: "", createdAt: null, updatedAt: null };
  let subscription = null;
  function count(name) {
    if (!calls) return;
    calls[name] = (calls[name] ?? 0) + 1;
  }
  return {
    startSync: () => ({ alreadyRunning: false, run: { id: 1, status: "running" } }),
    startActivitySync: () => ({ alreadyRunning: false, run: { id: 2, status: "running" } }),
    getStatus: () => {
      count("getStatus");
      return { running: false, latestRun: null, nextScheduledAt: "2026-05-09T00:00:00.000Z" };
    },
    getActivityStatus: () => {
      count("getActivityStatus");
      return { running: false, latestRun: null, nextScheduledAt: "2026-05-09T06:00:00.000Z" };
    },
    getDashboardSummary: () => {
      count("getDashboardSummary");
      return { totalWorks: 0, unreadAlerts: 0, activeActivities: 1, unreadActivityAlerts: 1, notableDrops: [] };
    },
    getActivityAlertSummary: ({ limit }) => ({
      ...(count("getActivityAlertSummary") ?? {}),
      generatedAt: "2026-05-10T00:00:00.000Z",
      activeActivities: 2,
      endingSoonActivities: 1,
      unreadCount: 2,
      unreadActivityAlerts: 2,
      typeCounts: { new_activity: 1, ending_soon: 1 },
      items: [
        {
          id: 11,
          activityId: "dlsite:1",
          type: "ending_soon",
          message: "即将结束：Campaign",
          activityTitle: "Campaign",
        },
      ].slice(0, limit),
    }),
    getActivities: (query) => {
      count("getActivities");
      return {
        ...query,
        generatedAt: "2026-05-10T00:00:00.000Z",
        unreadCount: 1,
        account: { hasSession: false, pointsJpy: null },
        personalSummary: {
          syncState: "disconnected",
          activeBenefitCounts: { coupon: 1, all: 1 },
          relatedWorks: { totalMatches: 1, claimsEntitlement: false },
          entrypoints: [{ benefit: "coupon", count: 1, claimsEntitlement: false }],
        },
        activityMatches: { totalMatches: 1, claimsEntitlement: false },
        filters: query,
        items: [
          {
            activityId: "dlsite:1",
            benefitType: query.benefit,
            title: "Campaign",
            relatedWorks: [{ productId: "RJ100001", claimsEntitlement: false }],
          },
        ],
      };
    },
    getRankings: (query) => {
      count("getRankings");
      return { ...query, capturedAt: null, items: [] };
    },
    getWorkHistory: () => null,
    addWatchlist: ({ productId }) => ({ productId, targetPriceJpy: null }),
    importWorkToWatchlist: ({ work }) => ({ productId: work.productId, targetPriceJpy: null }),
    deleteWatchlist: () => true,
    getWatchlist: () => {
      count("getWatchlist");
      return [];
    },
    getWorkAnnotation: (productId) => ({ productId: String(productId).toUpperCase(), ...annotation }),
    saveWorkAnnotation: ({ productId, note, tags, status }) => {
      annotation = {
        note: String(note ?? "").trim(),
        tags: Array.isArray(tags) ? tags : [],
        status: status || "",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      };
      return { productId: String(productId).toUpperCase(), ...annotation };
    },
    deleteWorkAnnotation: () => {
      annotation = { note: "", tags: [], status: "", createdAt: null, updatedAt: null };
      return true;
    },
    getPersonSubscription: () => subscription,
    savePersonSubscription: ({ personId, personName, aliases = [], keyword = "" }) => {
      subscription = {
        personId: Number(personId),
        personName,
        aliases,
        keyword,
        lastCheckStatus: "idle",
        lastCheckedAt: null,
        lastError: "",
        lastNewItemCount: 0,
      };
      return subscription;
    },
    deletePersonSubscription: () => {
      const hadSubscription = Boolean(subscription);
      subscription = null;
      return hadSubscription;
    },
    checkPersonSubscription: async (personId) => ({
      personId: Number(personId),
      newAlertCount: 1,
      resultCount: 2,
      newItems: [{ productId: "RJ200001", title: "Fresh Voice" }],
      subscription: {
        ...(subscription ?? { personId: Number(personId), personName: "Aoyama Yukari", aliases: ["Aoyama Yukari"] }),
        lastCheckStatus: "completed",
        lastCheckedAt: "2026-05-12T00:00:00.000Z",
        lastNewItemCount: 1,
      },
    }),
    getAlerts: () => {
      count("getAlerts");
      return [];
    },
    markAlertRead: () => true,
    markActivityAlertRead: () => true,
    getAccountProfile: () => {
      count("getAccountProfile");
      return { hasSession: false, pointsJpy: null, lists: {} };
    },
    getAccountSyncState: () => ({ generatedAt: "2026-05-10T00:00:00.000Z", lists: { wishlist: { count: 1, productIds: ["RJ100001"] } } }),
    saveAccountSession: () => ({ hasSession: true, pointsJpy: null, lists: {} }),
    syncAccount: () => ({ profile: { hasSession: true, pointsJpy: 1000, lists: {} }, lists: [] }),
    importAccountPages: () => ({ profile: { hasSession: true, pointsJpy: 1000, lists: {} }, lists: [] }),
    clearAccountSession: () => ({ hasSession: false, pointsJpy: null, lists: {} }),
    getAffordableRecommendations: () => {
      count("getAffordableRecommendations");
      return { budgetJpy: 1000, items: [] };
    },
    getBundleRecommendations: () => {
      count("getBundleRecommendations");
      return {
        budgetJpy: 1000,
        items: [{ circle: "Local Circle", totalPriceJpy: 900, itemCount: 2, claimsCheckoutOptimization: false }],
        disclaimer: "Local public-price analysis only.",
      };
    },
    runSnapshotCleanup: ({ dryRun, retentionDays = 365 }) => {
      count("runSnapshotCleanup");
      return {
        dryRun,
        retentionDays,
        cutoffAt: "2025-05-12T00:00:00.000Z",
        priceSnapshots: { olderThanCutoff: 2, protectedOlder: 1, deletable: 1, deleted: dryRun ? 0 : 1 },
        rankingSnapshots: { olderThanCutoff: 3, protectedOlder: 1, deletable: 2, deleted: dryRun ? 0 : 2 },
        totalDeletable: 3,
        totalDeleted: dryRun ? 0 : 3,
        optimization: { pragmaOptimize: !dryRun, vacuum: false },
      };
    },
    runImageCacheCleanup: ({ dryRun, retentionDays = 30, maxBytes = 536870912 }) => {
      count("runImageCacheCleanup");
      return {
        dryRun,
        retentionDays,
        maxBytes,
        cutoffAt: "2026-04-16T00:00:00.000Z",
        totalFiles: 2,
        totalBytes: 30,
        protectedFiles: 1,
        protectedBytes: 20,
        unreferencedFiles: 1,
        oldUnreferencedFiles: 1,
        deletableFiles: 1,
        deletableBytes: 10,
        deletedFiles: dryRun ? 0 : 1,
        deletedBytes: dryRun ? 0 : 10,
      };
    },
  };
}

function createMockSearchHistory() {
  return {
    listSearches: () => ({ items: [] }),
    getSearch: () => null,
    getPersonSearches: () => ({ items: [] }),
    getPersonProfile: () => null,
    getPersonWorks: () => null,
    runSearchHistoryCleanup: ({ dryRun, retentionDays = 180, keepPerPerson = 20, keepAnonymous = 20 }) => ({
      dryRun,
      retentionDays,
      keepPerPerson,
      keepAnonymous,
      cutoffAt: "2025-11-17T00:00:00.000Z",
      oldSessions: 9,
      protectedSessions: 4,
      deletableSessions: 5,
      deletableResults: 12,
      deletedSessions: dryRun ? 0 : 5,
      deletedResults: dryRun ? 0 : 12,
    }),
  };
}

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("monitor routes expose sync, summary, rankings, and alerts", async () => {
  const app = createApp({ monitor: createMockMonitor(), searchHistory: createMockSearchHistory() });
  await withServer(app, async (baseUrl) => {
    const sync = await fetch(`${baseUrl}/api/sync/dlsite-rankings`, { method: "POST" });
    assert.equal(sync.status, 202);
    assert.equal((await sync.json()).run.status, "running");

    const chartBundle = await fetch(`${baseUrl}/vendor/chart.js/chart.umd.js`);
    assert.equal(chartBundle.status, 200);
    assert.match(await chartBundle.text(), /Chart/);

    const summary = await fetch(`${baseUrl}/api/dashboard/summary`);
    assert.equal(summary.status, 200);
    const summaryPayload = await summary.json();
    assert.equal(summaryPayload.totalWorks, 0);
    assert.equal(summaryPayload.activeActivities, 1);

    const dashboardState = await fetch(
      `${baseUrl}/api/dashboard/state?floor=maniax&period=month&category=voice&alertsStatus=all&activityLimit=2&alertLimit=7&retentionDays=180`
    );
    assert.equal(dashboardState.status, 200);
    const dashboardStatePayload = await dashboardState.json();
    assert.equal(dashboardStatePayload.summary.activeActivities, 1);
    assert.equal(dashboardStatePayload.syncStatus.nextScheduledAt, "2026-05-09T00:00:00.000Z");
    assert.equal(dashboardStatePayload.activityStatus.nextScheduledAt, "2026-05-09T06:00:00.000Z");
    assert.equal(dashboardStatePayload.activities.limit, 2);
    assert.equal(dashboardStatePayload.activities.benefit, "all");
    assert.equal(dashboardStatePayload.activityAlerts.items.length, 1);
    assert.equal(dashboardStatePayload.rankings.floor, "maniax");
    assert.equal(dashboardStatePayload.rankings.period, "month");
    assert.equal(dashboardStatePayload.rankings.category, "voice");
    assert.deepEqual(dashboardStatePayload.alerts.items, []);
    assert.deepEqual(dashboardStatePayload.watchlist.items, []);
    assert.equal(dashboardStatePayload.account.hasSession, false);
    assert.deepEqual(dashboardStatePayload.recommendations.items, []);
    assert.equal(dashboardStatePayload.bundles.items[0].claimsCheckoutOptimization, false);
    assert.equal(dashboardStatePayload.maintenance.retentionDays, 180);

    const activityAlertSummary = await fetch(`${baseUrl}/api/activity-alerts/summary?limit=1`);
    assert.equal(activityAlertSummary.status, 200);
    const activityAlertSummaryPayload = await activityAlertSummary.json();
    assert.equal(activityAlertSummaryPayload.unreadCount, 2);
    assert.equal(activityAlertSummaryPayload.endingSoonActivities, 1);
    assert.equal(activityAlertSummaryPayload.items.length, 1);
    assert.equal(activityAlertSummaryPayload.items[0].type, "ending_soon");

    const activitySync = await fetch(`${baseUrl}/api/sync/dlsite-activities`, { method: "POST" });
    assert.equal(activitySync.status, 202);
    assert.equal((await activitySync.json()).run.status, "running");

    const activityStatus = await fetch(`${baseUrl}/api/activities/status`);
    assert.equal(activityStatus.status, 200);
    assert.equal((await activityStatus.json()).nextScheduledAt, "2026-05-09T06:00:00.000Z");

    const activities = await fetch(`${baseUrl}/api/activities?status=endingSoon&benefit=coupon&limit=200&search=Campaign&related=1`);
    const activitiesPayload = await activities.json();
    assert.equal(activitiesPayload.benefit, "coupon");
    assert.equal(activitiesPayload.status, "endingSoon");
    assert.equal(activitiesPayload.limit, 100);
    assert.equal(activitiesPayload.search, "Campaign");
    assert.equal(activitiesPayload.relatedOnly, true);
    assert.equal(activitiesPayload.unreadCount, 1);
    assert.equal(activitiesPayload.personalSummary.entrypoints[0].claimsEntitlement, false);
    assert.equal(activitiesPayload.activityMatches.totalMatches, 1);
    assert.equal(activitiesPayload.items[0].relatedWorks[0].claimsEntitlement, false);

    const readActivity = await fetch(`${baseUrl}/api/activity-alerts/1/read`, { method: "POST" });
    assert.equal(readActivity.status, 200);
    assert.equal((await readActivity.json()).updated, true);

    const rankings = await fetch(`${baseUrl}/api/rankings?floor=maniax&period=month&category=voice`);
    const rankingPayload = await rankings.json();
    assert.equal(rankingPayload.floor, "maniax");
    assert.equal(rankingPayload.period, "month");

    const alerts = await fetch(`${baseUrl}/api/alerts?status=all`);
    assert.deepEqual((await alerts.json()).items, []);

    const imported = await fetch(`${baseUrl}/api/watchlist/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work: { productId: "RJ100001", title: "Imported" } }),
    });
    assert.equal(imported.status, 201);
    assert.equal((await imported.json()).productId, "RJ100001");

    const savedAnnotation = await fetch(`${baseUrl}/api/works/rj100001/annotation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "planned", tags: ["ASMR", "sale"], note: " local note " }),
    });
    assert.equal(savedAnnotation.status, 200);
    const savedAnnotationPayload = await savedAnnotation.json();
    assert.equal(savedAnnotationPayload.productId, "RJ100001");
    assert.equal(savedAnnotationPayload.status, "planned");
    assert.deepEqual(savedAnnotationPayload.tags, ["ASMR", "sale"]);
    assert.equal(savedAnnotationPayload.note, "local note");

    const savedSubscription = await fetch(`${baseUrl}/api/persons/123/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personName: "Aoyama Yukari",
        keyword: "Aoyama Yukari",
        aliases: ["Aoyama Yukari", "Yukari"],
      }),
    });
    assert.equal(savedSubscription.status, 200);
    assert.equal((await savedSubscription.json()).aliases.length, 2);

    const checkedSubscription = await fetch(`${baseUrl}/api/persons/123/subscription/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "manual" }),
    });
    assert.equal(checkedSubscription.status, 200);
    const checkedSubscriptionPayload = await checkedSubscription.json();
    assert.equal(checkedSubscriptionPayload.newAlertCount, 1);
    assert.equal(checkedSubscriptionPayload.subscription.lastCheckStatus, "completed");

    const deletedSubscription = await fetch(`${baseUrl}/api/persons/123/subscription`, { method: "DELETE" });
    assert.equal(deletedSubscription.status, 200);
    assert.equal((await deletedSubscription.json()).deleted, true);

    const deletedAnnotation = await fetch(`${baseUrl}/api/works/rj100001/annotation`, { method: "DELETE" });
    assert.equal(deletedAnnotation.status, 200);
    assert.equal((await deletedAnnotation.json()).annotation.status, "");

    const account = await fetch(`${baseUrl}/api/account/dlsite`);
    assert.equal(account.status, 200);
    assert.equal((await account.json()).hasSession, false);

    const syncState = await fetch(`${baseUrl}/api/account/dlsite/sync-state`);
    assert.equal(syncState.status, 200);
    assert.deepEqual((await syncState.json()).lists.wishlist.productIds, ["RJ100001"]);

    const recommendations = await fetch(`${baseUrl}/api/recommendations/affordable?limit=5`);
    assert.equal(recommendations.status, 200);
    assert.deepEqual((await recommendations.json()).items, []);

    const bundles = await fetch(`${baseUrl}/api/recommendations/bundles?limit=5`);
    assert.equal(bundles.status, 200);
    const bundlePayload = await bundles.json();
    assert.equal(bundlePayload.items[0].circle, "Local Circle");
    assert.equal(bundlePayload.items[0].claimsCheckoutOptimization, false);

    const maintenancePreview = await fetch(`${baseUrl}/api/maintenance/snapshot-cleanup?retentionDays=365`);
    assert.equal(maintenancePreview.status, 200);
    assert.equal((await maintenancePreview.json()).totalDeletable, 3);

    const maintenanceRun = await fetch(`${baseUrl}/api/maintenance/snapshot-cleanup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: false, retentionDays: 365 }),
    });
    assert.equal(maintenanceRun.status, 200);
    const maintenanceRunPayload = await maintenanceRun.json();
    assert.equal(maintenanceRunPayload.totalDeleted, 3);
    assert.equal(maintenanceRunPayload.optimization.pragmaOptimize, true);

    const imageCachePreview = await fetch(`${baseUrl}/api/maintenance/image-cache?retentionDays=30&maxBytes=1024`);
    assert.equal(imageCachePreview.status, 200);
    const imageCachePreviewPayload = await imageCachePreview.json();
    assert.equal(imageCachePreviewPayload.dryRun, true);
    assert.equal(imageCachePreviewPayload.deletableFiles, 1);
    assert.equal(imageCachePreviewPayload.maxBytes, 1024);

    const imageCacheRun = await fetch(`${baseUrl}/api/maintenance/image-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: false, retentionDays: 30, maxBytes: 1024 }),
    });
    assert.equal(imageCacheRun.status, 200);
    const imageCacheRunPayload = await imageCacheRun.json();
    assert.equal(imageCacheRunPayload.deletedFiles, 1);
    assert.equal(imageCacheRunPayload.deletedBytes, 10);

    const searchHistoryPreview = await fetch(`${baseUrl}/api/maintenance/search-history?retentionDays=180`);
    assert.equal(searchHistoryPreview.status, 200);
    const searchHistoryPreviewPayload = await searchHistoryPreview.json();
    assert.equal(searchHistoryPreviewPayload.dryRun, true);
    assert.equal(searchHistoryPreviewPayload.deletableSessions, 5);
    assert.equal(searchHistoryPreviewPayload.keepPerPerson, 20);

    const searchHistoryRun = await fetch(`${baseUrl}/api/maintenance/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: false, retentionDays: 180 }),
    });
    assert.equal(searchHistoryRun.status, 200);
    const searchHistoryRunPayload = await searchHistoryRun.json();
    assert.equal(searchHistoryRunPayload.deletedSessions, 5);
    assert.equal(searchHistoryRunPayload.deletedResults, 12);
  });
});

test("dashboard state supports opt-in sections without running omitted heavy sections", async () => {
  const calls = {};
  const app = createApp({ monitor: createMockMonitor({ calls }), searchHistory: createMockSearchHistory() });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/dashboard/state?sections=summary,statuses,activities,rankings,alerts,account&floor=maniax&period=month&category=voice`
    );
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.deepEqual(Object.keys(payload).sort(), [
      "account",
      "activities",
      "activityStatus",
      "alerts",
      "rankings",
      "summary",
      "syncStatus",
    ]);
    assert.equal(payload.summary.activeActivities, 1);
    assert.equal(payload.activityStatus.nextScheduledAt, "2026-05-09T06:00:00.000Z");
    assert.equal(payload.rankings.floor, "maniax");
    assert.equal(calls.runSnapshotCleanup ?? 0, 0);
    assert.equal(calls.getAffordableRecommendations ?? 0, 0);
    assert.equal(calls.getBundleRecommendations ?? 0, 0);
    assert.equal(calls.getWatchlist ?? 0, 0);
  });
});

test("dashboard state rejects unknown sections", async () => {
  const app = createApp({ monitor: createMockMonitor(), searchHistory: createMockSearchHistory() });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/dashboard/state?sections=summary,unknown`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Unknown dashboard state section/);
  });
});

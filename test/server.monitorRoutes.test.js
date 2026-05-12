import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server.js";

function createMockMonitor() {
  let annotation = { note: "", tags: [], status: "", createdAt: null, updatedAt: null };
  let subscription = null;
  return {
    startSync: () => ({ alreadyRunning: false, run: { id: 1, status: "running" } }),
    startActivitySync: () => ({ alreadyRunning: false, run: { id: 2, status: "running" } }),
    getStatus: () => ({ running: false, latestRun: null, nextScheduledAt: "2026-05-09T00:00:00.000Z" }),
    getActivityStatus: () => ({ running: false, latestRun: null, nextScheduledAt: "2026-05-09T06:00:00.000Z" }),
    getDashboardSummary: () => ({ totalWorks: 0, unreadAlerts: 0, activeActivities: 1, unreadActivityAlerts: 1, notableDrops: [] }),
    getActivityAlertSummary: ({ limit }) => ({
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
    getActivities: (query) => ({
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
    }),
    getRankings: (query) => ({ ...query, capturedAt: null, items: [] }),
    getWorkHistory: () => null,
    addWatchlist: ({ productId }) => ({ productId, targetPriceJpy: null }),
    importWorkToWatchlist: ({ work }) => ({ productId: work.productId, targetPriceJpy: null }),
    deleteWatchlist: () => true,
    getWatchlist: () => [],
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
    getAlerts: () => [],
    markAlertRead: () => true,
    markActivityAlertRead: () => true,
    getAccountProfile: () => ({ hasSession: false, pointsJpy: null, lists: {} }),
    getAccountSyncState: () => ({ generatedAt: "2026-05-10T00:00:00.000Z", lists: { wishlist: { count: 1, productIds: ["RJ100001"] } } }),
    saveAccountSession: () => ({ hasSession: true, pointsJpy: null, lists: {} }),
    syncAccount: () => ({ profile: { hasSession: true, pointsJpy: 1000, lists: {} }, lists: [] }),
    importAccountPages: () => ({ profile: { hasSession: true, pointsJpy: 1000, lists: {} }, lists: [] }),
    clearAccountSession: () => ({ hasSession: false, pointsJpy: null, lists: {} }),
    getAffordableRecommendations: () => ({ budgetJpy: 1000, items: [] }),
    getBundleRecommendations: () => ({
      budgetJpy: 1000,
      items: [{ circle: "Local Circle", totalPriceJpy: 900, itemCount: 2, claimsCheckoutOptimization: false }],
      disclaimer: "Local public-price analysis only.",
    }),
  };
}

function createMockSearchHistory() {
  return {
    listSearches: () => ({ items: [] }),
    getSearch: () => null,
    getPersonSearches: () => ({ items: [] }),
    getPersonProfile: () => null,
    getPersonWorks: () => null,
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
  });
});

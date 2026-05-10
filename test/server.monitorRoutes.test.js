import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server.js";

function createMockMonitor() {
  return {
    startSync: () => ({ alreadyRunning: false, run: { id: 1, status: "running" } }),
    getStatus: () => ({ running: false, latestRun: null, nextScheduledAt: "2026-05-09T00:00:00.000Z" }),
    getDashboardSummary: () => ({ totalWorks: 0, unreadAlerts: 0, notableDrops: [] }),
    getRankings: (query) => ({ ...query, capturedAt: null, items: [] }),
    getWorkHistory: () => null,
    addWatchlist: ({ productId }) => ({ productId, targetPriceJpy: null }),
    importWorkToWatchlist: ({ work }) => ({ productId: work.productId, targetPriceJpy: null }),
    deleteWatchlist: () => true,
    getWatchlist: () => [],
    getAlerts: () => [],
    markAlertRead: () => true,
    getAccountProfile: () => ({ hasSession: false, pointsJpy: null, lists: {} }),
    getAccountSyncState: () => ({ generatedAt: "2026-05-10T00:00:00.000Z", lists: { wishlist: { count: 1, productIds: ["RJ100001"] } } }),
    saveAccountSession: () => ({ hasSession: true, pointsJpy: null, lists: {} }),
    syncAccount: () => ({ profile: { hasSession: true, pointsJpy: 1000, lists: {} }, lists: [] }),
    importAccountPages: () => ({ profile: { hasSession: true, pointsJpy: 1000, lists: {} }, lists: [] }),
    clearAccountSession: () => ({ hasSession: false, pointsJpy: null, lists: {} }),
    getAffordableRecommendations: () => ({ budgetJpy: 1000, items: [] }),
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
  const app = createApp({ monitor: createMockMonitor() });
  await withServer(app, async (baseUrl) => {
    const sync = await fetch(`${baseUrl}/api/sync/dlsite-rankings`, { method: "POST" });
    assert.equal(sync.status, 202);
    assert.equal((await sync.json()).run.status, "running");

    const summary = await fetch(`${baseUrl}/api/dashboard/summary`);
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).totalWorks, 0);

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

    const account = await fetch(`${baseUrl}/api/account/dlsite`);
    assert.equal(account.status, 200);
    assert.equal((await account.json()).hasSession, false);

    const syncState = await fetch(`${baseUrl}/api/account/dlsite/sync-state`);
    assert.equal(syncState.status, 200);
    assert.deepEqual((await syncState.json()).lists.wishlist.productIds, ["RJ100001"]);

    const recommendations = await fetch(`${baseUrl}/api/recommendations/affordable?limit=5`);
    assert.equal(recommendations.status, 200);
    assert.deepEqual((await recommendations.json()).items, []);
  });
});

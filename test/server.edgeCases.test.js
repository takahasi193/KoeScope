import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server.js";

function createMockMonitor() {
  return {
    startSync: () => ({ alreadyRunning: true, run: { id: 1, status: "running" } }),
    getStatus: () => ({ running: true, latestRun: { id: 1, status: "running" } }),
    getDashboardSummary: () => ({ totalWorks: 0, unreadAlerts: 0, notableDrops: [] }),
    getRankings: (query) => ({ ...query, capturedAt: null, items: [] }),
    getWorkHistory: () => null,
    addWatchlist: () => {
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    },
    importWorkToWatchlist: ({ work }) => ({ productId: work.productId, targetPriceJpy: null }),
    deleteWatchlist: () => false,
    getWatchlist: () => [],
    getAlerts: () => [],
    markAlertRead: () => false,
    getAccountProfile: () => ({ hasSession: false, pointsJpy: null, lists: {} }),
    getAccountSyncState: () => ({ generatedAt: "2026-05-10T00:00:00.000Z", lists: {} }),
    saveAccountSession: () => ({ hasSession: true, pointsJpy: null, lists: {} }),
    syncAccount: () => ({ profile: { hasSession: true, pointsJpy: null, lists: {} }, lists: [] }),
    importAccountPages: () => ({ profile: { hasSession: true, pointsJpy: null, lists: {} }, lists: [] }),
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

test("server returns JSON 400 responses for invalid request bodies", async () => {
  const app = createApp({ monitor: createMockMonitor() });
  await withServer(app, async (baseUrl) => {
    const emptyKeyword = await fetch(`${baseUrl}/api/persons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "   " }),
    });
    assert.equal(emptyKeyword.status, 400);
    assert.equal(typeof (await emptyKeyword.json()).error, "string");

    const malformed = await fetch(`${baseUrl}/api/persons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get("content-type").includes("application/json"), true);
  });
});

test("server handles missing resources and invalid monitor query values", async () => {
  const app = createApp({ monitor: createMockMonitor() });
  await withServer(app, async (baseUrl) => {
    const search = await fetch(`${baseUrl}/api/search/progressive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "", aliases: [] }),
    });
    assert.equal(search.status, 400);

    const missingJob = await fetch(`${baseUrl}/api/search/progressive/not-found`);
    assert.equal(missingJob.status, 404);

    const rankings = await fetch(`${baseUrl}/api/rankings?floor=bad&period=bad&category=bad`);
    assert.deepEqual(await rankings.json(), {
      floor: "home",
      period: "week",
      category: "all",
      capturedAt: null,
      items: [],
    });

    const missingHistory = await fetch(`${baseUrl}/api/works/RJ404/history`);
    assert.equal(missingHistory.status, 404);
  });
});

test("server validates watchlist import payloads before using the monitor", async () => {
  const app = createApp({ monitor: createMockMonitor() });
  await withServer(app, async (baseUrl) => {
    const missingProductId = await fetch(`${baseUrl}/api/watchlist/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work: { title: "No id" } }),
    });
    assert.equal(missingProductId.status, 400);

    const imported = await fetch(`${baseUrl}/api/watchlist/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work: { productId: " RJ100001 " } }),
    });
    assert.equal(imported.status, 201);
    assert.equal((await imported.json()).productId, "RJ100001");
  });
});

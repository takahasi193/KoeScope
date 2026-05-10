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

function createMockSearchHistory() {
  const item = {
    id: "search-1",
    personId: 123,
    keyword: "Aoyama Yukari",
    personName: "Aoyama Yukari",
    aliases: ["Aoyama Yukari", "Yukari"],
    order: "dl_d",
    scope: "all",
    status: "completed",
    total: 1,
  };

  return {
    listSearches: (filters) => ({
      items: filters.aliases?.includes("missing") ? [] : [{ ...item, filters }],
    }),
    getSearch: (id) =>
      id === "search-1"
        ? {
            ...item,
            payload: {
              keyword: item.keyword,
              person: { id: item.personId, name: item.personName },
              searchedAliases: item.aliases,
              options: { order: item.order, scope: item.scope },
              progress: { jobId: id, status: "completed", isComplete: true },
              total: 1,
              items: [{ productId: "RJ100001", title: "Quiet Voice" }],
            },
          }
        : null,
    getPersonSearches: (personId, filters) => ({
      items: [{ ...item, personId: Number(personId), filters }],
    }),
    getPersonProfile: (personId, options) =>
      Number(personId) === 123
        ? {
            person: { id: 123, name: "Aoyama Yukari", image: "https://img.example/person.jpg" },
            aliases: [{ value: "Yukari", isPenName: true, searched: true }],
            stats: {
              totalWorks: 2,
              voiceWorks: 1,
              r18Works: 1,
              generalWorks: 1,
              watchedWorks: 1,
              totalSales: 1200,
              searchSessions: 1,
            },
            recentSearches: [{ ...item }],
            dataSource: { kind: "local_search_history", searchSessions: 1, options },
          }
        : null,
    getPersonWorks: (personId, filters) =>
      Number(personId) === 123
        ? {
            personId: 123,
            generatedAt: "2026-05-10T00:00:00.000Z",
            filters,
            total: 1,
            items: [
              {
                productId: "RJ100001",
                title: "Quiet Voice",
                type: "voice",
                ageCategory: "general",
                sales: 1000,
                isWatched: true,
              },
            ],
          }
        : null,
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
  const app = createApp({ monitor: createMockMonitor(), searchHistory: createMockSearchHistory() });
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
  const app = createApp({ monitor: createMockMonitor(), searchHistory: createMockSearchHistory() });
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
  const app = createApp({ monitor: createMockMonitor(), searchHistory: createMockSearchHistory() });
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

test("server exposes search history routes", async () => {
  const app = createApp({ monitor: createMockMonitor(), searchHistory: createMockSearchHistory() });
  await withServer(app, async (baseUrl) => {
    const history = await fetch(
      `${baseUrl}/api/search/history?personId=123&keyword=Yukari&aliases=Aoyama%20Yukari,Yukari&order=dl_d&scope=all&limit=500`
    );
    assert.equal(history.status, 200);
    const historyPayload = await history.json();
    assert.equal(historyPayload.items.length, 1);
    assert.equal(historyPayload.items[0].filters.limit, 100);
    assert.deepEqual(historyPayload.items[0].filters.aliases, ["Aoyama Yukari", "Yukari"]);

    const detail = await fetch(`${baseUrl}/api/search/history/search-1`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).payload.items[0].productId, "RJ100001");

    const personSearches = await fetch(`${baseUrl}/api/persons/123/searches?limit=1`);
    assert.equal(personSearches.status, 200);
    assert.equal((await personSearches.json()).items[0].personId, 123);

    const missing = await fetch(`${baseUrl}/api/search/history/missing`);
    assert.equal(missing.status, 404);
  });
});

test("server exposes person profile and persisted works routes", async () => {
  const app = createApp({ monitor: createMockMonitor(), searchHistory: createMockSearchHistory() });
  await withServer(app, async (baseUrl) => {
    const profile = await fetch(`${baseUrl}/api/persons/123/profile?limit=2`);
    assert.equal(profile.status, 200);
    const profilePayload = await profile.json();
    assert.equal(profilePayload.person.id, 123);
    assert.equal(profilePayload.stats.totalWorks, 2);
    assert.equal(profilePayload.aliases[0].isPenName, true);

    const works = await fetch(
      `${baseUrl}/api/persons/123/works?sort=hot&type=voice&age=general&sessionId=search-1&limit=999`
    );
    assert.equal(works.status, 200);
    const worksPayload = await works.json();
    assert.equal(worksPayload.filters.sort, "hot");
    assert.equal(worksPayload.filters.type, "voice");
    assert.equal(worksPayload.filters.age, "general");
    assert.equal(worksPayload.filters.sessionId, "search-1");
    assert.equal(worksPayload.items[0].isWatched, true);

    const missingProfile = await fetch(`${baseUrl}/api/persons/404/profile`);
    assert.equal(missingProfile.status, 404);

    const missingWorks = await fetch(`${baseUrl}/api/persons/404/works`);
    assert.equal(missingWorks.status, 404);
  });
});

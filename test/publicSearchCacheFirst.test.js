import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/server.js";

function createMockMonitor(overrides = {}) {
  return {
    getAccountProfile: () => ({}),
    getAccountSyncState: () => ({ lists: {} }),
    getWatchlist: () => [],
    getWorkAnnotation: (productId) => ({ productId: String(productId).toUpperCase(), note: "", tags: [], status: "" }),
    getPersonSubscription: () => null,
    savePersonSubscription: () => null,
    deletePersonSubscription: () => false,
    checkPersonSubscription: () => ({ ok: true }),
    ...overrides,
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

test("progressive search can return public cache first while starting a background refresh", async () => {
  let createdJob = null;
  let cacheReadKey = "";
  const searchJobStore = {
    create: (job) => {
      createdJob = job;
      return {
        keyword: job.keyword,
        cache: {
          ...job.cache,
          read: { source: "live", isStale: false, cachedAt: null },
          refresh: { jobId: "refresh-job", status: "running", isRefreshing: true, updatedAt: "2026-05-16T12:00:00.000Z" },
        },
        progress: { jobId: "refresh-job", status: "running", isComplete: false, updatedAt: "2026-05-16T12:00:00.000Z" },
        items: [],
      };
    },
    get: () => null,
  };
  const searchCache = {
    getSearchResult: (queryKey) => {
      cacheReadKey = queryKey;
      return {
        keyword: "Yukari",
        person: { id: 321, name: "Yukari" },
        cache: {
          queryKey,
          queryVersion: "dlsite-search-v1",
          publicQuery: { version: "dlsite-search-v1", keyword: "yukari", personId: 321, aliases: ["yukari"], scope: "all", order: "dl_d" },
          read: { source: "cache", isStale: true, cachedAt: "2026-05-15T00:00:00.000Z" },
          refresh: { status: "idle", isRefreshing: false, updatedAt: "2026-05-15T00:00:00.000Z" },
        },
        progress: { status: "completed", isComplete: true, updatedAt: "2026-05-15T00:00:00.000Z" },
        total: 1,
        items: [{ productId: "RJ100001", title: "Cached Voice" }],
      };
    },
  };

  const app = createApp({
    monitor: createMockMonitor({
      getAccountProfile: () => ({
        hasSession: true,
        pointsJpy: 2400,
        isStale: false,
        lastSyncedAt: "2026-05-16T08:00:00.000Z",
      }),
      getAccountSyncState: () => ({
        lists: {
          wishlist: { productIds: ["RJ100001"] },
          collection: { productIds: ["RJ999999"] },
        },
      }),
      getWatchlist: () => [{ productId: "RJ100001", targetPriceJpy: 900, source: "local" }],
      getWorkAnnotation: (productId) => ({
        productId: String(productId).toUpperCase(),
        note: productId === "RJ100001" ? "private note" : "",
        tags: productId === "RJ100001" ? ["ASMR"] : [],
        status: productId === "RJ100001" ? "planned" : "",
        updatedAt: productId === "RJ100001" ? "2026-05-16T09:00:00.000Z" : null,
      }),
      getPersonSubscription: () => ({
        personId: 321,
        lastCheckStatus: "completed",
        lastResultCount: 8,
        lastNewItemCount: 1,
      }),
    }),
    searchHistory: createMockSearchHistory(),
    searchJobStore,
    searchCache,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search/progressive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "Yukari", personId: 321, aliases: ["Yukari"], preferCache: true }),
    });
    assert.equal(response.status, 202);
    const payload = await response.json();

    assert.equal(cacheReadKey, createdJob.cache.queryKey);
    assert.equal(payload.items[0].title, "Cached Voice");
    assert.equal(payload.items[0].isWatched, true);
    assert.equal(payload.items[0].targetPriceJpy, 900);
    assert.equal(payload.items[0].annotation.note, "private note");
    assert.deepEqual(payload.items[0].account.listTypes, ["wishlist"]);
    assert.equal(payload.localOverlay.private, true);
    assert.equal(payload.localOverlay.account.pointsJpy, 2400);
    assert.equal(payload.localOverlay.claimsEntitlement, false);
    assert.equal(payload.localOverlay.subscriptionMatched, true);
    assert.equal(payload.person.subscription.lastNewItemCount, 1);
    assert.equal(payload.cache.read.source, "cache");
    assert.equal(payload.cache.read.isStale, true);
    assert.equal(payload.cache.refresh.jobId, "refresh-job");
    assert.equal(payload.cache.refresh.isRefreshing, true);
    assert.deepEqual(payload.backgroundRefresh, { jobId: "refresh-job", status: "running" });
  });
});

test("progressive search keeps local-only live mode when public cache is disabled", async () => {
  let cacheReads = 0;
  const searchJobStore = {
    create: (job) => ({
      keyword: job.keyword,
      cache: {
        ...job.cache,
        read: { source: "live", isStale: false, cachedAt: null },
        refresh: { jobId: "live-job", status: "running", isRefreshing: true, updatedAt: "2026-05-16T12:00:00.000Z" },
      },
      progress: { jobId: "live-job", status: "running", isComplete: false },
      items: [],
    }),
    get: () => null,
  };
  const app = createApp({
    monitor: createMockMonitor(),
    searchHistory: createMockSearchHistory(),
    searchJobStore,
    searchCache: {
      getSearchResult: () => {
        cacheReads += 1;
        return null;
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search/progressive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "Yukari", aliases: ["Yukari"], preferCache: false }),
    });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.progress.jobId, "live-job");
    assert.equal(payload.cache.read.source, "live");
    assert.equal(cacheReads, 0);
  });
});

test("progressive search still returns cached public results when local overlay lookup fails", async () => {
  const searchJobStore = {
    create: (job) => ({
      keyword: job.keyword,
      cache: {
        ...job.cache,
        read: { source: "live", isStale: false, cachedAt: null },
        refresh: { jobId: "refresh-job", status: "running", isRefreshing: true, updatedAt: "2026-05-16T12:00:00.000Z" },
      },
      progress: { jobId: "refresh-job", status: "running", isComplete: false },
      items: [],
    }),
    get: () => null,
  };
  const searchCache = {
    getSearchResult: (queryKey) => ({
      keyword: "Yukari",
      person: { id: 321, name: "Yukari" },
      cache: {
        queryKey,
        queryVersion: "dlsite-search-v1",
        publicQuery: { version: "dlsite-search-v1", keyword: "yukari", personId: 321, aliases: ["yukari"], scope: "all", order: "dl_d" },
        read: { source: "cache", isStale: false, cachedAt: "2026-05-15T00:00:00.000Z" },
      },
      progress: { status: "completed", isComplete: true },
      total: 1,
      items: [{ productId: "RJ100001", title: "Cached Voice" }],
    }),
  };

  const app = createApp({
    monitor: createMockMonitor({
      getWatchlist: () => {
        throw new Error("local database busy");
      },
    }),
    searchHistory: createMockSearchHistory(),
    searchJobStore,
    searchCache,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search/progressive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "Yukari", personId: 321, aliases: ["Yukari"], preferCache: true }),
    });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.items[0].title, "Cached Voice");
    assert.equal(payload.localOverlay, undefined);
    assert.equal(payload.cache.read.source, "cache");
    assert.equal(payload.cache.refresh.jobId, "refresh-job");
  });
});

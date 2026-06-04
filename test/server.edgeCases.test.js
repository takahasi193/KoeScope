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

test("server can start DLsite search directly from the typed keyword", async () => {
  let createdJob = null;
  const searchJobStore = {
    create: (job) => {
      createdJob = job;
      return {
        keyword: job.keyword,
        person: job.person,
        searchedAliases: job.selectedAliasValues,
        progress: { jobId: "manual-search", status: "completed", isComplete: true },
        total: 0,
        items: [],
      };
    },
    get: () => null,
  };
  const app = createApp({
    monitor: createMockMonitor(),
    searchHistory: createMockSearchHistory(),
    searchJobStore,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search/progressive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: " 未登録マイナー名 ", aliases: [], scope: "nonAdult" }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.deepEqual(payload.searchedAliases, ["未登録マイナー名"]);
    assert.equal(payload.person.name, "未登録マイナー名");
    assert.equal(createdJob.person.id, null);
    assert.deepEqual(createdJob.selectedAliasValues, ["未登録マイナー名"]);
  });
});

test("server passes person category filters to Bangumi person search", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  let localBaseUrl = "";

  globalThis.fetch = async (url, options = {}) => {
    if (localBaseUrl && String(url).startsWith(localBaseUrl)) {
      return originalFetch(url, options);
    }
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        total: 1,
        data: [
          {
            id: 456,
            name: "Example Actor",
            type: 1,
            career: ["actor"],
            images: {},
            infobox: [],
          },
        ],
      }),
    };
  };

  try {
    const app = createApp({ monitor: createMockMonitor(), searchHistory: createMockSearchHistory() });
    await withServer(app, async (baseUrl) => {
      localBaseUrl = baseUrl;
      const response = await fetch(`${baseUrl}/api/persons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: "Example Actor", limit: 10, personCategory: "performer" }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.deepEqual(requestBody.filter?.career, ["actor"]);
      assert.equal(payload.personCategory, "performer");
      assert.equal(payload.persons[0].personCategoryLabel, "演员/表演");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("server searches the typed keyword before selected Bangumi aliases", async () => {
  let createdJob = null;
  const searchJobStore = {
    create: (job) => {
      createdJob = job;
      return {
        keyword: job.keyword,
        person: job.person,
        searchedAliases: job.selectedAliasValues,
        progress: { jobId: "alias-search", status: "completed", isComplete: true },
        total: 0,
        items: [],
      };
    },
    get: () => null,
  };
  const app = createApp({
    monitor: createMockMonitor(),
    searchHistory: createMockSearchHistory(),
    searchJobStore,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search/progressive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: "Manual Alias",
        personId: 123,
        person: {
          id: 123,
          name: "Canonical Person",
          image: "https://img.example/person.jpg",
          career: ["writer"],
          personCategory: "writing",
          personCategoryLabel: "脚本/作者",
          aliases: [{ value: "Bangumi Alias", isPenName: true, sources: ["bangumi"], sourceKeys: ["alias"] }],
        },
        aliases: ["Bangumi Alias", "Manual Alias"],
        scope: "nonAdult",
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.deepEqual(payload.searchedAliases, ["Manual Alias", "Bangumi Alias"]);
    assert.equal(createdJob.person.id, 123);
    assert.equal(createdJob.person.name, "Canonical Person");
    assert.equal(createdJob.person.personCategory, "writing");
    assert.equal(createdJob.person.personCategoryLabel, "脚本/作者");
    assert.equal(createdJob.person.aliases[1].sources[0], "bangumi");
  });
});

test("server creates public search cache metadata without local private fields", async () => {
  let createdJob = null;
  const searchJobStore = {
    create: (job) => {
      createdJob = job;
      return {
        keyword: job.keyword,
        person: job.person,
        searchedAliases: job.selectedAliasValues,
        options: job.options,
        cache: job.cache,
        progress: { jobId: "cache-boundary-search", status: "completed", isComplete: true },
        total: 0,
        items: [],
      };
    },
    get: () => null,
  };
  const app = createApp({
    monitor: createMockMonitor(),
    searchHistory: createMockSearchHistory(),
    searchJobStore,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search/progressive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: " Aoyama   Yukari ",
        personId: 123,
        person: {
          id: 123,
          name: "Aoyama Yukari",
          image: "https://private.example/person.jpg",
          aliases: [{ value: "Yukari" }],
        },
        aliases: ["Yukari", "Aoyama Yukari"],
        scope: "all",
        order: "dl_d",
        accountSession: "private-cookie",
        purchaseHistory: ["RJ100001"],
        watchlist: ["RJ100002"],
        annotations: { RJ100003: "local note" },
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.cache.queryKey, createdJob.cache.queryKey);
    assert.deepEqual(createdJob.cache.publicQuery, {
      version: "dlsite-search-v1",
      keyword: "aoyama yukari",
      personId: 123,
      aliases: ["aoyama yukari", "yukari"],
      scope: "all",
      order: "dl_d",
    });
    assert.equal(Object.hasOwn(createdJob.cache.publicQuery, "accountSession"), false);
    assert.equal(Object.hasOwn(createdJob.cache.publicQuery, "purchaseHistory"), false);
    assert.equal(Object.hasOwn(createdJob.cache.publicQuery, "watchlist"), false);
    assert.equal(Object.hasOwn(createdJob.cache.publicQuery, "annotations"), false);
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

test("server enriches person profile with Moegirl data", async () => {
  const app = createApp({
    monitor: createMockMonitor(),
    searchHistory: createMockSearchHistory(),
    moegirl: {
      findPersonProfile: async ({ person, aliases }) => ({
        status: "found",
        sourceName: "萌娘百科",
        title: "青山由香里",
        sourceUrl: "https://zh.moegirl.org.cn/青山由香里",
        summary: `${person.name} 是日本的女性声优。`,
        representativeText: "风见一姬《灰色系列》",
        notableWorks: [{ title: "灰色系列", role: aliases[0].value }],
        matchedBy: "search",
        fetchedAt: "2026-06-03T00:00:00.000Z",
      }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/persons/123/profile`);

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.moegirl.status, "found");
    assert.equal(payload.moegirl.sourceName, "萌娘百科");
    assert.equal(payload.moegirl.notableWorks[0].title, "灰色系列");
  });
});

test("server keeps person profile available when Moegirl lookup fails", async () => {
  const app = createApp({
    monitor: createMockMonitor(),
    searchHistory: createMockSearchHistory(),
    moegirl: {
      findPersonProfile: async () => {
        throw new Error("remote unavailable");
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/persons/123/profile`);

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.person.id, 123);
    assert.equal(payload.moegirl.status, "unavailable");
    assert.match(payload.moegirl.error, /remote unavailable/);
  });
});

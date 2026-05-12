import assert from "node:assert/strict";
import test from "node:test";
import { createDlsiteMonitor, prioritizeTargets } from "../src/lib/monitor/service.js";

test("prioritizeTargets moves the visible dashboard target to the front", () => {
  const targets = [
    { floor: "home", period: "day", category: "all" },
    { floor: "home", period: "day", category: "voice" },
    { floor: "home", period: "week", category: "all" },
    { floor: "home", period: "week", category: "game" },
    { floor: "maniax", period: "week", category: "game" },
  ];

  const prioritized = prioritizeTargets(targets, {
    floor: "home",
    period: "week",
    category: "game",
  });

  assert.deepEqual(prioritized[0], { floor: "home", period: "week", category: "game" });
  assert.deepEqual(
    prioritized.map((target) => `${target.floor}/${target.period}/${target.category}`).sort(),
    targets.map((target) => `${target.floor}/${target.period}/${target.category}`).sort()
  );
});

test("monitor status recovers interrupted running sync rows", () => {
  let latestRun = {
    id: 3,
    status: "running",
    startedAt: "2026-05-09T00:00:00.000Z",
    progress: { completedTargets: 10, totalTargets: 24 },
    error: "",
  };
  const repository = {
    getLatestSyncRun: () => latestRun,
    getSyncRun: () => latestRun,
    updateSyncRun: (_id, patch) => {
      latestRun = {
        ...latestRun,
        ...patch,
        finishedAt: "2026-05-09T00:10:00.000Z",
      };
      return latestRun;
    },
    close: () => {},
  };

  const monitor = createDlsiteMonitor({ repository });
  const status = monitor.getStatus();

  assert.equal(status.running, false);
  assert.equal(status.latestRun.status, "failed");
  assert.equal(status.latestRun.error, "同步被中断或服务已重启。");
});

test("monitor activity payload keeps related-work matches and adds activity status", () => {
  const repository = {
    getActivities: (query) => ({
      ...query,
      generatedAt: "2026-05-10T00:00:00.000Z",
      activityMatches: { totalMatches: 1, claimsEntitlement: false },
      personalSummary: { relatedWorks: { totalMatches: 1, claimsEntitlement: false } },
      items: [
        {
          activityId: "dlsite:coupon",
          relatedWorks: [{ productId: "RJ900001", claimsEntitlement: false }],
        },
      ],
    }),
    getLatestActivitySyncRun: () => ({ id: 5, status: "completed", startedAt: "2026-05-10T00:00:00.000Z" }),
    getAccountProfile: () => ({ hasSession: true, pointsJpy: 500, lists: {} }),
    close: () => {},
  };

  const monitor = createDlsiteMonitor({ repository });
  const payload = monitor.getActivities({ status: "active", benefit: "coupon" });

  assert.equal(payload.activityMatches.totalMatches, 1);
  assert.equal(payload.items[0].relatedWorks[0].claimsEntitlement, false);
  assert.equal(payload.syncStatus.latestRun.id, 5);
  assert.equal(payload.account.pointsJpy, 500);
});

test("monitor payloads expose cached image URLs without replacing remote URLs", () => {
  const imageCache = {
    resolveCachedImageUrl: (url, { type }) => (url ? `/cache/${type}/${url.split("/").at(-1)}` : ""),
  };
  const repository = {
    getDashboardSummary: () => ({
      totalWorks: 1,
      notableDrops: [{ productId: "RJ100001", imageUrl: "https://img.example/drop.jpg" }],
    }),
    getRankings: (query) => ({
      ...query,
      items: [{ productId: "RJ100001", imageUrl: "https://img.example/rank.jpg" }],
    }),
    getActivities: () => ({
      items: [
        {
          activityId: "dlsite:coupon",
          imageUrl: "https://img.example/banner.jpg",
          relatedWorks: [{ productId: "RJ100001", imageUrl: "https://img.example/work.jpg" }],
        },
      ],
      activityMatches: {
        totalMatches: 1,
        sampleMatches: [{ productId: "RJ100001", imageUrl: "https://img.example/sample.jpg" }],
      },
      personalSummary: { relatedWorks: { sampleMatches: [] } },
    }),
    getLatestActivitySyncRun: () => ({ id: 5, status: "completed", startedAt: "2026-05-10T00:00:00.000Z" }),
    getAccountProfile: () => ({ hasSession: false, lists: {} }),
    close: () => {},
  };

  const monitor = createDlsiteMonitor({ repository, imageCache });
  const summary = monitor.getDashboardSummary();
  const rankings = monitor.getRankings({ floor: "home", period: "week", category: "voice" });
  const activities = monitor.getActivities({ status: "active", benefit: "coupon" });

  assert.equal(summary.notableDrops[0].cachedImageUrl, "/cache/work/drop.jpg");
  assert.equal(rankings.items[0].cachedImageUrl, "/cache/work/rank.jpg");
  assert.equal(rankings.items[0].imageUrl, "https://img.example/rank.jpg");
  assert.equal(rankings.items[0].remoteImageUrl, "https://img.example/rank.jpg");
  assert.equal(activities.items[0].cachedImageUrl, "/cache/activity/banner.jpg");
  assert.equal(activities.items[0].relatedWorks[0].cachedImageUrl, "/cache/work/work.jpg");
  assert.equal(activities.activityMatches.sampleMatches[0].cachedImageUrl, "/cache/work/sample.jpg");
});

test("monitor subscription checks persist snapshots and dedupe person-work reminders", async () => {
  const alerts = new Set();
  const savedWorks = [];
  let subscription = {
    personId: 123,
    personName: "Aoyama Yukari",
    personImage: "https://img.example/person.jpg",
    sourceUrl: "https://bgm.tv/person/123",
    keyword: "Aoyama Yukari",
    aliases: ["Aoyama Yukari", "Yukari"],
    lastCheckStatus: "idle",
    lastCheckedAt: null,
    lastError: "",
    lastNewItemCount: 0,
  };
  const searchSnapshots = [];

  const repository = {
    getLatestSyncRun: () => null,
    getLatestActivitySyncRun: () => null,
    getPersonSubscription: () => subscription,
    savePersonSubscription: (payload) => {
      subscription = { ...subscription, ...payload };
      return subscription;
    },
    deletePersonSubscription: () => true,
    listDuePersonSubscriptions: () => [subscription],
    updatePersonSubscriptionCheck: (_personId, patch) => {
      subscription = {
        ...subscription,
        lastCheckStatus: patch.status,
        lastCheckedAt: patch.checkedAt,
        lastError: patch.error,
        lastResultCount: patch.resultCount,
        lastNewItemCount: patch.newItemCount,
      };
      return subscription;
    },
    saveImportedWork: (work) => {
      savedWorks.push(work);
      return work.productId;
    },
    createPossibleNewWorkAlert: ({ personId, productId, fingerprint, message }) => {
      const key = `${personId}:${productId}`;
      if (alerts.has(key)) return false;
      alerts.add(key);
      savedWorks.push({ alertFingerprint: fingerprint, message });
      return true;
    },
    getDashboardSummary: () => ({ totalWorks: 0, notableDrops: [] }),
    getActivities: () => ({ items: [], activityMatches: { totalMatches: 0, claimsEntitlement: false }, personalSummary: { relatedWorks: { totalMatches: 0, claimsEntitlement: false } } }),
    getAccountProfile: () => ({ hasSession: false, lists: {} }),
    getRankings: () => ({ items: [] }),
    getWorkHistory: () => null,
    addWatchlist: () => ({}),
    importWorkToWatchlist: () => ({}),
    deleteWatchlist: () => true,
    getWatchlist: () => [],
    getWorkAnnotation: () => null,
    saveWorkAnnotation: () => ({}),
    deleteWorkAnnotation: () => true,
    getAlerts: () => [],
    markAlertRead: () => true,
    markActivityAlertRead: () => true,
    getAccountSyncState: () => ({ lists: {} }),
    saveAccountSession: () => ({ hasSession: false, lists: {} }),
    saveAccountSyncResult: () => ({ hasSession: false, lists: {} }),
    clearAccountSession: () => ({ hasSession: false, lists: {} }),
    getAffordableRecommendations: () => ({ items: [] }),
    createSyncRun: () => ({ id: 1, status: "running" }),
    updateSyncRun: () => ({}),
    getSyncRun: () => null,
    startActivitySync: () => ({}),
  };

  const searchHistoryRepository = {
    getKnownPersonProductIds: () => [],
    saveSearchSnapshot: (payload, metadata) => {
      searchSnapshots.push({ payload, metadata });
    },
  };

  const monitor = createDlsiteMonitor({
    repository,
    searchHistoryRepository,
    searchAliasProgressive: async (alias) => ({
      alias,
      count: 1,
      availableCount: 1,
      pagesFetched: 1,
      truncated: false,
      floors: [{ key: "home", label: "鍏ㄥ勾榫?R15", count: 1, availableCount: 1, fetchedPages: 1, maxPages: 2, truncated: false }],
      items: [
        {
          productId: "RJ900001",
          title: "Fresh Voice",
          url: "https://www.dlsite.com/home/work/=/product_id/RJ900001.html",
          imageUrl: "https://img.example/fresh.jpg",
          circle: "Local Circle",
          circleUrl: "https://www.dlsite.com/home/circle/profile/=/maker_id/RG900.html",
          floor: "home",
          ageCategory: "general",
          workType: "SOU",
          categoryLabel: "ASMR",
          genres: ["ASMR"],
          priceJpy: 1200,
          sales: 900,
          ratingCount: 10,
          matchedAliases: [alias],
          matchedPages: [1],
          verification: { status: "unknown", matchedAliases: [], fields: [] },
        },
      ],
    }),
    verifySearchItems: async (items) => {
      items[0].verification = {
        status: "matched",
        matchedAliases: ["Aoyama Yukari"],
        fields: ["CV"],
      };
      return items;
    },
  });

  const first = await monitor.checkPersonSubscription(123);
  const second = await monitor.checkPersonSubscription(123);

  assert.equal(first.newAlertCount, 1);
  assert.equal(second.newAlertCount, 0);
  assert.equal(savedWorks.length >= 1, true);
  assert.equal(searchSnapshots.length, 2);
  assert.equal(searchSnapshots[0].payload.options.subscriptionCheck, true);
  assert.equal(searchSnapshots[0].payload.person.name, "Aoyama Yukari");
  assert.equal(searchSnapshots[0].payload.items[0].verification.status, "matched");
  assert.equal(subscription.lastCheckStatus, "completed");
});

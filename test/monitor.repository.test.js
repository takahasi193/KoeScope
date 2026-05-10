import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMonitorRepository } from "../src/lib/monitor/repository.js";

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-monitor-"));
  return path.join(dir, "monitor.sqlite");
}

function sampleEntry(overrides = {}) {
  return {
    productId: "RJ100001",
    title: "Quiet Voice",
    url: "https://www.dlsite.com/home/work/=/product_id/RJ100001.html",
    imageUrl: "https://img.example/RJ100001.jpg",
    circle: "Local Circle",
    circleId: "RG100",
    floor: "home",
    period: "week",
    category: "voice",
    rank: 1,
    ageCategory: "general",
    workType: "SOU",
    categoryLabel: "ボイス・ASMR",
    genres: ["ASMR"],
    priceJpy: 2000,
    officialPriceJpy: 2000,
    discountRate: 0,
    sales: 100,
    ratingCount: 12,
    sourceUrl: "https://example.test/ranking",
    raw: {},
    ...overrides,
  };
}

test("repository stores works, rankings, watchlist alerts, and price deltas", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const run1 = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 1 });
    repo.saveSyncedProducts({
      syncRunId: run1.id,
      capturedAt: "2026-05-01T00:00:00.000Z",
      entries: [sampleEntry()],
    });
    repo.updateSyncRun(run1.id, { status: "completed", fetchedRankings: 1, enrichedWorks: 1 });

    const watched = repo.addWatchlist({ productId: "RJ100001", targetPriceJpy: 1300 });
    assert.equal(watched.productId, "RJ100001");

    const run2 = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 1 });
    repo.saveSyncedProducts({
      syncRunId: run2.id,
      capturedAt: "2026-05-02T00:00:00.000Z",
      entries: [sampleEntry({ priceJpy: 1200, officialPriceJpy: 2000, discountRate: 40, sales: 140 })],
    });
    repo.updateSyncRun(run2.id, { status: "completed", fetchedRankings: 1, enrichedWorks: 1 });

    const rankings = repo.getRankings({ floor: "home", period: "week", category: "voice" });
    assert.equal(rankings.items.length, 1);
    assert.equal(rankings.items[0].latestPriceJpy, 1200);
    assert.equal(rankings.items[0].previousPriceJpy, 2000);
    assert.equal(rankings.items[0].priceDeltaJpy, -800);

    const alerts = repo.getAlerts({ status: "unread" });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, "target_price");

    const summary = repo.getDashboardSummary();
    assert.equal(summary.totalWorks, 1);
    assert.equal(summary.watchedWorks, 1);
    assert.equal(summary.unreadAlerts, 1);
    assert.equal(summary.notableDrops.length, 1);

    const history = repo.getWorkHistory("RJ100001");
    assert.equal(history.prices.length, 2);
    assert.equal(history.ranks.length, 2);
  } finally {
    repo.close();
  }
});

test("repository normalizes watchlist inputs and rejects invalid target prices", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const imported = repo.importWorkToWatchlist({
      work: sampleEntry({ productId: " rj200002 ", title: "Imported Work" }),
      targetPriceJpy: "1234.9",
      note: "  watch this  ",
    });

    assert.equal(imported.productId, "RJ200002");
    assert.equal(imported.targetPriceJpy, 1234);
    assert.equal(imported.note, "watch this");

    assert.throws(
      () => repo.addWatchlist({ productId: "RJ200002", targetPriceJpy: -1 }),
      /targetPriceJpy must be a non-negative number/
    );
    assert.throws(
      () => repo.importWorkToWatchlist({ work: sampleEntry({ productId: "RJ200003" }), targetPriceJpy: "NaN" }),
      /targetPriceJpy must be a non-negative number/
    );
    assert.equal(repo.getWorkHistory("RJ200003"), null);
    assert.equal(repo.deleteWatchlist("missing"), false);
  } finally {
    repo.close();
  }
});

test("repository stores independent total and category ranking snapshots", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const run = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 2 });
    repo.saveSyncedProducts({
      syncRunId: run.id,
      capturedAt: "2026-05-03T00:00:00.000Z",
      entries: [
        sampleEntry({ productId: "RJ300001", rank: 1, category: "all", workType: "ADV", title: "Total Game" }),
        sampleEntry({ productId: "RJ300002", rank: 2, category: "all", workType: "MNG", title: "Total Manga" }),
        sampleEntry({ productId: "RJ300001", rank: 1, category: "game", workType: "ADV", title: "Total Game" }),
        sampleEntry({ productId: "RJ300002", rank: 1, category: "manga", workType: "MNG", title: "Total Manga" }),
      ],
    });

    const total = repo.getRankings({ floor: "home", period: "week", category: "all" });
    assert.deepEqual(
      total.items.map((item) => item.productId),
      ["RJ300001", "RJ300002"]
    );

    const games = repo.getRankings({ floor: "home", period: "week", category: "game" });
    assert.deepEqual(
      games.items.map((item) => item.productId),
      ["RJ300001"]
    );

    const manga = repo.getRankings({ floor: "home", period: "week", category: "manga" });
    assert.deepEqual(
      manga.items.map((item) => item.productId),
      ["RJ300002"]
    );
  } finally {
    repo.close();
  }
});

test("repository stores account sync results and recommends popular affordable value works", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const run = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 3 });
    repo.saveSyncedProducts({
      syncRunId: run.id,
      capturedAt: "2026-05-04T00:00:00.000Z",
      entries: [
        sampleEntry({
          productId: "RJ400001",
          rank: 1,
          category: "all",
          title: "Best Deal",
          priceJpy: 900,
          officialPriceJpy: 1800,
          discountRate: 50,
          sales: 1200,
        }),
        sampleEntry({
          productId: "RJ400002",
          rank: 2,
          category: "all",
          title: "Too Expensive",
          priceJpy: 3000,
          officialPriceJpy: 3000,
          discountRate: 0,
          sales: 5000,
        }),
        sampleEntry({
          productId: "RJ400003",
          rank: 95,
          category: "all",
          title: "Cheap But Cold",
          priceJpy: 400,
          officialPriceJpy: 400,
          discountRate: 0,
          sales: 1,
        }),
      ],
    });

    repo.saveAccountSession({ cookieHeader: "__DLsite_SID=test" });
    const profile = repo.saveAccountSyncResult({
      displayName: "tester",
      pointsJpy: 1000,
      lists: [
        {
          type: "wishlist",
          items: [sampleEntry({ productId: "RJ400001", title: "Best Deal", priceJpy: 900 })],
        },
      ],
    });

    assert.equal(profile.hasSession, true);
    assert.equal(profile.pointsJpy, 1000);
    assert.equal(profile.lists.wishlist.count, 1);
    assert.equal(profile.isStale, false);

    repo.db.prepare("UPDATE account_session SET last_synced_at = ? WHERE id = 1").run("2000-01-01T00:00:00.000Z");
    assert.equal(repo.getAccountProfile().isStale, true);

    const watched = repo.getWatchlist();
    assert.equal(watched.length, 1);
    assert.equal(watched[0].source, "dlsite_account");

    const recommendations = repo.getAffordableRecommendations({ limit: 5 });
    assert.equal(recommendations.budgetJpy, 1000);
    assert.deepEqual(
      recommendations.items.map((item) => item.productId),
      ["RJ400001"]
    );
    assert.ok(recommendations.items[0].recommendationScore > recommendations.items[0].valueScore);

    const cleared = repo.clearAccountSession();
    assert.equal(cleared.hasSession, false);
    assert.equal(repo.getWatchlist().length, 0);
  } finally {
    repo.close();
  }
});

test("repository excludes purchased account works from automatic watchlist", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    repo.saveAccountSession({ cookieHeader: "__DLsite_SID=test" });
    const profile = repo.saveAccountSyncResult({
      displayName: "tester",
      pointsJpy: 1000,
      lists: [
        {
          type: "wishlist",
          items: [
            sampleEntry({ productId: "RJ500001", title: "Already Bought", priceJpy: 700 }),
            sampleEntry({ productId: "RJ500002", title: "Still Watching", priceJpy: 800 }),
          ],
        },
        {
          type: "collection",
          watchlist: false,
          items: [sampleEntry({ productId: "RJ500001", title: "Already Bought", priceJpy: 700 })],
        },
      ],
    });

    assert.equal(profile.lists.wishlist.count, 1);
    assert.equal(profile.lists.collection.count, 1);
    assert.deepEqual(
      repo.getWatchlist().map((item) => item.productId),
      ["RJ500002"]
    );
    assert.throws(
      () => repo.addWatchlist({ productId: "RJ500001" }),
      /已购作品无需加入价格关注/
    );
  } finally {
    repo.close();
  }
});

test("repository hides owned local watches from alerts, summary, and drops", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const run1 = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 1 });
    repo.saveSyncedProducts({
      syncRunId: run1.id,
      capturedAt: "2026-05-05T00:00:00.000Z",
      entries: [sampleEntry({ productId: "RJ600001", priceJpy: 2000, officialPriceJpy: 2000 })],
    });
    repo.updateSyncRun(run1.id, { status: "completed", fetchedRankings: 1, enrichedWorks: 1 });
    repo.addWatchlist({ productId: "RJ600001", targetPriceJpy: 1500 });

    repo.saveAccountSyncResult({
      displayName: "tester",
      pointsJpy: 1000,
      lists: [
        {
          type: "collection",
          watchlist: false,
          items: [sampleEntry({ productId: "RJ600001", priceJpy: 2000 })],
        },
      ],
    });

    const run2 = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 1 });
    repo.saveSyncedProducts({
      syncRunId: run2.id,
      capturedAt: "2026-05-06T00:00:00.000Z",
      entries: [sampleEntry({ productId: "RJ600001", priceJpy: 1000, officialPriceJpy: 2000, discountRate: 50 })],
    });
    repo.updateSyncRun(run2.id, { status: "completed", fetchedRankings: 1, enrichedWorks: 1 });

    assert.equal(repo.getWatchlist().length, 0);
    assert.equal(repo.db.prepare("SELECT COUNT(*) AS count FROM watchlist").get().count, 0);
    assert.equal(repo.getAlerts({ status: "all" }).length, 0);
    const summary = repo.getDashboardSummary();
    assert.equal(summary.watchedWorks, 0);
    assert.deepEqual(summary.notableDrops.map((item) => item.productId), []);
  } finally {
    repo.close();
  }
});

test("repository preserves cached account lists during partial quick syncs", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    repo.saveAccountSession({ cookieHeader: "__DLsite_SID=test" });
    repo.saveAccountSyncResult({
      displayName: "tester",
      pointsJpy: 1000,
      lists: [
        {
          type: "wishlist",
          fullSync: true,
          items: [
            sampleEntry({ productId: "RJ700001", title: "Old Wish One", priceJpy: 700 }),
            sampleEntry({ productId: "RJ700002", title: "Old Wish Two", priceJpy: 800 }),
          ],
        },
      ],
    });

    assert.deepEqual(repo.getAccountSyncState().lists.wishlist.productIds, ["RJ700001", "RJ700002"]);

    repo.saveAccountSyncResult({
      displayName: "tester",
      pointsJpy: 1000,
      syncMode: "quick",
      lists: [
        {
          type: "wishlist",
          fullSync: false,
          items: [sampleEntry({ productId: "RJ700003", title: "New Wish", priceJpy: 900 })],
        },
      ],
    });

    assert.deepEqual(
      repo.getWatchlist().map((item) => item.productId).sort(),
      ["RJ700001", "RJ700002", "RJ700003"]
    );
    assert.equal(repo.getAccountProfile().lists.wishlist.count, 3);

    repo.saveAccountSyncResult({
      displayName: "tester",
      pointsJpy: 1000,
      syncMode: "quick",
      lists: [
        {
          type: "wishlist",
          fullSync: true,
          items: [sampleEntry({ productId: "RJ700003", title: "New Wish", priceJpy: 900 })],
        },
      ],
    });

    assert.deepEqual(
      repo.getWatchlist().map((item) => item.productId),
      ["RJ700003"]
    );
    assert.equal(repo.getAccountProfile().lists.wishlist.count, 1);
  } finally {
    repo.close();
  }
});

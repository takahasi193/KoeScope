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
    assert.equal(rankings.items[0].isHistoricalLow, true);
    assert.equal(rankings.items[0].historicalLowPriceJpy, 1200);
    assert.equal(rankings.items[0].priceSnapshotCount, 2);

    const alerts = repo.getAlerts({ status: "unread" });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, "target_price");
    assert.equal(alerts[0].isHistoricalLow, true);

    const summary = repo.getDashboardSummary();
    assert.equal(summary.totalWorks, 1);
    assert.equal(summary.watchedWorks, 1);
    assert.equal(summary.unreadAlerts, 1);
    assert.equal(summary.notableDrops.length, 1);
    assert.equal(summary.notableDrops[0].isHistoricalLow, true);

    const history = repo.getWorkHistory("RJ100001");
    assert.equal(history.prices.length, 2);
    assert.equal(history.ranks.length, 2);
    assert.deepEqual(history.priceSummary, {
      historicalLowPriceJpy: 1200,
      historicalLowCapturedAt: "2026-05-02T00:00:00.000Z",
      priceSnapshotCount: 2,
    });
  } finally {
    repo.close();
  }
});

test("repository creates performance indexes idempotently", () => {
  const dbPath = tempDbPath();
  const repo = createMonitorRepository({ dbPath });
  try {
    const indexes = new Set(
      repo.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => row.name)
    );
    for (const name of [
      "idx_ranking_latest",
      "idx_ranking_work_history",
      "idx_ranking_work_latest",
      "idx_price_history",
      "idx_price_latest",
      "idx_price_lowest",
      "idx_alerts_product_created",
      "idx_watchlist_updated",
    ]) {
      assert.equal(indexes.has(name), true, `${name} should exist`);
    }
  } finally {
    repo.close();
  }

  const reopened = createMonitorRepository({ dbPath });
  try {
    assert.equal(
      reopened.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_price_latest'").get()
        .count,
      1
    );
  } finally {
    reopened.close();
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

test("repository stores local work annotations and exposes them with watchlist and history", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const run = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 1 });
    repo.saveSyncedProducts({
      syncRunId: run.id,
      capturedAt: "2026-05-02T00:00:00.000Z",
      entries: [sampleEntry({ productId: "RJ220001", title: "Annotated Voice" })],
    });
    repo.addWatchlist({ productId: "RJ220001" });

    const empty = repo.getWorkAnnotation(" rj220001 ");
    assert.equal(empty.productId, "RJ220001");
    assert.equal(empty.note, "");
    assert.deepEqual(empty.tags, []);

    const saved = repo.saveWorkAnnotation({
      productId: " rj220001 ",
      status: "Favorite",
      tags: [" ASMR ", "asmr", "sale", "favorite"],
      note: "  local only note  ",
    });
    assert.equal(saved.status, "favorite");
    assert.deepEqual(saved.tags, ["ASMR", "sale", "favorite"]);
    assert.equal(saved.note, "local only note");

    const watched = repo.getWatchlist()[0];
    assert.equal(watched.annotation.status, "favorite");
    assert.deepEqual(watched.annotation.tags, ["ASMR", "sale", "favorite"]);

    const history = repo.getWorkHistory("RJ220001");
    assert.equal(history.annotation.note, "local only note");
    assert.equal(history.work.annotation.status, "favorite");

    assert.throws(
      () => repo.saveWorkAnnotation({ productId: "RJ220001", status: "account_owned" }),
      /annotation status must be one of/
    );

    assert.equal(repo.deleteWorkAnnotation("RJ220001"), true);
    assert.equal(repo.getWorkAnnotation("RJ220001").status, "");
    assert.equal(repo.getWorkHistory("RJ220001").annotation.note, "");
  } finally {
    repo.close();
  }
});

test("repository stores person subscriptions and dedupes possible new work alerts per person/work pair", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const subscription = repo.savePersonSubscription({
      personId: 123,
      personName: "Aoyama Yukari",
      aliases: ["Aoyama Yukari", "Yukari", "Aoyama Yukari"],
      keyword: "Aoyama Yukari",
    });
    assert.equal(subscription.personId, 123);
    assert.deepEqual(subscription.aliases, ["Aoyama Yukari", "Yukari"]);

    repo.saveImportedWork(sampleEntry({ productId: "RJ230001", title: "Fresh Voice" }));
    assert.equal(
      repo.createPossibleNewWorkAlert({
        personId: 123,
        personName: "Aoyama Yukari",
        productId: "RJ230001",
        message: "Aoyama Yukari 可能的新作：Fresh Voice",
        fingerprint: "possible_new_work:123:RJ230001",
        metadata: { confidence: "possible" },
      }),
      true
    );
    assert.equal(
      repo.createPossibleNewWorkAlert({
        personId: 123,
        personName: "Aoyama Yukari",
        productId: "RJ230001",
        message: "Aoyama Yukari 可能的新作：Fresh Voice",
        fingerprint: "possible_new_work:123:RJ230001",
        metadata: { confidence: "possible" },
      }),
      false
    );

    const alerts = repo.getAlerts({ status: "all" });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, "possible_new_work");
    assert.equal(alerts[0].personId, 123);
    assert.equal(alerts[0].personName, "Aoyama Yukari");
    assert.equal(alerts[0].metadata.confidence, "possible");

    const updatedSubscription = repo.updatePersonSubscriptionCheck(123, {
      status: "completed",
      checkedAt: "2026-05-12T00:00:00.000Z",
      resultCount: 2,
      newItemCount: 1,
    });
    assert.equal(updatedSubscription.lastCheckStatus, "completed");
    assert.equal(updatedSubscription.lastNewItemCount, 1);

    assert.equal(repo.deletePersonSubscription(123), true);
    assert.equal(repo.getPersonSubscription(123), null);
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

test("repository suggests same-circle public-price bundles without checkout claims", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const run = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 4 });
    repo.saveSyncedProducts({
      syncRunId: run.id,
      capturedAt: "2026-05-04T00:00:00.000Z",
      entries: [
        sampleEntry({
          productId: "RJ600001",
          rank: 3,
          category: "all",
          title: "Bundle Voice 1",
          circle: "Bundle Circle",
          circleId: "RG600",
          priceJpy: 900,
          officialPriceJpy: 1800,
          discountRate: 50,
          sales: 1600,
        }),
        sampleEntry({
          productId: "RJ600002",
          rank: 4,
          category: "all",
          title: "Bundle Voice 2",
          circle: "Bundle Circle",
          circleId: "RG600",
          priceJpy: 700,
          officialPriceJpy: 1400,
          discountRate: 50,
          sales: 1200,
        }),
        sampleEntry({
          productId: "RJ600003",
          rank: 5,
          category: "all",
          title: "Bundle Voice 3",
          circle: "Bundle Circle",
          circleId: "RG600",
          priceJpy: 600,
          officialPriceJpy: 1200,
          discountRate: 50,
          sales: 900,
        }),
        sampleEntry({
          productId: "RJ600004",
          rank: 2,
          category: "all",
          title: "Other Circle Deal",
          circle: "Other Circle",
          circleId: "RG601",
          priceJpy: 700,
          officialPriceJpy: 1400,
          discountRate: 50,
          sales: 1500,
        }),
      ],
    });

    repo.saveAccountSession({ cookieHeader: "__DLsite_SID=test" });
    repo.saveAccountSyncResult({ displayName: "tester", pointsJpy: 1600, lists: [] });

    const recommendations = repo.getBundleRecommendations({ limit: 3 });
    assert.equal(recommendations.budgetJpy, 1600);
    assert.match(recommendations.disclaimer, /not claimed/);
    assert.ok(recommendations.items.length > 0);

    const top = recommendations.items[0];
    assert.equal(top.circle, "Bundle Circle");
    assert.equal(top.claimsCheckoutOptimization, false);
    assert.equal(top.itemCount >= 2, true);
    assert.equal(top.totalPriceJpy <= 1600, true);
    assert.equal(new Set(top.items.map((item) => item.circleId)).size, 1);
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

test("repository stores activities, unread alerts, and active activity summaries", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const now = new Date();
    const capturedAt = now.toISOString();
    const startedAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const endingSoonAt = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
    const pastStartAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const pastEndAt = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000).toISOString();

    repo.saveActivities({
      capturedAt,
      entries: [
        {
          activityId: "dlsite:activity-new",
          source: "campaign",
          slot: "main",
          title: "Point Present",
          url: "https://www.dlsite.com/maniax/campaign/point",
          imageUrl: "https://img.example/point.jpg",
          benefitType: "point",
          benefitLabel: "点数",
          benefitSummary: "点数活动",
          startsAt: startedAt,
          endsAt: endingSoonAt,
          raw: { banner_id: "activity-new" },
        },
        {
          activityId: "dlsite:activity-ended",
          source: "campaign",
          slot: "main",
          title: "Old Sale",
          url: "https://www.dlsite.com/maniax/campaign/old",
          imageUrl: "",
          benefitType: "discount",
          benefitLabel: "折扣",
          benefitSummary: "旧活动",
          startsAt: pastStartAt,
          endsAt: pastEndAt,
        },
      ],
    });
    repo.saveAccountSession({ cookieHeader: "__DLsite_SID=test" });
    repo.saveAccountSyncResult({ displayName: "tester", pointsJpy: 1500, lists: [] });

    const active = repo.getActivities({ status: "active", benefit: "all" });
    assert.deepEqual(
      active.items.map((item) => item.activityId),
      ["dlsite:activity-new"]
    );
    assert.equal(active.items[0].unreadAlerts.length, 2);
    assert.equal(active.unreadCount, 3);
    assert.equal(active.personalSummary.account.pointsJpy, 1500);
    assert.equal(active.personalSummary.syncState, "fresh");
    assert.equal(active.personalSummary.activeBenefitCounts.point, 1);
    assert.equal(active.personalSummary.highlights.find((item) => item.id === "points").value, 1500);
    assert.equal(active.personalSummary.highlights.find((item) => item.id === "freshness").tone, "default");
    assert.deepEqual(
      active.personalSummary.entrypoints.map((entry) => entry.benefit),
      ["point"]
    );
    assert.equal(active.personalSummary.entrypoints[0].label, "Point campaigns");
    assert.match(active.personalSummary.entrypoints[0].description, /current point balance/);
    assert.equal(active.personalSummary.entrypoints[0].claimsEntitlement, false);
    assert.equal(active.personalSummary.relatedWorks.emptyReason, "no_followed_works");

    repo.saveActivities({
      capturedAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      entries: [
        {
          activityId: "dlsite:activity-new",
          source: "campaign",
          slot: "main",
          title: "Point Present",
          url: "https://www.dlsite.com/maniax/campaign/point",
          benefitType: "point",
          benefitLabel: "点数",
          benefitSummary: "点数活动",
          endsAt: endingSoonAt,
        },
      ],
    });
    assert.equal(repo.getActivities({ status: "all" }).unreadCount, 3);

    const alertId = active.items[0].unreadAlerts[0].id;
    assert.equal(repo.markActivityAlertRead(alertId), true);
    assert.equal(repo.getActivities({ status: "all" }).unreadCount, 2);

    const pointOnly = repo.getActivities({ status: "all", benefit: "point" });
    assert.deepEqual(
      pointOnly.items.map((item) => item.activityId),
      ["dlsite:activity-new"]
    );
    assert.deepEqual(
      repo.getActivities({ status: "endingSoon" }).items.map((item) => item.activityId),
      ["dlsite:activity-new"]
    );
    assert.deepEqual(
      repo.getActivities({ status: "unread" }).items.map((item) => item.activityId).sort(),
      ["dlsite:activity-ended", "dlsite:activity-new"]
    );
    assert.deepEqual(
      repo.getActivities({ status: "all", search: "old sale" }).items.map((item) => item.activityId),
      ["dlsite:activity-ended"]
    );

    const summary = repo.getDashboardSummary();
    assert.equal(summary.activeActivities, 1);
    assert.equal(summary.endingSoonActivities, 1);
    assert.equal(summary.unreadActivityAlerts, 2);
    assert.equal(summary.activityWorkMatches, 0);
    assert.equal(summary.activityFollowedWorks, 0);

    const activityAlertSummary = repo.getActivityAlertSummary({ limit: 2 });
    assert.equal(activityAlertSummary.unreadCount, 2);
    assert.equal(activityAlertSummary.typeCounts.new_activity, 2);
    assert.equal(activityAlertSummary.typeCounts.ending_soon, 0);
    assert.equal(activityAlertSummary.items.length, 2);
    assert.equal(activityAlertSummary.items[0].activityTitle, "Old Sale");
  } finally {
    repo.close();
  }
});

test("repository stores activity detail fields and preserves them on banner-only updates", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const capturedAt = "2026-05-10T00:00:00.000Z";
    repo.saveActivities({
      capturedAt,
      entries: [
        {
          activityId: "dlsite:detail",
          source: "campaign",
          slot: "main",
          title: "Detail Campaign",
          url: "https://www.dlsite.com/maniax/campaign/detail",
          benefitType: "coupon",
          benefitLabel: "Coupon",
          benefitSummary: "Banner summary",
          details: {
            status: "parsed",
            summary: "Parsed public detail summary.",
            claimCondition: "Login before claiming.",
            applicableScope: "Voice and ASMR works.",
            endsAt: "2026-05-31T14:59:59.000Z",
            requiresLogin: true,
            isLimited: true,
            fetchedAt: "2026-05-10T00:00:01.000Z",
            raw: { lineCount: 12 },
          },
        },
      ],
    });

    const item = repo.getActivities({ status: "all" }).items[0];
    assert.equal(item.details.status, "parsed");
    assert.equal(item.details.claimCondition, "Login before claiming.");
    assert.equal(item.details.applicableScope, "Voice and ASMR works.");
    assert.equal(item.details.requiresLogin, true);
    assert.equal(item.details.isLimited, true);
    assert.equal(item.details.endsAt, "2026-05-31T14:59:59.000Z");
    assert.equal(item.endsAt, "2026-05-31T14:59:59.000Z");
    assert.equal(item.details.raw.lineCount, 12);

    repo.saveActivities({
      capturedAt: "2026-05-10T01:00:00.000Z",
      entries: [
        {
          activityId: "dlsite:detail",
          source: "campaign",
          slot: "main",
          title: "Detail Campaign Updated",
          url: "https://www.dlsite.com/maniax/campaign/detail",
          benefitType: "coupon",
          benefitLabel: "Coupon",
          benefitSummary: "Updated banner summary",
        },
      ],
    });

    const updated = repo.getActivities({ status: "all" }).items[0];
    assert.equal(updated.title, "Detail Campaign Updated");
    assert.equal(updated.details.claimCondition, "Login before claiming.");
    assert.equal(updated.details.status, "parsed");
  } finally {
    repo.close();
  }
});

test("repository matches followed works to coupon and discount activities conservatively", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const now = new Date();
    const run = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 2 });
    repo.saveSyncedProducts({
      syncRunId: run.id,
      capturedAt: now.toISOString(),
      entries: [
        sampleEntry({
          productId: "RJ800001",
          title: "Rain ASMR",
          url: "https://www.dlsite.com/maniax/work/=/product_id/RJ800001.html",
          floor: "maniax",
          category: "voice",
          categoryLabel: "ボイス・ASMR",
          genres: ["ASMR", "バイノーラル"],
          priceJpy: 1200,
          officialPriceJpy: 2400,
          discountRate: 50,
        }),
        sampleEntry({
          productId: "RJ800002",
          title: "Puzzle Game",
          url: "https://www.dlsite.com/home/work/=/product_id/RJ800002.html",
          floor: "home",
          category: "game",
          workType: "GAM",
          categoryLabel: "ゲーム",
          genres: ["RPG"],
          priceJpy: 1800,
          officialPriceJpy: 1800,
          discountRate: 0,
        }),
      ],
    });
    repo.updateSyncRun(run.id, { status: "completed", fetchedRankings: 2, enrichedWorks: 2 });
    repo.addWatchlist({ productId: "RJ800001", targetPriceJpy: 1000 });
    repo.saveAccountSession({ cookieHeader: "__DLsite_SID=test" });
    repo.saveAccountSyncResult({
      displayName: "tester",
      pointsJpy: 2000,
      lists: [
        {
          type: "wishlist",
          items: [
            sampleEntry({
              productId: "RJ800002",
              title: "Puzzle Game",
              category: "game",
              workType: "GAM",
              categoryLabel: "ゲーム",
              genres: ["RPG"],
              priceJpy: 1800,
            }),
          ],
        },
      ],
    });

    const startedAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const endsAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    repo.saveActivities({
      capturedAt: now.toISOString(),
      entries: [
        {
          activityId: "dlsite:coupon-asmr",
          source: "campaign",
          slot: "main",
          title: "ASMR 30%OFF クーポン",
          url: "https://www.dlsite.com/maniax/campaign/asmr-coupon",
          benefitType: "coupon",
          benefitLabel: "クーポン",
          benefitSummary: "ASMR向けクーポン入口",
          startsAt: startedAt,
          endsAt,
        },
        {
          activityId: "dlsite:discount-now",
          source: "campaign",
          slot: "main",
          title: "割引キャンペーン",
          url: "https://www.dlsite.com/maniax/campaign/discount",
          benefitType: "discount",
          benefitLabel: "割引",
          benefitSummary: "割引作品の入口",
          startsAt: startedAt,
          endsAt,
        },
      ],
    });

    const payload = repo.getActivities({ status: "active", benefit: "all" });
    const coupon = payload.items.find((item) => item.activityId === "dlsite:coupon-asmr");
    const discount = payload.items.find((item) => item.activityId === "dlsite:discount-now");

    assert.equal(coupon.relatedWorks[0].productId, "RJ800001");
    assert.equal(coupon.relatedWorks[0].claimsEntitlement, false);
    assert.equal(coupon.relatedWorks[0].sourceTypes.includes("watchlist"), true);
    assert.match(coupon.relatedWorks[0].reasons.join(" "), /ASMR|watchlist/);
    assert.equal(discount.relatedWorks.some((work) => work.productId === "RJ800001"), true);
    assert.equal(payload.personalSummary.relatedWorks.totalMatches >= 2, true);
    assert.equal(payload.personalSummary.relatedWorks.followedWorks, 2);
    assert.equal(payload.personalSummary.relatedWorks.claimsEntitlement, false);
    assert.deepEqual(
      repo.getActivities({ status: "active", benefit: "all", relatedOnly: true }).items.map((item) => item.activityId),
      ["dlsite:coupon-asmr", "dlsite:discount-now"]
    );

    const summary = repo.getDashboardSummary();
    assert.equal(summary.activityWorkMatches >= 2, true);
    assert.equal(summary.activityMatchedWorks >= 1, true);
  } finally {
    repo.close();
  }
});

test("repository returns a friendly no-match activity summary", () => {
  const repo = createMonitorRepository({ dbPath: tempDbPath() });
  try {
    const now = new Date();
    const run = repo.createSyncRun({ scope: { reason: "test" }, totalTargets: 1 });
    repo.saveSyncedProducts({
      syncRunId: run.id,
      capturedAt: now.toISOString(),
      entries: [sampleEntry({ productId: "RJ810001", title: "Quiet Tool", genres: [], categoryLabel: "ツール" })],
    });
    repo.addWatchlist({ productId: "RJ810001" });
    repo.saveActivities({
      capturedAt: now.toISOString(),
      entries: [
        {
          activityId: "dlsite:generic-coupon",
          title: "全館クーポン",
          url: "https://www.dlsite.com/home/campaign/generic-coupon",
          benefitType: "coupon",
          benefitLabel: "クーポン",
          benefitSummary: "汎用キャンペーン",
          startsAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });

    const payload = repo.getActivities({ status: "active", benefit: "all" });
    assert.deepEqual(payload.items[0].relatedWorks, []);
    assert.equal(payload.personalSummary.relatedWorks.totalMatches, 0);
    assert.equal(payload.personalSummary.relatedWorks.emptyReason, "no_matches");
    assert.match(payload.personalSummary.relatedWorks.message, /没有发现/);
  } finally {
    repo.close();
  }
});

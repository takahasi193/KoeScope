import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSearchHistoryRepository } from "../src/lib/searchHistoryRepository.js";

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-search-history-"));
  return path.join(dir, "monitor.sqlite");
}

function samplePayload(overrides = {}) {
  return {
    keyword: "Aoyama Yukari",
    person: {
      id: 123,
      name: "Aoyama Yukari",
      aliases: [{ value: "Aoyama Yukari" }, { value: "Yukari", isPenName: true }],
    },
    searchedAliases: ["Aoyama Yukari", "Yukari"],
    options: {
      scope: "all",
      order: "dl_d",
      orderLabel: "Sales",
      verifyDetails: false,
      maxAliases: 2,
      maxPagesPerAlias: 1,
      perPage: 30,
    },
    timing: { totalMs: 1200 },
    progress: {
      jobId: "search-1",
      status: "running",
      error: "",
      isComplete: false,
      completedAliases: 1,
      totalAliases: 2,
      pagesFetched: 1,
      totalPageBudget: 2,
      updatedAt: Date.parse("2026-05-10T01:00:00.000Z"),
    },
    total: 1,
    items: [
      {
        productId: "RJ100001",
        title: "Quiet Voice",
        url: "https://www.dlsite.com/home/work/=/product_id/RJ100001.html",
        image: "https://img.example/RJ100001.jpg",
        circle: "Local Circle",
        circleUrl: "https://www.dlsite.com/home/circle/profile/=/maker_id/RG100.html",
        floor: "home",
        type: "voice",
        typeLabel: "Voice",
        ageCategory: "general",
        ageLabel: "General",
        category: "Voice ASMR",
        priceJpy: 1200,
        sales: 340,
        ratingCount: 12,
        matchedAliases: ["Aoyama Yukari"],
        matchedPages: [1],
        sourceOrder: 0,
        verification: { status: "unknown", matchedAliases: [], fields: [] },
      },
    ],
    order: "dl_d",
    orderLabel: "Sales",
    groups: { voice: { key: "voice", label: "Voice", count: 1 } },
    ageGroups: { general: { key: "general", label: "General", count: 1 } },
    aliasSummaries: [{ alias: "Aoyama Yukari", count: 1, pagesFetched: 1, truncated: false }],
    truncated: false,
    truncatedAliases: [],
    errors: [],
    ...overrides,
  };
}

test("search history repository stores, filters, and replays search payloads", () => {
  const repo = createSearchHistoryRepository({ dbPath: tempDbPath() });
  try {
    repo.saveSearchSnapshot(samplePayload(), {
      id: "search-1",
      createdAt: "2026-05-10T01:00:00.000Z",
      updatedAt: "2026-05-10T01:00:00.000Z",
    });

    repo.saveSearchSnapshot(
      samplePayload({
        progress: {
          ...samplePayload().progress,
          status: "completed",
          isComplete: true,
          completedAliases: 2,
          pagesFetched: 2,
          updatedAt: Date.parse("2026-05-10T01:01:00.000Z"),
        },
        items: [
          {
            ...samplePayload().items[0],
            title: "Quiet Voice Updated",
            sales: 360,
            matchedAliases: ["Aoyama Yukari", "Yukari"],
            matchedPages: [1, 2],
          },
        ],
      }),
      {
        id: "search-1",
        createdAt: "2026-05-10T01:00:00.000Z",
        updatedAt: "2026-05-10T01:01:00.000Z",
      }
    );

    const filtered = repo.listSearches({
      personId: 123,
      keyword: "Yukari",
      aliases: ["Yukari"],
      order: "dl_d",
      scope: "all",
      limit: 5,
    });
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0].id, "search-1");
    assert.equal(filtered.items[0].status, "completed");
    assert.equal(filtered.items[0].total, 1);

    assert.equal(repo.listSearches({ aliases: ["Missing Alias"] }).items.length, 0);
    assert.equal(repo.getPersonSearches(123, { limit: 5 }).items.length, 1);

    const detail = repo.getSearch("search-1");
    assert.equal(detail.payload.keyword, "Aoyama Yukari");
    assert.equal(detail.payload.progress.status, "completed");
    assert.equal(detail.payload.items.length, 1);
    assert.equal(detail.payload.items[0].title, "Quiet Voice Updated");
    assert.deepEqual(detail.payload.items[0].matchedAliases, ["Aoyama Yukari", "Yukari"]);
  } finally {
    repo.close();
  }
});

test("search history repository builds person profiles and filtered works", () => {
  const repo = createSearchHistoryRepository({ dbPath: tempDbPath() });
  try {
    repo.saveSearchSnapshot(
      samplePayload({
        total: 2,
        items: [
          samplePayload().items[0],
          {
            ...samplePayload().items[0],
            productId: "RJ100002",
            title: "Moon Game",
            url: "https://www.dlsite.com/maniax/work/=/product_id/RJ100002.html",
            floor: "maniax",
            type: "game",
            typeLabel: "Game",
            ageCategory: "r18",
            ageLabel: "R18",
            sales: 900,
            sourceOrder: 1,
          },
        ],
      }),
      {
        id: "search-1",
        createdAt: "2026-05-10T01:00:00.000Z",
        updatedAt: "2026-05-10T01:00:00.000Z",
      }
    );
    repo.saveSearchSnapshot(
      samplePayload({
        searchedAliases: ["Yukari"],
        progress: {
          ...samplePayload().progress,
          jobId: "search-2",
          status: "completed",
          isComplete: true,
          updatedAt: Date.parse("2026-05-10T02:00:00.000Z"),
        },
        items: [
          {
            ...samplePayload().items[0],
            productId: "RJ100001",
            title: "Quiet Voice Latest",
            sales: 420,
            sourceOrder: 0,
          },
        ],
      }),
      {
        id: "search-2",
        createdAt: "2026-05-10T02:00:00.000Z",
        updatedAt: "2026-05-10T02:00:00.000Z",
      }
    );

    repo.db
      .prepare(
        `
          INSERT INTO works (
            product_id, title, url, floor, genres_json, first_seen_at, last_seen_at, raw_json
          )
          VALUES (?, ?, ?, ?, '[]', ?, ?, '{}')
        `
      )
      .run(
        "RJ100001",
        "Quiet Voice Latest",
        "https://www.dlsite.com/home/work/=/product_id/RJ100001.html",
        "home",
        "2026-05-10T02:00:00.000Z",
        "2026-05-10T02:00:00.000Z"
      );
    repo.db
      .prepare(
        `
          INSERT INTO watchlist (product_id, target_price_jpy, note, source, created_at, updated_at)
          VALUES (?, ?, ?, 'local', ?, ?)
        `
      )
      .run("RJ100001", 900, "watch", "2026-05-10T02:05:00.000Z", "2026-05-10T02:05:00.000Z");
    repo.db
      .prepare(
        `
          INSERT INTO work_annotations (product_id, note, tags_json, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        "RJ100001",
        "local note",
        JSON.stringify(["ASMR", "sale"]),
        "planned",
        "2026-05-10T02:06:00.000Z",
        "2026-05-10T02:06:00.000Z"
      );
    repo.db
      .prepare(
        `
          INSERT INTO person_subscriptions (
            person_id, person_name, keyword, aliases_json, created_at, updated_at,
            last_checked_at, last_successful_check_at, last_check_status, last_error,
            last_result_count, last_new_item_count
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        123,
        "Aoyama Yukari",
        "Aoyama Yukari",
        JSON.stringify(["Aoyama Yukari", "Yukari"]),
        "2026-05-10T02:07:00.000Z",
        "2026-05-10T02:07:00.000Z",
        "2026-05-10T03:00:00.000Z",
        "2026-05-10T03:00:00.000Z",
        "completed",
        "",
        2,
        1
      );

    const profile = repo.getPersonProfile(123);
    assert.equal(profile.person.name, "Aoyama Yukari");
    assert.equal(profile.stats.totalWorks, 2);
    assert.equal(profile.stats.voiceWorks, 1);
    assert.equal(profile.stats.r18Works, 1);
    assert.equal(profile.stats.watchedWorks, 1);
    assert.equal(profile.stats.searchSessions, 2);
    assert.equal(profile.aliases.find((alias) => alias.value === "Yukari").isPenName, true);
    assert.equal(profile.recentSearches[0].id, "search-2");
    assert.equal(profile.subscription.personId, 123);
    assert.equal(profile.subscription.lastNewItemCount, 1);

    const hot = repo.getPersonWorks(123, { sort: "hot" });
    assert.equal(hot.items[0].productId, "RJ100002");
    assert.equal(hot.items.find((item) => item.productId === "RJ100001").isWatched, true);
    assert.deepEqual(hot.items.find((item) => item.productId === "RJ100001").annotation, {
      productId: "RJ100001",
      note: "local note",
      tags: ["ASMR", "sale"],
      status: "planned",
      createdAt: "2026-05-10T02:06:00.000Z",
      updatedAt: "2026-05-10T02:06:00.000Z",
    });

    const filtered = repo.getPersonWorks(123, { sort: "latest", type: "voice", age: "general" });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].title, "Quiet Voice Latest");

    const sessionWorks = repo.getPersonWorks(123, { sessionId: "search-1", sort: "latest" });
    assert.deepEqual(
      sessionWorks.items.map((item) => item.productId),
      ["RJ100001", "RJ100002"]
    );
    assert.deepEqual(repo.getKnownPersonProductIds(123), ["RJ100001", "RJ100002"]);
  } finally {
    repo.close();
  }
});

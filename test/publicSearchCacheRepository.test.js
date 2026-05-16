import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPublicSearchQuery } from "../src/lib/searchCacheKey.js";
import {
  buildPublicSearchCachePayload,
  createPublicSearchCacheRepository,
} from "../src/lib/publicSearchCacheRepository.js";

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-search-cache-"));
  return path.join(dir, "monitor.sqlite");
}

function sampleSearchPayload() {
  const cache = createPublicSearchQuery({
    keyword: "Aoyama Yukari",
    personId: 123,
    aliases: ["Aoyama Yukari", "Yukari"],
    scope: "all",
    order: "dl_d",
  });
  return {
    keyword: "Aoyama Yukari",
    person: {
      id: 123,
      name: "Aoyama Yukari",
      image: "https://img.example/person.jpg",
      aliases: [{ value: "Yukari", isPenName: true, privateNote: "local only" }],
      accountSession: "private",
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
      privateOverlay: true,
    },
    cache: {
      ...cache,
      publicQuery: {
        ...cache.publicQuery,
        accountSession: "private",
        watchlist: ["RJ100001"],
      },
    },
    progress: {
      jobId: "search-1",
      status: "completed",
      isComplete: true,
      completedAliases: 2,
      totalAliases: 2,
      pagesFetched: 2,
      totalPageBudget: 2,
      updatedAt: Date.parse("2026-05-16T00:00:00.000Z"),
    },
    total: 1,
    items: [
      {
        productId: "RJ100001",
        title: "Quiet Voice",
        url: "https://www.dlsite.com/home/work/=/product_id/RJ100001.html",
        image: "https://img.example/RJ100001.jpg",
        cachedImageUrl: "/cache/work/private-local.jpg",
        circle: "Public Circle",
        floor: "home",
        type: "voice",
        ageCategory: "general",
        priceJpy: 1200,
        sales: 340,
        matchedAliases: ["Aoyama Yukari"],
        matchedPages: [1],
        isWatched: true,
        targetPriceJpy: 900,
        annotation: { note: "local note" },
        account: { owned: true },
        purchaseHistory: ["RJ100001"],
      },
    ],
    accountSession: "private-cookie",
    purchaseHistory: ["RJ100001"],
    watchlist: ["RJ100001"],
    annotations: { RJ100001: "local note" },
    groups: { voice: { key: "voice", label: "Voice", count: 1 } },
    ageGroups: { general: { key: "general", label: "General", count: 1 } },
    aliasSummaries: [{ alias: "Aoyama Yukari", count: 1, pagesFetched: 1 }],
    truncated: false,
    truncatedAliases: [],
    errors: [],
  };
}

test("public search cache payload strips local private overlay fields", () => {
  const publicPayload = buildPublicSearchCachePayload(sampleSearchPayload());

  assert.equal(publicPayload.cache.queryKey.startsWith("dlsite-search-v1:"), true);
  assert.deepEqual(publicPayload.cache.publicQuery.aliases, ["aoyama yukari", "yukari"]);
  assert.equal(publicPayload.cache.publicQuery.accountSession, undefined);
  assert.equal(publicPayload.cache.publicQuery.watchlist, undefined);
  assert.equal(publicPayload.person.accountSession, undefined);
  assert.equal(publicPayload.person.aliases[0].privateNote, undefined);
  assert.equal(publicPayload.items[0].productId, "RJ100001");
  assert.equal(publicPayload.items[0].cachedImageUrl, undefined);
  assert.equal(publicPayload.items[0].isWatched, undefined);
  assert.equal(publicPayload.items[0].targetPriceJpy, undefined);
  assert.equal(publicPayload.items[0].annotation, undefined);
  assert.equal(publicPayload.items[0].account, undefined);
  assert.equal(publicPayload.accountSession, undefined);
  assert.equal(publicPayload.purchaseHistory, undefined);
  assert.equal(publicPayload.watchlist, undefined);
  assert.equal(publicPayload.annotations, undefined);
});

test("local public search cache repository stores and reads public payloads by query key", () => {
  const repo = createPublicSearchCacheRepository({ dbPath: tempDbPath() });
  try {
    const payload = sampleSearchPayload();
    const saved = repo.saveSearchResult(payload, {
      cachedAt: "2026-05-16T00:00:00.000Z",
      ttlMs: 1000,
    });

    assert.equal(saved.cache.read.source, "cache");
    assert.equal(saved.cache.read.isStale, false);
    assert.equal(saved.cache.read.cachedAt, "2026-05-16T00:00:00.000Z");
    assert.equal(saved.items[0].annotation, undefined);

    const fresh = repo.getSearchResult(payload.cache.queryKey, {
      now: "2026-05-16T00:00:00.500Z",
    });
    assert.equal(fresh.cache.queryKey, payload.cache.queryKey);
    assert.equal(fresh.cache.read.isStale, false);

    const stale = repo.getSearchResult(payload.cache.queryKey, {
      now: "2026-05-16T00:00:01.001Z",
    });
    assert.equal(stale.cache.read.isStale, true);
    assert.equal(stale.items[0].cachedImageUrl, undefined);
  } finally {
    repo.close();
  }
});

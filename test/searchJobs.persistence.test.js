import assert from "node:assert/strict";
import test from "node:test";
import { createSearchJobStore } from "../src/lib/searchJobs.js";

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("search job store persists running and completed snapshots", async () => {
  const snapshots = [];
  const store = createSearchJobStore({
    persistIntervalMs: 0,
    searchHistoryRepository: {
      saveSearchSnapshot(payload, metadata) {
        snapshots.push({ payload, metadata });
      },
    },
  });

  const initial = store.create({
    keyword: "Aoyama Yukari",
    person: { id: 123, name: "Aoyama Yukari", aliases: [] },
    selectedAliasValues: [],
    options: {
      scope: "all",
      order: "dl_d",
      orderLabel: "Sales",
      verifyDetails: false,
      maxAliases: 1,
      maxPagesPerAlias: 1,
      perPage: 30,
    },
  });

  assert.equal(initial.progress.status, "running");
  assert.equal(typeof initial.cache.queryKey, "string");
  assert.deepEqual(initial.cache.publicQuery, {
    version: "dlsite-search-v1",
    keyword: "aoyama yukari",
    personId: 123,
    aliases: [],
    scope: "all",
    order: "dl_d",
  });
  assert.deepEqual(initial.cache.read, {
    source: "live",
    isStale: false,
    cachedAt: null,
  });
  assert.equal(initial.cache.refresh.status, "running");
  assert.equal(initial.cache.refresh.isRefreshing, true);
  assert.equal(snapshots[0].payload.progress.status, "running");
  assert.equal(snapshots[0].payload.cache.queryKey, initial.cache.queryKey);
  assert.equal(snapshots[0].metadata.id, initial.progress.jobId);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (store.get(initial.progress.jobId)?.progress?.isComplete) break;
    await delay();
  }

  const finalPayload = store.get(initial.progress.jobId);
  assert.equal(finalPayload.progress.status, "completed");
  assert.equal(finalPayload.cache.queryKey, initial.cache.queryKey);
  assert.equal(finalPayload.cache.refresh.status, "completed");
  assert.equal(finalPayload.cache.refresh.isRefreshing, false);
  assert.equal(snapshots.at(-1).payload.progress.status, "completed");
  assert.equal(snapshots.at(-1).payload.progress.isComplete, true);
});

test("search job store writes completed public search payloads to the cache adapter", async () => {
  const cachedPayloads = [];
  const store = createSearchJobStore({
    persistIntervalMs: 0,
    searchCacheRepository: {
      saveSearchResult(payload, options) {
        cachedPayloads.push({ payload, options });
      },
    },
  });

  const initial = store.create({
    keyword: "Aoyama Yukari",
    person: { id: 123, name: "Aoyama Yukari", aliases: [] },
    selectedAliasValues: [],
    options: {
      scope: "all",
      order: "dl_d",
      orderLabel: "Sales",
      verifyDetails: false,
      maxAliases: 1,
      maxPagesPerAlias: 1,
      perPage: 30,
    },
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (store.get(initial.progress.jobId)?.progress?.isComplete) break;
    await delay();
  }

  assert.equal(cachedPayloads.length, 1);
  assert.equal(cachedPayloads[0].payload.progress.status, "completed");
  assert.equal(cachedPayloads[0].payload.cache.queryKey, initial.cache.queryKey);
  assert.equal(cachedPayloads[0].options.cachedAt, cachedPayloads[0].payload.progress.updatedAt);
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import publicSearchRefreshHandler from "../api/public-search-refresh.js";
import { planPublicSearchRefresh } from "../src/lib/publicSearchRefreshPlanner.js";

function entry(overrides = {}) {
  return {
    queryKey: "dlsite-search-v1:abc123abc123abc123abc123abc123ab",
    publicQuery: {
      version: "dlsite-search-v1",
      keyword: "aoyama yukari",
      personId: 123,
      aliases: ["aoyama yukari"],
      scope: "all",
      order: "dl_d",
    },
    cachedAt: "2026-05-14T00:00:00.000Z",
    expiresAt: "2026-05-15T00:00:00.000Z",
    popularity: { searchCount: 5, subscriptionCount: 0 },
    refresh: { attempts: 0, lastAttemptAt: null },
    accountSession: "private",
    purchaseHistory: ["private"],
    ...overrides,
  };
}

test("public search refresh planner selects stale and retryable public queries", () => {
  const plan = planPublicSearchRefresh(
    [
      entry({
        queryKey: "dlsite-search-v1:subscribed000000000000000000000",
        popularity: { searchCount: 1, subscriptionCount: 2 },
      }),
      entry({
        queryKey: "dlsite-search-v1:popular000000000000000000000000",
        popularity: { searchCount: 20, subscriptionCount: 0 },
      }),
      entry({
        queryKey: "dlsite-search-v1:retry0000000000000000000000000",
        refresh: { attempts: 1, lastAttemptAt: "2026-05-16T11:40:00.000Z" },
      }),
      entry({
        queryKey: "dlsite-search-v1:pending00000000000000000000000",
        refresh: { attempts: 2, lastAttemptAt: "2026-05-16T11:55:00.000Z" },
      }),
      entry({
        queryKey: "dlsite-search-v1:fresh0000000000000000000000000",
        cachedAt: "2026-05-16T11:00:00.000Z",
        expiresAt: "2026-05-17T11:00:00.000Z",
      }),
    ],
    {
      now: "2026-05-16T12:00:00.000Z",
      maxBatch: 2,
      retryBaseMs: 5 * 60 * 1000,
    }
  );

  assert.equal(plan.dueTotal, 3);
  assert.equal(plan.requiresWorker, true);
  assert.deepEqual(
    plan.queued.map((item) => item.queryKey),
    ["dlsite-search-v1:subscribed000000000000000000000", "dlsite-search-v1:popular000000000000000000000000"]
  );
  assert.equal(plan.skipped.retryPending, 1);
  assert.equal(plan.skipped.fresh, 1);
  assert.equal(JSON.stringify(plan).includes("private"), false);
});

test("public search refresh planner stops exhausted or unsafe entries before queueing", () => {
  const plan = planPublicSearchRefresh(
    [
      entry({ queryKey: "../secret" }),
      entry({
        queryKey: "dlsite-search-v1:exhausted00000000000000000000",
        refresh: { attempts: 4, lastAttemptAt: "2026-05-16T10:00:00.000Z" },
      }),
    ],
    { now: "2026-05-16T12:00:00.000Z", maxAttempts: 4 }
  );

  assert.equal(plan.dueTotal, 0);
  assert.equal(plan.skipped.invalid, 1);
  assert.equal(plan.skipped.exhausted, 1);
});

test("Vercel refresh cron function only returns a lightweight plan", async () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(
    config.crons,
    [{ path: "/api/public-search-refresh", schedule: "0 */6 * * *" }]
  );

  const originalValue = process.env.KOESCOPE_PUBLIC_SEARCH_REFRESH_ENTRIES_JSON;
  process.env.KOESCOPE_PUBLIC_SEARCH_REFRESH_ENTRIES_JSON = JSON.stringify([entry()]);
  const response = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(chunk = "") {
      this.body = String(chunk);
    },
  };

  try {
    await publicSearchRefreshHandler(
      {
        method: "GET",
        url: "/api/public-search-refresh",
        headers: { host: "koescope.example" },
      },
      response
    );
  } finally {
    if (originalValue === undefined) delete process.env.KOESCOPE_PUBLIC_SEARCH_REFRESH_ENTRIES_JSON;
    else process.env.KOESCOPE_PUBLIC_SEARCH_REFRESH_ENTRIES_JSON = originalValue;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const payload = JSON.parse(response.body);
  assert.equal(payload.mode, "cron-dispatch");
  assert.equal(payload.queued.length, 1);
  assert.equal(payload.queued[0].queryKey, "dlsite-search-v1:abc123abc123abc123abc123abc123ab");
  assert.equal(payload.executesRefreshJobs, false);
});

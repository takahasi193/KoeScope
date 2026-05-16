import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createPublicSearchQuery } from "../src/lib/searchCacheKey.js";
import {
  createStaticPublicSearchCacheRepository,
  handlePublicSearchCacheRequest,
} from "../src/lib/publicSearchCacheReadApi.js";
import vercelPublicCacheHandler from "../api/public-search-cache.js";

function createPrivateCachePayload() {
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
      accountNote: "private-person-note",
      aliases: [
        {
          value: "Yukari",
          isPenName: true,
          localAliasNote: "private-alias-note",
        },
      ],
    },
    cache: {
      ...cache,
      read: {
        source: "cache",
        isStale: false,
        cachedAt: "2026-05-16T12:00:00.000Z",
      },
      refresh: {
        jobId: "local-job-id",
        status: "idle",
        isRefreshing: false,
        updatedAt: "2026-05-16T12:00:00.000Z",
      },
    },
    progress: {
      status: "completed",
      isComplete: true,
      updatedAt: "2026-05-16T12:00:00.000Z",
    },
    total: 1,
    items: [
      {
        productId: "RJ100001",
        title: "Quiet Voice",
        url: "https://www.dlsite.com/maniax/work/=/product_id/RJ100001.html",
        imageUrl: "https://img.dlsite.jp/modpub/images2/work/doujin/RJ100001_img_main.jpg",
        cachedImageUrl: "/cache/private-local-image.jpg",
        targetPriceJpy: 500,
        localTags: ["private-tag"],
        annotation: { note: "private-note" },
      },
    ],
  };
}

test("read-only public cache API returns sanitized cache payloads", async () => {
  const sourcePayload = createPrivateCachePayload();
  const repository = createStaticPublicSearchCacheRepository({ entries: [sourcePayload] });
  const request = new Request(
    `https://koescope.example/api/public-search-cache?queryKey=${encodeURIComponent(sourcePayload.cache.queryKey)}`
  );

  const response = await handlePublicSearchCacheRequest(request, { repository });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.match(response.headers.get("cache-control"), /s-maxage=60/);
  assert.match(response.headers.get("cache-control"), /stale-while-revalidate=600/);

  const payload = await response.json();
  assert.equal(payload.cache.queryKey, sourcePayload.cache.queryKey);
  assert.deepEqual(payload.cache.read, {
    source: "cache",
    isStale: false,
    cachedAt: "2026-05-16T12:00:00.000Z",
  });
  assert.deepEqual(payload.cache.refresh, {
    status: "idle",
    isRefreshing: false,
    updatedAt: "2026-05-16T12:00:00.000Z",
  });
  assert.equal(payload.items[0].imageUrl, sourcePayload.items[0].imageUrl);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("private"), false);
  assert.equal(serialized.includes("/cache/"), false);
  assert.equal(serialized.includes("targetPrice"), false);
  assert.equal(serialized.includes("jobId"), false);
});

test("read-only public cache API rejects unsafe and mutating requests", async () => {
  let reads = 0;
  const repository = {
    getSearchResult: () => {
      reads += 1;
      return null;
    },
  };

  const mutation = await handlePublicSearchCacheRequest(
    new Request("https://koescope.example/api/public-search-cache?queryKey=dlsite-search-v1:abc123abc123abc123abc123abc123ab", {
      method: "POST",
    }),
    { repository }
  );
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get("allow"), "GET, HEAD, OPTIONS");

  const missing = await handlePublicSearchCacheRequest(new Request("https://koescope.example/api/public-search-cache"), {
    repository,
  });
  assert.equal(missing.status, 400);

  const unsafe = await handlePublicSearchCacheRequest(
    new Request("https://koescope.example/api/public-search-cache?queryKey=../secret"),
    { repository }
  );
  assert.equal(unsafe.status, 400);
  assert.equal(reads, 0);
});

test("Vercel prototype config builds the exported frontend and public serverless functions", async () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.buildCommand, "npm run web:build");
  assert.equal(config.outputDirectory, "web/out");
  assert.deepEqual(Object.keys(config.functions).sort(), [
    "api/public-search-cache.js",
    "api/public-search-refresh.js",
  ]);
  assert.equal(config.functions["api/public-search-cache.js"].maxDuration, 5);
  assert.equal(config.functions["api/public-search-refresh.js"].maxDuration, 5);
});

test("Vercel public cache function serves configured public JSON without local state", async () => {
  const sourcePayload = createPrivateCachePayload();
  const originalValue = process.env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON;
  process.env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON = JSON.stringify([sourcePayload]);

  const headers = {};
  let body = "";
  const response = {
    statusCode: 0,
    setHeader(key, value) {
      headers[key.toLowerCase()] = value;
    },
    end(chunk = "") {
      body = String(chunk);
    },
  };

  try {
    await vercelPublicCacheHandler(
      {
        method: "GET",
        url: `/api/public-search-cache?queryKey=${encodeURIComponent(sourcePayload.cache.queryKey)}`,
        headers: { host: "koescope.example" },
      },
      response
    );
  } finally {
    if (originalValue === undefined) delete process.env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON;
    else process.env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON = originalValue;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(headers["content-type"], "application/json; charset=utf-8");
  const payload = JSON.parse(body);
  assert.equal(payload.cache.queryKey, sourcePayload.cache.queryKey);
  assert.equal(JSON.stringify(payload).includes("private"), false);
});

test("Vercel public cache function fails closed when the cache JSON is not configured", async () => {
  const sourcePayload = createPrivateCachePayload();
  const originalValue = process.env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON;
  process.env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON = "{";

  const headers = {};
  let body = "";
  const response = {
    statusCode: 0,
    setHeader(key, value) {
      headers[key.toLowerCase()] = value;
    },
    end(chunk = "") {
      body = String(chunk);
    },
  };

  try {
    await vercelPublicCacheHandler(
      {
        method: "GET",
        url: `/api/public-search-cache?queryKey=${encodeURIComponent(sourcePayload.cache.queryKey)}`,
        headers: { host: "koescope.example" },
      },
      response
    );
  } finally {
    if (originalValue === undefined) delete process.env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON;
    else process.env.KOESCOPE_PUBLIC_SEARCH_CACHE_JSON = originalValue;
  }

  assert.equal(response.statusCode, 503);
  assert.equal(headers["cache-control"], "no-store");
  assert.match(JSON.parse(body).error, /not configured/);
});

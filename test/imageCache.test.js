import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createImageCache, publicCachePathForUrl } from "../src/lib/imageCache.js";

test("image cache writes safe public paths and reuses existing files", async (t) => {
  const publicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "koescope-cache-"));
  t.after(() => fs.rm(publicRoot, { recursive: true, force: true }));

  const requests = [];
  const cache = createImageCache({
    publicRoot,
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(Buffer.from("image-bytes"), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    },
  });

  const remoteUrl = "https://img.example/covers/RJ100001_main.webp?width=240#preview";
  const expectedPublicPath = publicCachePathForUrl(remoteUrl, { type: "work" });

  assert.match(expectedPublicPath, /^\/cache\/works\/[a-f0-9]{24}\.webp$/);
  assert.equal(await cache.cacheImageUrl(remoteUrl, { type: "work" }), expectedPublicPath);
  assert.equal(cache.resolveCachedImageUrl(remoteUrl, { type: "work" }), expectedPublicPath);
  assert.equal(
    (await fs.readFile(path.join(publicRoot, expectedPublicPath.slice(1)))).toString(),
    "image-bytes"
  );

  assert.equal(await cache.cacheImageUrl(remoteUrl, { type: "work" }), expectedPublicPath);
  assert.equal(requests.length, 1);
});

test("image cache returns an empty mapping when download or URL validation fails", async (t) => {
  const publicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "koescope-cache-fail-"));
  t.after(() => fs.rm(publicRoot, { recursive: true, force: true }));

  const cache = createImageCache({
    publicRoot,
    fetchImpl: async () => {
      throw new Error("network offline");
    },
    logger: null,
  });

  assert.equal(publicCachePathForUrl("javascript:alert(1)", { type: "activity" }), "");
  assert.equal(await cache.cacheImageUrl("https://img.example/banner.jpg", { type: "activity" }), "");
  assert.equal(cache.resolveCachedImageUrl("https://img.example/banner.jpg", { type: "activity" }), "");
});


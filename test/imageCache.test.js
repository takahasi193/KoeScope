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

test("image cache cleanup protects referenced files and deletes only selected unreferenced files", async (t) => {
  const publicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "koescope-cache-cleanup-"));
  t.after(() => fs.rm(publicRoot, { recursive: true, force: true }));

  const cache = createImageCache({ publicRoot, fetchImpl: null });
  const referencedRemoteUrl = "https://img.example/covers/RJ100001_main.webp";
  const oldReferenced = publicCachePathForUrl(referencedRemoteUrl, { type: "work" });
  const oldUnreferenced = publicCachePathForUrl("https://img.example/covers/RJ200001_main.webp", { type: "work" });
  const newUnreferenced = publicCachePathForUrl("https://img.example/covers/RJ300001_main.webp", { type: "work" });
  const keepFile = path.join(publicRoot, "cache", "works", ".gitkeep");
  const oldDate = new Date("2026-01-01T00:00:00.000Z");
  const newDate = new Date("2026-05-15T00:00:00.000Z");

  async function writeCacheFile(publicUrl, content, mtime) {
    const filePath = path.join(publicRoot, publicUrl.slice(1));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    await fs.utimes(filePath, mtime, mtime);
  }

  await writeCacheFile(oldReferenced, "ref01", oldDate);
  await writeCacheFile(oldUnreferenced, "old", oldDate);
  await writeCacheFile(newUnreferenced, "newfile", newDate);
  await fs.writeFile(keepFile, "");

  const dryRun = await cache.runImageCacheCleanup({
    dryRun: true,
    now: "2026-05-16T00:00:00.000Z",
    retentionDays: 30,
    maxBytes: 10,
    referencedUrls: { work: [referencedRemoteUrl], activity: [] },
  });

  assert.equal(dryRun.totalFiles, 3);
  assert.equal(dryRun.protectedFiles, 1);
  assert.equal(dryRun.deletableFiles, 2);
  assert.equal(dryRun.deletableBytes, 10);
  assert.equal(await fs.readFile(path.join(publicRoot, oldUnreferenced.slice(1)), "utf8"), "old");

  const executed = await cache.runImageCacheCleanup({
    dryRun: false,
    now: "2026-05-16T00:00:00.000Z",
    retentionDays: 30,
    maxBytes: 10,
    referencedUrls: { work: [referencedRemoteUrl], activity: [] },
  });

  assert.equal(executed.deletedFiles, 2);
  assert.equal(executed.deletedBytes, 10);
  assert.equal(await fs.readFile(path.join(publicRoot, oldReferenced.slice(1)), "utf8"), "ref01");
  assert.equal(await fs.readFile(keepFile, "utf8"), "");
  await assert.rejects(fs.stat(path.join(publicRoot, oldUnreferenced.slice(1))), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(publicRoot, newUnreferenced.slice(1))), { code: "ENOENT" });
});

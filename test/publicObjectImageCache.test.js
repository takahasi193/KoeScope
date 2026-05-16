import assert from "node:assert/strict";
import test from "node:test";
import {
  publicObjectImageKey,
  resolvePublicObjectImage,
} from "../src/lib/publicObjectImageCache.js";

test("public object image keys are stable and provider-neutral", () => {
  const remoteUrl = "https://img.dlsite.jp/modpub/images2/work/doujin/RJ100001_img_main.webp?width=240#preview";
  const key = publicObjectImageKey(remoteUrl, { type: "work" });

  assert.match(key, /^koescope\/public-images\/works\/[a-f0-9]{24}\.webp$/);
  assert.equal(publicObjectImageKey(remoteUrl, { type: "work" }), key);
  assert.equal(publicObjectImageKey(remoteUrl, { type: "activity" }).includes("/activities/"), true);
  assert.equal(key.includes("/cache/"), false);
});

test("public object image resolver preserves remote image fallback", () => {
  const remoteUrl = "https://img.dlsite.jp/modpub/images2/work/doujin/RJ100001_img_main.jpg";

  assert.deepEqual(resolvePublicObjectImage(remoteUrl, { type: "work" }), {
    source: "remote",
    remoteImageUrl: remoteUrl,
    objectImageUrl: "",
    displayImageUrl: remoteUrl,
    objectKey: publicObjectImageKey(remoteUrl, { type: "work" }),
  });

  const resolved = resolvePublicObjectImage(remoteUrl, {
    type: "work",
    publicBaseUrl: "https://koescope.public.blob.vercel-storage.com/images/",
  });
  assert.equal(resolved.source, "object-cache");
  assert.equal(resolved.remoteImageUrl, remoteUrl);
  assert.equal(resolved.displayImageUrl, resolved.objectImageUrl);
  assert.match(
    resolved.objectImageUrl,
    /^https:\/\/koescope\.public\.blob\.vercel-storage\.com\/images\/koescope\/public-images\/works\/[a-f0-9]{24}\.jpg$/
  );
});

test("public object image resolver rejects unsafe inputs and non-HTTPS bases", () => {
  assert.deepEqual(resolvePublicObjectImage("javascript:alert(1)", { publicBaseUrl: "https://cdn.example" }), {
    source: "none",
    remoteImageUrl: "",
    objectImageUrl: "",
    displayImageUrl: "",
    objectKey: "",
  });

  const remoteUrl = "https://img.dlsite.jp/modpub/images2/work/doujin/RJ100001_img_main.jpg";
  const resolved = resolvePublicObjectImage(remoteUrl, {
    type: "work",
    publicBaseUrl: "http://cdn.example",
  });
  assert.equal(resolved.source, "remote");
  assert.equal(resolved.objectImageUrl, "");
  assert.equal(resolved.displayImageUrl, remoteUrl);
});

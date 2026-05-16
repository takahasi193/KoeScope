import assert from "node:assert/strict";
import test from "node:test";
import { createPublicSearchQuery } from "../src/lib/searchCacheKey.js";

test("public search query key is stable for canonical public DLsite inputs", () => {
  const first = createPublicSearchQuery({
    keyword: " Aoyama   Yukari ",
    personId: "123.8",
    aliases: ["Yukari", "  Aoyama Yukari  ", "YUKARI"],
    scope: "all",
    order: "dl_d",
    accountSession: "private-cookie",
    purchaseHistory: ["RJ100001"],
    watchlist: ["RJ100002"],
    annotations: { RJ100003: "local note" },
  });
  const second = createPublicSearchQuery({
    keyword: "Aoyama Yukari",
    personId: 123,
    aliases: [" yukari ", "Aoyama Yukari"],
    scope: "all",
    order: "dl_d",
  });

  assert.equal(first.queryKey, second.queryKey);
  assert.deepEqual(first.publicQuery, {
    version: "dlsite-search-v1",
    keyword: "aoyama yukari",
    personId: 123,
    aliases: ["yukari", "aoyama yukari"],
    scope: "all",
    order: "dl_d",
  });
  assert.equal(Object.hasOwn(first.publicQuery, "accountSession"), false);
  assert.equal(Object.hasOwn(first.publicQuery, "purchaseHistory"), false);
  assert.equal(Object.hasOwn(first.publicQuery, "watchlist"), false);
  assert.equal(Object.hasOwn(first.publicQuery, "annotations"), false);
});

test("public search query key changes across public result boundaries", () => {
  const base = createPublicSearchQuery({
    keyword: "Aoyama Yukari",
    personId: 123,
    aliases: ["Yukari"],
    scope: "all",
    order: "dl_d",
  });

  assert.notEqual(base.queryKey, createPublicSearchQuery({ ...base.publicQuery, scope: "nonAdult" }).queryKey);
  assert.notEqual(base.queryKey, createPublicSearchQuery({ ...base.publicQuery, order: "release_d" }).queryKey);
  assert.notEqual(base.queryKey, createPublicSearchQuery({ ...base.publicQuery, version: "dlsite-search-v2" }).queryKey);
});

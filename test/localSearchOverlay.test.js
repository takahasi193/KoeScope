import assert from "node:assert/strict";
import test from "node:test";
import { applyLocalSearchOverlay } from "../src/lib/localSearchOverlay.js";
import { buildPublicSearchCachePayload } from "../src/lib/publicSearchCachePayload.js";

function publicPayload() {
  return {
    keyword: "Aoyama Yukari",
    person: { id: 123, name: "Aoyama Yukari" },
    cache: {
      queryKey: "dlsite-search-v1:overlay0000000000000000000000",
      queryVersion: "dlsite-search-v1",
      publicQuery: {
        version: "dlsite-search-v1",
        keyword: "aoyama yukari",
        personId: 123,
        aliases: ["aoyama yukari"],
        scope: "all",
        order: "dl_d",
      },
    },
    items: [
      { productId: "RJ100001", title: "Watched Voice", imageUrl: "https://img.example/rj100001.jpg" },
      { productId: "RJ100002", title: "Owned Voice", imageUrl: "https://img.example/rj100002.jpg" },
    ],
  };
}

test("local search overlay applies private context after public cache load", () => {
  const source = publicPayload();
  const overlaid = applyLocalSearchOverlay(source, {
    watchlist: [{ productId: "rj100001", targetPriceJpy: 900, source: "local" }],
    annotations: [{ productId: "RJ100001", note: "private note", tags: ["ASMR"], status: "favorite" }],
    account: { hasSession: true, pointsJpy: 1200, isStale: false, lists: { collection: { productIds: ["RJ100002"] } } },
    accountLists: { wishlist: { productIds: ["RJ100001"] } },
    subscriptions: [{ personId: 123, lastCheckStatus: "completed", lastNewItemCount: 1 }],
  });

  assert.equal(overlaid.items[0].isWatched, true);
  assert.equal(overlaid.items[0].targetPriceJpy, 900);
  assert.equal(overlaid.items[0].annotation.note, "private note");
  assert.deepEqual(overlaid.items[0].account.listTypes, ["wishlist"]);
  assert.equal(overlaid.items[1].account.owned, true);
  assert.deepEqual(overlaid.items[1].account.listTypes, ["collection"]);
  assert.equal(overlaid.person.subscription.lastNewItemCount, 1);
  assert.equal(overlaid.localOverlay.account.pointsJpy, 1200);
  assert.equal(overlaid.localOverlay.claimsEntitlement, false);

  assert.equal(source.items[0].isWatched, undefined);
  assert.equal(source.person.subscription, undefined);
});

test("local search overlay remains private when payload is rebuilt for public cache", () => {
  const overlaid = applyLocalSearchOverlay(publicPayload(), {
    watchlist: [{ productId: "RJ100001", targetPriceJpy: 900 }],
    annotations: [{ productId: "RJ100001", note: "private note" }],
    account: { hasSession: true, pointsJpy: 1200, lists: { collection: { productIds: ["RJ100002"] } } },
  });

  const rebuilt = buildPublicSearchCachePayload(overlaid);
  const serialized = JSON.stringify(rebuilt);
  assert.equal(serialized.includes("private note"), false);
  assert.equal(serialized.includes("targetPrice"), false);
  assert.equal(serialized.includes("isWatched"), false);
  assert.equal(serialized.includes("localOverlay"), false);
  assert.equal(serialized.includes("pointsJpy"), false);
});

test("local search overlay tolerates empty or partial local context", () => {
  const overlaid = applyLocalSearchOverlay(publicPayload(), {
    watchlist: [{ productId: "" }],
    accountLists: { collection: { productIds: [""] } },
    subscriptions: [{ personId: 999, lastCheckStatus: "completed" }],
  });

  assert.equal(overlaid.items[0].isWatched, undefined);
  assert.equal(overlaid.items[0].account, undefined);
  assert.equal(overlaid.person.subscription, undefined);
  assert.equal(overlaid.localOverlay.watchlistMatches, 0);
});

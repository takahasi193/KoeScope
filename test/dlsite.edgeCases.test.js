import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateDlsiteResults,
  normalizeSearchOrder,
  parseSearchHtml,
  summarizeAgeGroups,
} from "../src/lib/dlsite.js";

test("parseSearchHtml tolerates empty or unrelated markup", () => {
  assert.deepEqual(parseSearchHtml("", "Alias", 1), []);
  assert.deepEqual(parseSearchHtml("<main><p>No result cards</p></main>", "Alias", 1), []);
});

test("aggregateDlsiteResults deduplicates products and keeps stronger metadata", () => {
  const result = aggregateDlsiteResults(
    [
      {
        alias: "Alias A",
        count: 1,
        items: [
          {
            productId: "RJ1",
            title: "Same Work",
            type: "voice",
            ageCategory: "general",
            ageLabel: "General",
            matchedAliases: ["Alias A"],
            matchedPages: [1],
            sales: 10,
          },
        ],
      },
      {
        alias: "Alias B",
        count: 1,
        items: [
          {
            productId: "RJ1",
            title: "Same Work",
            type: "voice",
            ageCategory: "r18",
            ageLabel: "R18",
            matchedAliases: ["Alias B"],
            matchedPages: [2],
            sales: 99,
          },
        ],
      },
      { alias: "Alias C", error: "network down" },
    ],
    { order: "sales" }
  );

  assert.equal(result.total, 1);
  assert.equal(result.order, "dl_d");
  assert.deepEqual(result.items[0].matchedAliases, ["Alias A", "Alias B"]);
  assert.deepEqual(result.items[0].matchedPages, [1, 2]);
  assert.equal(result.items[0].sales, 99);
  assert.equal(result.items[0].ageCategory, "r18");
  assert.deepEqual(result.errors, [{ alias: "Alias C", error: "network down" }]);
});

test("search order and age group helpers fall back safely", () => {
  assert.equal(normalizeSearchOrder("unknown-order"), "release_d");
  assert.equal(normalizeSearchOrder("popularity"), "dl_d");
  assert.equal(summarizeAgeGroups([{ ageCategory: "general" }, { ageCategory: "unknown" }]).general.count, 1);
});

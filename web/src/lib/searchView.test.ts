import assert from "node:assert/strict";
import test from "node:test";
import { aliasValues, countBy, matchesWorkFilter } from "./searchView";

test("search view filters works by existing type and age fields", () => {
  const voice = { type: "voice", ageCategory: "general" };
  const game = { type: "game", ageCategory: "r18" };

  assert.equal(matchesWorkFilter(voice, "voice", "general"), true);
  assert.equal(matchesWorkFilter(voice, "game", "general"), false);
  assert.equal(matchesWorkFilter(game, "all", "r18"), true);
});

test("search view extracts Bangumi alias values without inventing new API fields", () => {
  assert.deepEqual(aliasValues({ aliases: [{ value: "Aoyama Yukari" }, { value: "Yukari" }] }), [
    "Aoyama Yukari",
    "Yukari"
  ]);

  const counts = countBy([{ type: "voice" }, { type: "voice" }, { type: "game" }], (item) => item.type);
  assert.equal(counts.get("voice"), 2);
  assert.equal(counts.get("game"), 1);
});

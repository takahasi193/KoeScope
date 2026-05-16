import assert from "node:assert/strict";
import test from "node:test";
import {
  aliasValues,
  countBy,
  defaultSearchAliases,
  isVoiceActorPerson,
  matchesWorkFilter,
  personCategoryLabel,
  prioritizeSearchAliases
} from "./searchView";

test("search view filters works by existing type and age fields", () => {
  const voice = { type: "voice", ageCategory: "general" };
  const game = { type: "game", ageCategory: "r18" };

  assert.equal(matchesWorkFilter(voice, "voice", "general"), true);
  assert.equal(matchesWorkFilter(voice, "game", "general"), false);
  assert.equal(matchesWorkFilter(game, "all", "r18"), true);
});

test("search view classifies people and keeps voice-actor pen names as a sub-mode", () => {
  const voiceActor = {
    personCategory: "voice_actor",
    personCategoryLabel: "声优",
    aliases: [
      { value: "Official Name", isPenName: false },
      { value: "Pen Name", isPenName: true }
    ]
  };
  const writer = {
    personCategory: "writing",
    personCategoryLabel: "脚本/作者",
    aliases: [
      { value: "Writer Name", isPenName: false },
      { value: "Writer Alias", isPenName: true }
    ]
  };

  assert.equal(isVoiceActorPerson(voiceActor), true);
  assert.equal(isVoiceActorPerson(writer), false);
  assert.equal(personCategoryLabel(writer), "脚本/作者");
  assert.deepEqual(defaultSearchAliases(voiceActor, 12, "Typed", "penNames"), ["Typed", "Pen Name"]);
  assert.deepEqual(defaultSearchAliases(writer, 12, "Typed", "penNames"), ["Typed", "Writer Name", "Writer Alias"]);
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

test("search view prioritizes the typed keyword before Bangumi aliases", () => {
  assert.deepEqual(prioritizeSearchAliases("  Manual Alias  ", ["Bangumi Alias", "Manual Alias"]), [
    "Manual Alias",
    "Bangumi Alias"
  ]);

  assert.deepEqual(prioritizeSearchAliases("未登録マイナー名", [], 80), ["未登録マイナー名"]);
});

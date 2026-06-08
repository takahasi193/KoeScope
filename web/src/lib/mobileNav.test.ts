import assert from "node:assert/strict";
import test from "node:test";
import { mobileNavItems, resolveMobileNavKey } from "./mobileNav";

test("mobile navigation exposes the four core KoeScope pages", () => {
  assert.deepEqual(
    mobileNavItems.map((item) => [item.key, item.href]),
    [
      ["search", "/"],
      ["person", "/person.html"],
      ["monitor", "/dashboard.html"],
      ["activities", "/activities.html"]
    ]
  );
});

test("mobile navigation resolves the active item from exported and clean routes", () => {
  assert.equal(resolveMobileNavKey("/"), "search");
  assert.equal(resolveMobileNavKey("/index.html"), "search");
  assert.equal(resolveMobileNavKey("/person"), "person");
  assert.equal(resolveMobileNavKey("/person.html?id=123"), "person");
  assert.equal(resolveMobileNavKey("/dashboard"), "monitor");
  assert.equal(resolveMobileNavKey("/dashboard.html"), "monitor");
  assert.equal(resolveMobileNavKey("/activities"), "activities");
  assert.equal(resolveMobileNavKey("/activities.html?status=active"), "activities");
});

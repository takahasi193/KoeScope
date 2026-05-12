import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createThemeHarness({ savedTheme = "", readyState = "loading" } = {}) {
  const button = {
    dataset: {},
    textContent: "",
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
  };
  const storage = new Map(savedTheme ? [["koescope:theme", savedTheme]] : []);
  let domReady = null;
  const document = {
    readyState,
    documentElement: { dataset: {} },
    querySelectorAll: () => [button],
    addEventListener(name, listener) {
      if (name === "DOMContentLoaded") domReady = listener;
    },
  };
  const window = {
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };

  vm.runInNewContext(fs.readFileSync("public/theme.js", "utf8"), { window });
  return { button, document, domReady, storage, window };
}

test("theme defaults to light and persists a dark toggle", () => {
  const { button, document, domReady, storage } = createThemeHarness();

  assert.equal(document.documentElement.dataset.theme, "light");
  domReady();
  assert.equal(button.textContent, "Dark");

  button.listeners.click();
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(storage.get("koescope:theme"), "dark");
  assert.equal(button.textContent, "Light");
  assert.equal(button.attributes["aria-pressed"], "true");
});

test("theme applies a saved preference before binding buttons", () => {
  const { button, document } = createThemeHarness({ savedTheme: "dark", readyState: "complete" });

  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(button.textContent, "Light");
  assert.equal(button.attributes["aria-pressed"], "true");
});


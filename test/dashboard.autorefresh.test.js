import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createElement(selector = "") {
  return {
    selector,
    value:
      selector === "#categoryInput"
        ? "all"
        : selector === "#floorInput"
          ? "home"
          : selector === "#periodInput"
            ? "week"
            : "",
    checked: false,
    hidden: false,
    textContent: "",
    innerHTML: "",
    className: "",
    dataset: {},
    children: [],
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    addEventListener() {},
    append(child) {
      this.children.push(child);
    },
    querySelector(childSelector) {
      return createElement(`${selector} ${childSelector}`);
    },
    scrollIntoView() {},
  };
}

function createDashboardHarness({ running = false } = {}) {
  const elements = new Map();
  const timers = [];
  const requests = [];

  const getElement = (selector) => {
    if (!elements.has(selector)) elements.set(selector, createElement(selector));
    return elements.get(selector);
  };

  const status = {
    running,
    latestRun: running ? { id: 1, status: "running", progress: { completedTargets: 1, totalTargets: 6 } } : null,
    nextScheduledAt: "2026-05-09T00:00:00.000Z",
  };

  const context = vm.createContext({
    console,
    encodeURIComponent,
    Number,
    Promise,
    String,
    URLSearchParams,
    clearTimeout(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
    setTimeout(callback, delay) {
      const id = timers.length + 1;
      timers.push({ id, callback, delay, cleared: false });
      return id;
    },
    document: {
      body: createElement("body"),
      querySelector: getElement,
      createElement,
      addEventListener() {},
    },
    window: {
      prompt: () => null,
    },
    fetch: async (url, options = {}) => {
      const path = String(url);
      requests.push({ path, options });
      let body = {};
      if (path === "/api/dashboard/summary") {
        body = { totalWorks: 0, discountedWorks: 0, watchedWorks: 0, unreadAlerts: 0, notableDrops: [] };
      } else if (path === "/api/sync/status") {
        body = status;
      } else if (path.startsWith("/api/rankings")) {
        body = { floor: "home", period: "week", category: "all", capturedAt: null, items: [] };
      } else if (path.startsWith("/api/alerts")) {
        body = { items: [] };
      } else if (path === "/api/watchlist") {
        body = { items: [] };
      } else if (path === "/api/sync/dlsite-rankings" && options.method === "POST") {
        status.running = true;
        status.latestRun = { id: 1, status: "running", progress: { completedTargets: 0, totalTargets: 6 } };
        body = { alreadyRunning: false, run: status.latestRun };
      }
      return {
        ok: true,
        json: async () => body,
      };
    },
  });

  vm.runInContext(fs.readFileSync("public/dashboard.js", "utf8"), context);
  return { context, elements, requests, timers };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("dashboard preloads periodically while idle", async () => {
  const { timers } = createDashboardHarness({ running: false });
  await flushAsyncWork();

  assert.equal(timers.at(-1).delay, 10000);
});

test("dashboard switches to running refresh cadence when sync is active", async () => {
  const { elements, timers } = createDashboardHarness({ running: true });
  await flushAsyncWork();

  assert.equal(timers.at(-1).delay, 3000);
  assert.match(elements.get("#rankingBody").innerHTML, /sync-empty/);
  assert.match(elements.get("#rankingBody").innerHTML, /同步进度 1\/6/);
});

test("dashboard schedules an immediate preload after manual sync starts", async () => {
  const { context, requests, timers } = createDashboardHarness({ running: false });
  await flushAsyncWork();

  await vm.runInContext("startSync()", context);
  await flushAsyncWork();

  assert.equal(timers.at(-1).delay, 0);

  const syncRequest = requests.find((request) => request.path === "/api/sync/dlsite-rankings");
  assert.deepEqual(JSON.parse(syncRequest.options.body), {
    priority: {
      category: "all",
      floor: "home",
      period: "week",
    },
  });
});

test("dashboard account sync directs users to the extension path", async () => {
  const { context, elements, requests } = createDashboardHarness({ running: false });
  await flushAsyncWork();
  requests.length = 0;

  await vm.runInContext("syncAccount()", context);
  await flushAsyncWork();

  assert.equal(
    elements.get("#toast").textContent,
    "请在 Chrome 工具栏打开 DL Voice Search Companion，并点击“同步账号”。"
  );
  assert.equal(requests.some((request) => request.path === "/api/account/dlsite/sync"), false);
});

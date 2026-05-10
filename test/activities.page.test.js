import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createElement(selector = "") {
  const listeners = new Map();
  const classes = new Set();
  return {
    selector,
    value: "",
    checked: false,
    hidden: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    className: "",
    dataset: {},
    children: [],
    classList: {
      add(...names) {
        for (const name of names) classes.add(name);
      },
      remove(...names) {
        for (const name of names) classes.delete(name);
      },
      toggle(name, force) {
        const shouldAdd = force ?? !classes.has(name);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type) {
      listeners.get(type)?.({ target: this });
    },
    append(child) {
      this.children.push(child);
    },
    querySelector(childSelector) {
      return createElement(`${selector} ${childSelector}`);
    },
    closest() {
      return this;
    },
  };
}

function filterActivities(items, path) {
  const url = new URL(path, "http://127.0.0.1");
  const status = url.searchParams.get("status") || "active";
  const benefit = url.searchParams.get("benefit") || "all";
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const relatedOnly = url.searchParams.get("related") === "1";

  return items.filter((item) => {
    if (status === "unread" && !item.unreadAlerts.length) return false;
    if (status === "endingSoon" && item.activityId !== "dlsite:coupon") return false;
    if (benefit !== "all" && item.benefitType !== benefit) return false;
    if (search && !`${item.title} ${item.benefitSummary}`.toLowerCase().includes(search)) return false;
    if (relatedOnly && !item.relatedWorks.length) return false;
    return true;
  });
}

function createActivitiesHarness() {
  const elements = new Map();
  const requests = [];
  const timers = [];
  const benefitButtons = ["all", "point", "coupon", "discount", "free", "bonus", "info"].map((benefit) => {
    const button = createElement(`[data-benefit-filter="${benefit}"]`);
    button.dataset.benefitFilter = benefit;
    return button;
  });
  const statusButtons = ["active", "all", "endingSoon", "unread"].map((status) => {
    const button = createElement(`[data-status-filter="${status}"]`);
    button.dataset.statusFilter = status;
    return button;
  });
  const items = [
    {
      activityId: "dlsite:coupon",
      title: "30%OFFクーポン",
      url: "https://www.dlsite.com/maniax/campaign/coupon",
      imageUrl: "https://img.example/coupon.jpg",
      benefitType: "coupon",
      benefitLabel: "优惠券",
      benefitSummary: "ASMR 优惠券活动",
      startsAt: "2026-05-09T00:00:00.000Z",
      endsAt: "2026-05-10T12:00:00.000Z",
      details: {
        status: "parsed",
        summary: "领取后可用于音声作品。",
        claimCondition: "登录后领取",
        applicableScope: "音声",
        requiresLogin: true,
        fetchedAt: "2026-05-10T00:00:00.000Z",
      },
      relatedWorks: [
        {
          productId: "RJ100001",
          title: "Rain ASMR",
          url: "https://www.dlsite.com/maniax/work/=/product_id/RJ100001.html",
          imageUrl: "https://img.example/rain.jpg",
          sourceLabels: ["本地关注"],
          reasons: ["活动主题与作品分类同为音声/ASMR"],
        },
        {
          productId: "RJ01292821",
          title: "RJ01292821",
          circle: "JKギルティ",
          url: "https://www.dlsite.com/maniax/work/=/product_id/RJ01292821.html",
          imageUrl: "https://img.example/rj01292821.jpg",
          latestPriceJpy: 11,
          latestDiscountRate: 90,
          sourceLabels: ["DLsite 愿望单"],
          reasons: ["关注作品当前有折扣 90%OFF"],
        },
      ],
      unreadAlerts: [{ id: 7, message: "即将结束：30%OFFクーポン" }],
    },
    {
      activityId: "dlsite:point",
      title: "Point Present",
      url: "https://www.dlsite.com/home/campaign/point",
      imageUrl: "https://img.example/point.jpg",
      benefitType: "point",
      benefitLabel: "点数",
      benefitSummary: "点数返还活动",
      startsAt: "2026-05-09T00:00:00.000Z",
      endsAt: "2026-05-20T00:00:00.000Z",
      details: { status: "fallback", summary: "公开活动摘要。" },
      relatedWorks: [],
      unreadAlerts: [],
    },
  ];

  const getElement = (selector) => {
    if (!elements.has(selector)) elements.set(selector, createElement(selector));
    return elements.get(selector);
  };

  const context = vm.createContext({
    console,
    Date,
    Error,
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
      querySelector: getElement,
      querySelectorAll(selector) {
        if (selector === "[data-benefit-filter]") return benefitButtons;
        if (selector === "[data-status-filter]") return statusButtons;
        return [];
      },
      createElement,
      addEventListener() {},
    },
    window: {},
    fetch: async (url, options = {}) => {
      const path = String(url);
      requests.push({ path, options });
      let body = {};
      if (path === "/api/activities/status") {
        body = {
          running: false,
          latestRun: { id: 3, status: "completed", finishedAt: "2026-05-10T00:00:00.000Z" },
          nextScheduledAt: "2026-05-10T06:00:00.000Z",
        };
      } else if (path.startsWith("/api/activities?")) {
        const filteredItems = filterActivities(items, path);
        body = {
          generatedAt: "2026-05-10T00:00:00.000Z",
          unreadCount: 1,
          account: { hasSession: true, pointsJpy: 1200, lastSyncedAt: "2026-05-09T00:00:00.000Z", isStale: false },
          personalSummary: {
            relatedWorks: {
              totalMatches: 1,
              matchedWorks: 1,
              matchedActivities: 1,
              message: "发现 1 个可能相关的活动/作品匹配。",
            },
          },
          activityMatches: { totalMatches: 1, matchedWorks: 1, matchedActivities: 1 },
          items: filteredItems,
        };
      } else if (path === "/api/sync/dlsite-activities" && options.method === "POST") {
        body = { alreadyRunning: false, run: { id: 4, status: "running" } };
      } else if (path === "/api/activity-alerts/7/read" && options.method === "POST") {
        body = { ok: true, updated: true };
      }
      return {
        ok: true,
        json: async () => body,
      };
    },
  });

  vm.runInContext(fs.readFileSync("public/activityUi.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("public/activities.js", "utf8"), context);
  return { context, elements, requests, timers, benefitButtons, statusButtons };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("activities center renders activity details and applies filters", async () => {
  const { context, elements, requests, timers, benefitButtons, statusButtons } = createActivitiesHarness();
  await flushAsyncWork();

  assert.equal(elements.get("#activityResultCount").textContent, "2");
  assert.match(elements.get("#activityAccount").textContent, /1,200/);
  assert.match(elements.get("#activityPersonal").innerHTML, /发现 1 个可能相关/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /30%OFFクーポン/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /activity-detail parsed/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /Rain ASMR/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /JKギルティ \/ RJ01292821/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /标题待同步/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /当前 11円/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /data-action="read-activity-alert"/);
  assert.equal(benefitButtons.find((button) => button.dataset.benefitFilter === "all").classList.contains("is-active"), true);
  assert.equal(statusButtons.find((button) => button.dataset.statusFilter === "active").classList.contains("is-active"), true);

  requests.length = 0;
  await vm.runInContext("window.__activityCenter.setStatusFilter('unread')", context);
  await flushAsyncWork();
  assert.equal(requests.some((request) => request.path.includes("status=unread")), true);
  assert.equal(elements.get("#activityResultCount").textContent, "1");

  requests.length = 0;
  await vm.runInContext("window.__activityCenter.setBenefitFilter('coupon')", context);
  await flushAsyncWork();
  assert.equal(requests.some((request) => request.path.includes("benefit=coupon")), true);
  assert.equal(elements.get("#activityResultCount").textContent, "1");

  requests.length = 0;
  await vm.runInContext("window.__activityCenter.setRelatedOnly(true)", context);
  await flushAsyncWork();
  assert.equal(requests.some((request) => request.path.includes("related=1")), true);
  assert.equal(elements.get("#activityResultCount").textContent, "1");

  requests.length = 0;
  await vm.runInContext("window.__activityCenter.setActivitySearch('Point')", context);
  const debounce = timers.at(-1);
  assert.equal(debounce.delay, 250);
  debounce.callback();
  await flushAsyncWork();
  assert.equal(requests.some((request) => request.path.includes("search=Point")), true);
  assert.equal(elements.get("#activityResultCount").textContent, "0");

  requests.length = 0;
  await vm.runInContext("window.__activityCenter.markActivityAlertRead(7)", context);
  await flushAsyncWork();
  assert.equal(requests.some((request) => request.path === "/api/activity-alerts/7/read"), true);
});

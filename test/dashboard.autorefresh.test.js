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
            : selector === "#activityBenefitInput"
              ? "all"
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
    getContext(type) {
      return { selector, type };
    },
    scrollIntoView() {},
  };
}

function createDashboardHarness({ running = false, chartFactory = undefined, notificationPermission = "default" } = {}) {
  const elements = new Map();
  const timers = [];
  const requests = [];
  const notifications = [];

  const getElement = (selector) => {
    if (!elements.has(selector)) elements.set(selector, createElement(selector));
    return elements.get(selector);
  };

  const status = {
    running,
    latestRun: running ? { id: 1, status: "running", progress: { completedTargets: 1, totalTargets: 6 } } : null,
    nextScheduledAt: "2026-05-09T00:00:00.000Z",
  };

  function FakeNotification(title, options = {}) {
    notifications.push({ title, options });
  }
  FakeNotification.permission = notificationPermission;

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
      Chart: chartFactory,
      Notification: FakeNotification,
      prompt: () => null,
    },
    fetch: async (url, options = {}) => {
      const path = String(url);
      requests.push({ path, options });
      let body = {};
      if (path === "/api/dashboard/summary") {
        body = {
          totalWorks: 0,
          discountedWorks: 0,
          watchedWorks: 0,
          unreadAlerts: 0,
          activeActivities: 1,
          unreadActivityAlerts: 1,
          activityWorkMatches: 1,
          activityMatchedWorks: 1,
          activityMatchedActivities: 1,
          activityFollowedWorks: 1,
          notableDrops: [],
        };
      } else if (path === "/api/sync/status") {
        body = status;
      } else if (path === "/api/activities/status") {
        body = {
          running: false,
          latestRun: { id: 2, status: "completed", finishedAt: "2026-05-09T00:00:00.000Z" },
          nextScheduledAt: "2026-05-09T06:00:00.000Z",
        };
      } else if (path.startsWith("/api/activities")) {
        body = {
          generatedAt: "2026-05-10T00:00:00.000Z",
          unreadCount: 1,
          account: { hasSession: true, pointsJpy: 1200, lastSyncedAt: "2026-05-09T00:00:00.000Z", isStale: false },
          personalSummary: {
            syncState: "fresh",
            account: {
              hasSession: true,
              pointsJpy: 1200,
              lastSyncedAt: "2026-05-09T00:00:00.000Z",
              isStale: false,
            },
            activeBenefitCounts: { coupon: 1, all: 1 },
            highlights: [
              { id: "points", label: "Current points", value: 1200, valueText: "1,200 pt", tone: "default" },
              { id: "freshness", label: "Account sync", valueText: "Synced 2026-05-09T00:00:00.000Z", tone: "default" },
            ],
            entrypoints: [
              {
                benefit: "coupon",
                count: 1,
                label: "Coupon campaigns",
                description: "Public coupon campaigns; verify coupon ownership and eligibility on DLsite.",
                claimsEntitlement: false,
              },
            ],
            relatedWorks: {
              totalMatches: 1,
              matchedWorks: 1,
              matchedActivities: 1,
              followedWorks: 1,
              claimsEntitlement: false,
              message: "发现 1 个可能相关的活动/作品匹配。",
              disclaimer: "仅基于公开活动信息和本地/账号关注数据做保守匹配；优惠券领取、适用条件和最终价格请以 DLsite 页面为准。",
            },
            disclaimer: "Public activity entry; check DLsite for coupon ownership.",
          },
          items: [
            {
              activityId: "dlsite:1",
              title: "30%OFFクーポン",
              url: "https://www.dlsite.com/maniax/campaign/example",
              imageUrl: "https://img.example/banner.jpg",
              benefitType: "coupon",
              benefitLabel: "优惠券",
              benefitSummary: "可能提供优惠券。",
              startsAt: "2026-05-09T00:00:00.000Z",
              endsAt: "2026-05-11T00:00:00.000Z",
              details: {
                status: "parsed",
                summary: "Parsed coupon detail summary.",
                claimCondition: "Login before claiming.",
                applicableScope: "Voice works.",
                requiresLogin: true,
                isLimited: false,
                fetchedAt: "2026-05-10T00:00:00.000Z",
              },
              relatedWorks: [
                {
                  productId: "RJ100001",
                  title: "Rain ASMR",
                  url: "https://www.dlsite.com/maniax/work/=/product_id/RJ100001.html",
                  imageUrl: "https://img.example/rain.jpg",
                  sourceLabels: ["本地关注"],
                  reasons: ["活动主题与作品分类同为音声/ASMR", "来自本地 watchlist"],
                  claimsEntitlement: false,
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
                  claimsEntitlement: false,
                },
              ],
              unreadAlerts: [{ id: 1, message: "新活动：30%OFFクーポン" }],
            },
          ],
        };
      } else if (path.startsWith("/api/activity-alerts/summary")) {
        body = {
          unreadCount: 1,
          activeActivities: 1,
          endingSoonActivities: 1,
          typeCounts: { new_activity: 0, ending_soon: 1 },
          items: [
            {
              id: 7,
              activityId: "dlsite:1",
              type: "ending_soon",
              message: "Campaign ends soon.",
              activityTitle: "Campaign",
            },
          ],
        };
      } else if (path.startsWith("/api/rankings")) {
        body = { floor: "home", period: "week", category: "all", capturedAt: null, items: [] };
      } else if (path.startsWith("/api/alerts")) {
        body = {
          items: [
            {
              id: 91,
              productId: "RJ100003",
              type: "possible_new_work",
              title: "Fresh Voice",
              message: "Aoyama Yukari 可能的新作：Fresh Voice",
              createdAt: "2026-05-10T00:00:00.000Z",
              personId: 123,
              personName: "Aoyama Yukari",
            },
          ],
        };
      } else if (path.startsWith("/api/works/") && path.endsWith("/history")) {
        body = {
          work: {
            productId: "RJ100001",
            title: "Rain ASMR",
            circle: "Local Circle",
          },
          annotation: {
            productId: "RJ100001",
            status: "favorite",
            tags: ["ASMR", "sale"],
            note: "local note",
            createdAt: "2026-05-10T00:00:00.000Z",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
          priceSummary: {
            historicalLowPriceJpy: 900,
            historicalLowCapturedAt: "2026-05-03T00:00:00.000Z",
            priceSnapshotCount: 3,
          },
          prices: [
            { priceJpy: 1800, officialPriceJpy: 1800, capturedAt: "2026-05-01T00:00:00.000Z" },
            { priceJpy: null, officialPriceJpy: 1800, capturedAt: "2026-05-02T00:00:00.000Z" },
            { priceJpy: 900, officialPriceJpy: 1800, capturedAt: "2026-05-03T00:00:00.000Z" },
          ],
          ranks: [
            { floor: "home", period: "week", category: "voice", rank: 12, capturedAt: "2026-05-01T00:00:00.000Z" },
            { floor: "home", period: "week", category: "voice", rank: 4, capturedAt: "2026-05-03T00:00:00.000Z" },
          ],
        };
      } else if (path === "/api/watchlist") {
        body = { items: [] };
      } else if (path === "/api/account/dlsite") {
        body = { hasSession: true, pointsJpy: 1600, lists: {}, lastSyncedAt: "2026-05-10T00:00:00.000Z" };
      } else if (path.startsWith("/api/recommendations/affordable")) {
        body = { budgetJpy: 1600, items: [] };
      } else if (path.startsWith("/api/recommendations/bundles")) {
        body = {
          budgetJpy: 1600,
          items: [
            {
              circle: "Bundle Circle",
              itemCount: 2,
              totalPriceJpy: 1500,
              leftoverJpy: 100,
              discountRate: 45,
              claimsCheckoutOptimization: false,
              items: [
                { productId: "RJ600001", title: "Bundle Voice 1", latestPriceJpy: 800 },
                { productId: "RJ600002", title: "Bundle Voice 2", latestPriceJpy: 700 },
              ],
            },
          ],
        };
      } else if (path === "/api/sync/dlsite-rankings" && options.method === "POST") {
        status.running = true;
        status.latestRun = { id: 1, status: "running", progress: { completedTargets: 0, totalTargets: 6 } };
        body = { alreadyRunning: false, run: status.latestRun };
      } else if (path === "/api/sync/dlsite-activities" && options.method === "POST") {
        body = { alreadyRunning: false, run: { id: 2, status: "running" } };
      }
      return {
        ok: true,
        json: async () => body,
      };
    },
  });

  vm.runInContext(fs.readFileSync("public/activityUi.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("public/dashboard.js", "utf8"), context);
  return { context, elements, requests, timers, notifications };
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

test("dashboard loads activities and starts manual activity refresh", async () => {
  const { context, elements, requests, timers } = createDashboardHarness({ running: false });
  await flushAsyncWork();

  assert.match(elements.get("#activityList").children[0].innerHTML, /30%OFFクーポン/);
  assert.match(elements.get("#activityAccount").textContent, /1,200/);
  assert.equal(elements.has("#activityPersonal"), false);
  assert.match(elements.get("#activityList").children[0].innerHTML, /<details class="activity-related">/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /Rain ASMR/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /JKギルティ \/ RJ01292821/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /标题待同步/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /当前 11円/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /90%OFF/);
  assert.match(elements.get("#activityList").children[0].innerHTML, /优惠券领取和适用条件/);
  assert.doesNotMatch(elements.get("#activityList").children[0].innerHTML, /activity-detail/);
  assert.match(elements.get("#activityCaption").textContent, /未读 1/);
  assert.equal(
    requests.some((request) => request.path === "/api/activities?status=active&benefit=all&limit=3"),
    true
  );

  requests.length = 0;
  await vm.runInContext("startActivitySync()", context);
  await flushAsyncWork();

  assert.equal(timers.at(-1).delay, 0);
  assert.equal(requests.some((request) => request.path === "/api/sync/dlsite-activities"), true);
});

test("dashboard renders history trend charts while preserving snapshot lists", async () => {
  const chartCalls = [];
  function FakeChart(context, config) {
    chartCalls.push({ context, config });
    this.destroy = () => chartCalls.push({ destroyed: config.data.datasets[0].label });
  }
  const { context, elements } = createDashboardHarness({ running: false, chartFactory: FakeChart });
  await flushAsyncWork();

  await vm.runInContext('showHistory("RJ100001")', context);
  await flushAsyncWork();

  assert.equal(chartCalls.length, 2);
  assert.equal(chartCalls[0].config.data.datasets[0].label, "Price");
  assert.deepEqual(chartCalls[0].config.data.datasets[0].data, [1800, 900]);
  assert.equal(chartCalls[1].config.data.datasets[0].label, "Rank");
  assert.deepEqual(chartCalls[1].config.data.datasets[0].data, [12, 4]);
  assert.equal(chartCalls[1].config.options.scales.y.reverse, true);
  assert.match(elements.get("#priceHistory").innerHTML, /史低/);
  assert.match(elements.get("#rankHistory").innerHTML, /#4/);
  assert.equal(elements.get("#annotationStatus").value, "favorite");
  assert.equal(elements.get("#annotationTags").value, "ASMR, sale");
  assert.equal(elements.get("#annotationNote").value, "local note");
  assert.equal(elements.get("#priceTrendEmpty").hidden, true);
  assert.equal(elements.get("#rankTrendEmpty").hidden, true);
});

test("dashboard account sync directs users to the extension path", async () => {
  const { context, elements, requests } = createDashboardHarness({ running: false });
  await flushAsyncWork();
  requests.length = 0;

  await vm.runInContext("syncAccount()", context);
  await flushAsyncWork();

  assert.equal(
    elements.get("#toast").textContent,
    "请在 Chrome 工具栏打开 KoeScope Companion，并点击“同步账号”。"
  );
  assert.equal(requests.some((request) => request.path === "/api/account/dlsite/sync"), false);
});

test("dashboard renders possible new work alerts with person links", async () => {
  const { elements } = createDashboardHarness({ running: false });
  await flushAsyncWork();

  assert.match(elements.get("#alertList").children[0].innerHTML, /可能的新作/);
  assert.match(elements.get("#alertList").children[0].innerHTML, /person\.html\?id=123/);
  assert.match(elements.get("#alertList").children[0].innerHTML, /Aoyama Yukari/);
});

test("dashboard renders bundle advice and dedupes open-page browser notifications", async () => {
  const { context, elements, notifications } = createDashboardHarness({
    running: false,
    notificationPermission: "granted",
  });
  await flushAsyncWork();

  assert.match(elements.get("#bundleList").children[0].innerHTML, /Bundle Circle/);
  assert.match(elements.get("#bundleList").children[0].innerHTML, /Bundle Voice 1/);
  assert.equal(notifications.length, 2);
  assert.equal(notifications.some((item) => item.options.tag.startsWith("price:91")), true);
  assert.equal(notifications.some((item) => item.options.tag.startsWith("activity:7")), true);

  await vm.runInContext("refreshAll()", context);
  await flushAsyncWork();
  assert.equal(notifications.length, 2);
});

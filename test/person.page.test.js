import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createElement(selector = "") {
  const classes = new Set();
  const listeners = new Map();
  return {
    selector,
    value: "",
    hidden: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    src: "",
    alt: "",
    dataset: {},
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
    setAttribute(name, value) {
      this[name] = value;
    },
    removeAttribute(name) {
      delete this[name];
    },
    querySelector() {
      return createElement(`${selector} child`);
    },
    closest() {
      return this;
    },
  };
}

function createPersonHarness() {
  const ids = [
    "serverStatus",
    "personImage",
    "personName",
    "personMeta",
    "dataSource",
    "aliasSummary",
    "moegirlStatus",
    "moegirlSummary",
    "moegirlWorks",
    "moegirlSource",
    "keywordInput",
    "keywordButton",
    "aliasCount",
    "aliasList",
    "searchCount",
    "recentList",
    "statsGrid",
    "workSummary",
    "sortInput",
    "typeInput",
    "ageInput",
    "activeSource",
    "clearSessionButton",
    "subscriptionStatus",
    "subscriptionMeta",
    "subscribeButton",
    "checkSubscriptionButton",
    "unsubscribeButton",
    "workList",
    "toast",
  ];
  const elements = new Map(ids.map((id) => [`#${id}`, createElement(`#${id}`)]));
  const sortButtons = ["hot", "latest"].map((sort) => {
    const button = createElement(`[data-person-sort="${sort}"]`);
    button.dataset.personSort = sort;
    return button;
  });
  const requests = [];

  const profile = {
    person: { id: 123, name: "Aoyama Yukari", image: "https://img.example/person.jpg" },
    aliases: [
      { value: "Yukari", isPenName: true, searched: true },
      { value: "Aoyama Yukari", isPenName: false, searched: true },
    ],
    stats: {
      totalWorks: 2,
      voiceWorks: 1,
      r18Works: 1,
      generalWorks: 1,
      watchedWorks: 1,
      totalSales: 1400,
      searchSessions: 2,
      latestSearchAt: "2026-05-10T02:00:00.000Z",
    },
    recentSearches: [
      {
        id: "search-2",
        updatedAt: "2026-05-10T02:00:00.000Z",
        order: "dl_d",
        orderLabel: "贩卖总数",
        aliases: ["Yukari"],
        total: 1,
        status: "completed",
      },
      {
        id: "search-1",
        updatedAt: "2026-05-10T01:00:00.000Z",
        order: "release_d",
        orderLabel: "最新",
        aliases: ["Aoyama Yukari", "Yukari"],
        total: 2,
        status: "completed",
      },
    ],
    subscription: {
      personId: 123,
      personName: "Aoyama Yukari",
      aliases: ["Aoyama Yukari", "Yukari"],
      lastCheckStatus: "completed",
      lastCheckedAt: "2026-05-10T03:00:00.000Z",
      lastError: "",
      lastNewItemCount: 1,
    },
    moegirl: {
      status: "found",
      sourceName: "萌娘百科",
      title: "青山由香里",
      sourceUrl: "https://zh.moegirl.org.cn/青山由香里",
      summary: "青山由香里是日本的女性声优，主要从事成人游戏的配音工作。",
      representativeText: "风见一姬《灰色系列》",
      notableWorks: [{ title: "灰色系列", role: "风见一姬" }],
      matchedBy: "search",
      fetchedAt: "2026-06-03T00:00:00.000Z",
    },
    dataSource: { kind: "local_search_history" },
  };

  function worksFor(path) {
    const url = new URL(path, "http://127.0.0.1");
    return {
      personId: 123,
      filters: {
        sort: url.searchParams.get("sort") || "hot",
        type: url.searchParams.get("type") || "all",
        age: url.searchParams.get("age") || "all",
        sessionId: url.searchParams.get("sessionId") || "",
      },
      total: 2,
      items: [
        {
          productId: "RJ100001",
          title: "Rain ASMR",
          url: "https://www.dlsite.com/home/work/=/product_id/RJ100001.html",
          image: "https://img.example/RJ100001.jpg",
          circle: "Local Circle",
          floor: "home",
          type: "voice",
          typeLabel: "音声/ASMR",
          ageCategory: "general",
          ageLabel: "全年龄",
          priceJpy: 1200,
          sales: 1000,
          matchedAliases: ["Yukari"],
          searchUpdatedAt: "2026-05-10T02:00:00.000Z",
          isWatched: true,
          annotation: {
            productId: "RJ100001",
            status: "planned",
            tags: ["ASMR", "sale"],
            note: "local note",
          },
        },
        {
          productId: "RJ100002",
          title: "Moon Game",
          url: "https://www.dlsite.com/maniax/work/=/product_id/RJ100002.html",
          image: "https://img.example/RJ100002.jpg",
          circle: "Game Circle",
          floor: "maniax",
          type: "game",
          typeLabel: "游戏",
          ageCategory: "r18",
          ageLabel: "R18",
          sales: 400,
          matchedAliases: ["Aoyama Yukari"],
          searchUpdatedAt: "2026-05-10T01:00:00.000Z",
          isWatched: false,
        },
      ],
    };
  }

  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    document: {
      title: "",
      querySelector(selector) {
        return elements.get(selector) ?? createElement(selector);
      },
      querySelectorAll(selector) {
        return selector === "[data-person-sort]" ? sortButtons : [];
      },
    },
    window: {
      location: { search: "?id=123" },
      history: { replaceState() {} },
      prompt: () => "",
    },
    fetch: async (path, options = {}) => {
      requests.push(String(path));
      if (path === "/api/health") return { ok: true, json: async () => ({ ok: true }) };
      if (path === "/api/persons/123/profile") return { ok: true, json: async () => profile };
      if (path === "/api/persons/123/subscription" && options.method === "PUT") {
        const body = JSON.parse(options.body || "{}");
        profile.subscription = {
          ...profile.subscription,
          personId: 123,
          personName: body.personName,
          aliases: body.aliases,
          keyword: body.keyword,
          lastCheckStatus: "completed",
          lastCheckedAt: "2026-05-10T03:00:00.000Z",
          lastNewItemCount: 1,
        };
        return { ok: true, json: async () => profile.subscription };
      }
      if (String(path).startsWith("/api/persons/123/works")) {
        return { ok: true, json: async () => worksFor(path) };
      }
      return { ok: false, json: async () => ({ error: "not found" }) };
    },
  });

  context.window.window = context.window;
  return { context, elements, requests };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not met");
}

test("person detail page renders persisted profile and switches work sources", async () => {
  const { context, elements, requests } = createPersonHarness();
  vm.runInContext(fs.readFileSync("public/person.js", "utf8"), context);

  await waitFor(() => context.window.__personDetail.state.works);

  assert.equal(elements.get("#personName").textContent, "Aoyama Yukari");
  assert.equal(elements.get("#moegirlStatus").textContent, "萌娘百科资料");
  assert.match(elements.get("#moegirlSummary").textContent, /日本的女性声优/);
  assert.match(elements.get("#moegirlWorks").innerHTML, /灰色系列/);
  assert.match(elements.get("#moegirlWorks").innerHTML, /风见一姬/);
  assert.match(elements.get("#statsGrid").innerHTML, /总作品/);
  assert.match(elements.get("#aliasList").innerHTML, /马甲/);
  assert.match(elements.get("#workList").innerHTML, /Rain ASMR/);
  assert.match(elements.get("#workList").innerHTML, /已关注/);
  assert.match(elements.get("#workList").innerHTML, /待购/);
  assert.match(elements.get("#workList").innerHTML, /local note/);
  assert.match(elements.get("#workList").innerHTML, /data-action="annotation"/);
  assert.equal(elements.get("#subscriptionStatus").textContent, "已订阅");
  assert.match(elements.get("#subscriptionMeta").textContent, /新增 1 条提醒/);
  assert.ok(requests.some((path) => path.includes("/api/persons/123/works?sort=hot")));

  await vm.runInContext("window.__personDetail.setSort('latest')", context);
  assert.ok(requests.some((path) => path.includes("sort=latest")));

  await vm.runInContext("window.__personDetail.selectSession('search-1')", context);
  assert.match(elements.get("#activeSource").textContent, /单次搜索/);
  assert.ok(requests.some((path) => path.includes("sessionId=search-1")));
});

test("person detail subscription update shows an informative toast", async () => {
  const { context, elements } = createPersonHarness();
  vm.runInContext(fs.readFileSync("public/person.js", "utf8"), context);

  await waitFor(() => context.window.__personDetail.state.works);
  await vm.runInContext("window.__personDetail.saveSubscription()", context);

  assert.equal(elements.get("#toast").hidden, false);
  assert.match(elements.get("#toast").textContent, /\u8ba2\u9605\u5df2\u66f4\u65b0/);
  assert.match(elements.get("#toast").textContent, /2 \u4e2a\u522b\u540d/);
});

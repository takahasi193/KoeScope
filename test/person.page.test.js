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
    fetch: async (path) => {
      requests.push(String(path));
      if (path === "/api/health") return { ok: true, json: async () => ({ ok: true }) };
      if (path === "/api/persons/123/profile") return { ok: true, json: async () => profile };
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
  assert.match(elements.get("#statsGrid").innerHTML, /总作品/);
  assert.match(elements.get("#aliasList").innerHTML, /马甲/);
  assert.match(elements.get("#workList").innerHTML, /Rain ASMR/);
  assert.match(elements.get("#workList").innerHTML, /已关注/);
  assert.ok(requests.some((path) => path.includes("/api/persons/123/works?sort=hot")));

  await vm.runInContext("window.__personDetail.setSort('latest')", context);
  assert.ok(requests.some((path) => path.includes("sort=latest")));

  await vm.runInContext("window.__personDetail.selectSession('search-1')", context);
  assert.match(elements.get("#activeSource").textContent, /单次搜索/);
  assert.ok(requests.some((path) => path.includes("sessionId=search-1")));
});

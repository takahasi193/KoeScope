import {
  buildNotificationItems,
  normalizeBackendBase,
  notificationIdFor,
  selectNewNotificationItems,
} from "./notificationPolling.js";

const MENU_ID = "koescope-selection";
const ACCOUNT_SYNC_STATUS_KEY = "dlsiteAccountSyncStatus";
const NOTIFICATION_STATE_KEY = "koescopeNotificationState";
const NOTIFICATION_ALARM_NAME = "koescope-unread-alerts";
const NOTIFICATION_POLL_MINUTES = 15;
const NOTIFICATION_ICON = "icons/koescope-icon-128.png";
const ACCOUNT_LIST_MAX_PAGES = 30;
const DLSITE_ACCOUNT_PAGES = [
  { type: "point", label: "点数", url: "https://www.dlsite.com/home/mypage" },
  { type: "wishlist", floor: "home", label: "全年龄关注", url: "https://www.dlsite.com/home/mypage/wishlist" },
  { type: "wishlist", floor: "maniax", label: "R18 关注", url: "https://www.dlsite.com/maniax/mypage/wishlist" },
  {
    type: "collection",
    floor: "home",
    label: "全年龄已购",
    url: "https://www.dlsite.com/home/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/1",
  },
  {
    type: "collection",
    floor: "maniax",
    label: "R18 已购",
    url: "https://www.dlsite.com/maniax/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/1",
  },
];
const DLSITE_ACCOUNT_ANCHOR_PAGE = DLSITE_ACCOUNT_PAGES[0];
const DLSITE_ACCOUNT_LIST_PAGES = DLSITE_ACCOUNT_PAGES.slice(1);

let activeAccountSync = null;

function normalizeKeyword(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function nowIso() {
  return new Date().toISOString();
}

async function setAccountSyncStatus(patch) {
  const existing = await chrome.storage.local.get(ACCOUNT_SYNC_STATUS_KEY);
  await chrome.storage.local.set({
    [ACCOUNT_SYNC_STATUS_KEY]: {
      ...(existing[ACCOUNT_SYNC_STATUS_KEY] ?? {}),
      ...patch,
      updatedAt: nowIso(),
    },
  });
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function readBackendBase() {
  const data = await chrome.storage.local.get("backendBase");
  return normalizeBackendBase(data.backendBase);
}

async function readNotificationState() {
  const data = await chrome.storage.local.get(NOTIFICATION_STATE_KEY);
  return data[NOTIFICATION_STATE_KEY] ?? {};
}

async function writeNotificationState(state) {
  await chrome.storage.local.set({ [NOTIFICATION_STATE_KEY]: state });
}

async function fetchNotificationItems(baseUrl) {
  const [alertsPayload, activitySummary] = await Promise.all([
    getJson(baseUrl, "/api/alerts?status=unread&limit=8"),
    getJson(baseUrl, "/api/activity-alerts/summary?limit=8"),
  ]);
  return buildNotificationItems({ alertsPayload, activitySummary });
}

async function showNotificationItem(item) {
  if (!chrome.notifications?.create) return;
  await chrome.notifications.create(notificationIdFor(item), {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: item.title,
    message: item.message,
    contextMessage: item.context || "KoeScope",
    priority: 1,
  });
}

async function pollUnreadNotifications() {
  const previousState = await readNotificationState();
  try {
    const backendBase = await readBackendBase();
    const items = await fetchNotificationItems(backendBase);
    const { newItems, nextState } = selectNewNotificationItems(items, previousState);
    await writeNotificationState({ ...nextState, backendBase });
    for (const item of newItems) await showNotificationItem(item);
  } catch (error) {
    await writeNotificationState({
      ...previousState,
      lastCheckedAt: nowIso(),
      lastError: error.message,
    });
  }
}

function scheduleNotificationPolling() {
  if (!chrome.alarms?.create) return;
  chrome.alarms.create(NOTIFICATION_ALARM_NAME, {
    periodInMinutes: NOTIFICATION_POLL_MINUTES,
    delayInMinutes: 1,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createChromeTab(url) {
  return chrome.tabs.create({ url, active: false });
}

async function closeChromeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The tab may already be closed by the user or browser.
  }
}

function looksLikeLoginPage(page) {
  const url = String(page?.finalUrl || page?.url || "");
  const html = String(page?.html || "");
  return /\/regist\/user|\/login/i.test(url) || /name=["']login_id["']|login_form/i.test(html);
}

async function readTabDocument(tabId, page) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [page],
    func: (pageMeta) => {
      const escapeHtml = (value) =>
        String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      const productPattern = /\b[A-Z]{1,4}\d{6,10}\b/i;

      if (pageMeta.type === "point") {
        const pointNodes = [
          ...document.querySelectorAll("[class*='point'], [id*='point'], [class*='balance'], [id*='balance']"),
        ]
          .slice(0, 30)
          .map((node) => node.outerHTML)
          .join("");
        const pageText = document.body?.innerText || "";

        return {
          html: `<main>${pointNodes}<pre>${escapeHtml(pageText.slice(0, 12000))}</pre></main>`,
          title: document.title || "",
          url: location.href,
          readyState: document.readyState,
          itemCount: 0,
          productIds: [],
        };
      }

      const snippets = [];
      const seen = new Set();
      const nextUrls = new Set();
      const candidates = [
        ...document.querySelectorAll(
          "[data-product_id], [data-list_item_product_id], input.__product_attributes, a[href*='/product_id/']"
        ),
      ];

      for (const node of candidates) {
        const context =
          node.closest("li, tr, article, .n_worklist_item, .worklist_item, .search_result_img_box_inner, .work") ||
          node.parentElement;
        const html = context?.outerHTML || node.outerHTML || "";
        const productId =
          node.getAttribute?.("data-product_id") ||
          node.getAttribute?.("data-list_item_product_id") ||
          html.match(productPattern)?.[0] ||
          "";
        const normalized = productId.toUpperCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        snippets.push(html);
        if (snippets.length >= 120) break;
      }

      if (snippets.length === 0) {
        snippets.push(`<pre>${escapeHtml((document.body?.innerText || "").slice(0, 4000))}</pre>`);
      }

      for (const link of document.querySelectorAll("a[href]")) {
        const href = link.getAttribute("href") || "";
        const text = (link.innerText || link.textContent || "").trim();
        const rel = link.getAttribute("rel") || "";
        const className = link.getAttribute("class") || "";
        const combined = `${text} ${rel} ${className}`;
        const isPageLink =
          /(?:^|[^\w])(?:next|>|>>|次へ|次|page|pager|pagination)(?:[^\w]|$)/i.test(combined) ||
          /(?:^|[^\w])\d{1,4}(?:[^\w]|$)/.test(text) ||
          /\/page\/\d+/i.test(href) ||
          /(?:[?&/])page(?:[=/]|\d)/i.test(href);
        if (!isPageLink) continue;

        try {
          const url = new URL(href, location.href);
          const isAccountListLink = url.pathname.includes("/mypage/wishlist") || url.pathname.includes("/mypage/userbuy");
          if (url.hostname.endsWith("dlsite.com") && isAccountListLink) nextUrls.add(url.toString());
        } catch {
          // Ignore malformed links from ads or script templates.
        }
      }

      return {
        html: `<main>${snippets.join("")}</main>`,
        title: document.title || "",
        url: location.href,
        readyState: document.readyState,
        itemCount: seen.size,
        productIds: [...seen],
        nextUrls: [...nextUrls],
      };
    },
  });

  return results?.[0]?.result ?? { html: "", title: "", url: "" };
}

async function waitForReadableDocument(tabId, page, timeoutMs = 9000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await readTabDocument(tabId, page);
      const isTargetPage = /(^|\.)dlsite\.com/i.test(new URL(payload.url || page.url).hostname);
      const hasBody = payload.html && payload.html.length > 40;
      if (isTargetPage && hasBody && payload.readyState !== "loading") return payload;
    } catch (error) {
      lastError = error;
    }

    await sleep(400);
  }

  throw lastError ?? new Error(`${page.label} 页面读取超时。`);
}

async function captureDlsiteAccountPage(page) {
  let accountTab = null;

  try {
    accountTab = await createChromeTab(page.url);
    const documentPayload = await waitForReadableDocument(accountTab.id, page);

    return {
      ...page,
      sourceUrl: page.url,
      finalUrl: documentPayload.url || accountTab.url || page.url,
      status: 200,
      title: documentPayload.title || "",
      html: documentPayload.html || "",
      itemCount: documentPayload.itemCount || 0,
      productIds: documentPayload.productIds || [],
      nextUrls: documentPayload.nextUrls || [],
    };
  } catch (error) {
    return {
      ...page,
      sourceUrl: page.url,
      finalUrl: accountTab?.url || page.url,
      status: 0,
      title: "",
      html: "",
      error: error.message,
    };
  } finally {
    if (accountTab?.id) await closeChromeTab(accountTab.id);
  }
}

function knownProductIdsFor(page, syncState) {
  return new Set(syncState?.lists?.[page.type]?.productIds ?? []);
}

function shouldStopIncrementalList(page, captured, syncState, mode) {
  if (mode !== "quick") return false;
  const knownIds = knownProductIdsFor(page, syncState);
  const productIds = captured.productIds ?? [];
  return knownIds.size > 0 && productIds.length > 0 && productIds.every((productId) => knownIds.has(productId));
}

async function captureDlsiteAccountList(
  page,
  { maxPages = ACCOUNT_LIST_MAX_PAGES, mode = "quick", syncState = {} } = {}
) {
  const queue = [page.url];
  const visited = new Set();
  const pages = [];
  let stoppedEarly = false;
  let hitPageLimit = false;

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    const captured = await captureDlsiteAccountPage({ ...page, url });
    if (shouldStopIncrementalList(page, captured, syncState, mode)) {
      stoppedEarly = true;
      pages.push({ ...captured, sourceUrl: page.url, incrementalBoundary: true });
      break;
    }

    pages.push({ ...captured, sourceUrl: page.url });

    for (const nextUrl of captured.nextUrls ?? []) {
      if (!visited.has(nextUrl) && !queue.includes(nextUrl) && visited.size + queue.length < maxPages) {
        queue.push(nextUrl);
      } else if (!visited.has(nextUrl) && !queue.includes(nextUrl)) {
        hitPageLimit = true;
      }
    }
  }

  const fullSync =
    !stoppedEarly && !hitPageLimit && queue.length === 0 && pages.every((captured) => captured.html && !captured.error);
  return pages.map((captured) => ({
    ...captured,
    syncMode: mode,
    fullSync,
  }));
}

async function runDlsiteAccountSync({ backendBase, mode = "quick" }) {
  const syncMode = mode === "full" ? "full" : "quick";
  const startedAt = nowIso();
  await setAccountSyncStatus({
    status: "running",
    mode: syncMode,
    message: syncMode === "full" ? "正在准备深度同步 DLsite 账号..." : "正在准备快速同步 DLsite 账号...",
    startedAt,
    finishedAt: null,
    error: "",
  });

  try {
    const anchorPage = await captureDlsiteAccountPage(DLSITE_ACCOUNT_ANCHOR_PAGE);
    await setAccountSyncStatus({
      status: "running",
      message: "已读取 mypage，正在判断登录状态...",
      pages: [anchorPage].map(({ label, finalUrl, status, itemCount, error }) => ({
        label,
        finalUrl,
        status,
        itemCount,
        error,
      })),
    });

    if (!anchorPage.html) {
      throw new Error(anchorPage.error || "mypage 页面读取失败，请稍后重试。上次成功同步的数据仍会保留。");
    }

    if (looksLikeLoginPage(anchorPage)) {
      throw new Error("Chrome 中的 DLsite 登录态已失效。请在 Chrome 打开 DLsite 并登录后再同步；上次成功同步的数据不会被清空。");
    }

    await setAccountSyncStatus({
      status: "running",
      message: "登录状态有效，正在读取关注和已购列表...",
    });

    const syncState = syncMode === "quick" ? await getJson(backendBase, "/api/account/dlsite/sync-state").catch(() => ({})) : {};
    const listPageGroups = await Promise.all(
      DLSITE_ACCOUNT_LIST_PAGES.map((page) => captureDlsiteAccountList(page, { mode: syncMode, syncState }))
    );
    const listPages = listPageGroups.flat();
    const pages = [anchorPage, ...listPages];
    const captured = pages.filter((page) => page.html).length;
    await setAccountSyncStatus({
      status: "running",
      message: `已读取 ${captured} 个账号页面，正在导入本地...`,
      pages: pages.map(({ label, finalUrl, status, itemCount, error }) => ({
        label,
        finalUrl,
        status,
        itemCount,
        error,
      })),
    });

    const payload = await postJson(backendBase, "/api/account/dlsite/import-pages", { pages, syncMode });
    await setAccountSyncStatus({
      status: "completed",
      message: syncMode === "full" ? "DLsite 账号已深度同步。" : "DLsite 账号已快速同步。",
      finishedAt: nowIso(),
      profile: payload.profile,
      lists: payload.lists,
      errors: payload.errors ?? [],
    });
    await chrome.action.setBadgeText({ text: "" });
    return payload;
  } catch (error) {
    await setAccountSyncStatus({
      status: "failed",
      message: error.message,
      error: error.message,
      finishedAt: nowIso(),
    });
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
    throw error;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleNotificationPolling();
  void pollUnreadNotifications();

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '用 KoeScope 搜索 "%s"',
      contexts: ["selection"],
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleNotificationPolling();
  void pollUnreadNotifications();
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === NOTIFICATION_ALARM_NAME) void pollUnreadNotifications();
});

chrome.notifications?.onClicked?.addListener(async (notificationId) => {
  if (!String(notificationId).startsWith("koescope-")) return;
  const backendBase = await readBackendBase();
  const hash = notificationId.includes("activity") ? "#activities" : "";
  await chrome.tabs.create({ url: `${backendBase}/dashboard.html${hash}`, active: true });
  await chrome.notifications.clear(notificationId).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;

  const keyword = normalizeKeyword(info.selectionText);
  if (!keyword) return;

  await chrome.storage.local.set({
    pendingKeyword: keyword,
    pendingKeywordAt: Date.now(),
  });

  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.action.setBadgeText({ text: "1" });
    await chrome.action.setBadgeBackgroundColor({ color: "#08756f" });
  }
});

chrome.action.onClicked.addListener(async () => {
  await chrome.action.setBadgeText({ text: "" });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "START_DLSITE_ACCOUNT_SYNC") return false;

  if (activeAccountSync) {
    sendResponse({ ok: true, alreadyRunning: true });
    return false;
  }

  const backendBase = String(message.backendBase || "http://localhost:5178").replace(/\/+$/, "");
  const mode = message.mode === "full" ? "full" : "quick";
  activeAccountSync = runDlsiteAccountSync({ backendBase, mode })
    .catch(() => {})
    .finally(() => {
      activeAccountSync = null;
    });

  sendResponse({ ok: true, alreadyRunning: false });
  return false;
});

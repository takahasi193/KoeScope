import { load } from "cheerio";
import { normalizeSpace } from "./cache.js";
import { politeFetch } from "./fetcher.js";

const DLSITE_BASE = "https://www.dlsite.com";
const DEFAULT_ACCOUNT_DELAY_MS = 1_500;
const MAX_COOKIE_LENGTH = 12_000;
const PRODUCT_ID_PATTERN = /\b[A-Z]{1,4}\d{6,10}\b/i;

export const ACCOUNT_LIST_SOURCES = [
  {
    type: "wishlist",
    floor: "home",
    label: "全年龄关注",
    url: `${DLSITE_BASE}/home/mypage/wishlist`,
    watchlist: true,
  },
  {
    type: "wishlist",
    floor: "maniax",
    label: "R18 关注",
    url: `${DLSITE_BASE}/maniax/mypage/wishlist`,
    watchlist: true,
  },
  {
    type: "collection",
    floor: "home",
    label: "全年龄已购",
    url: `${DLSITE_BASE}/home/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/1`,
    watchlist: false,
  },
  {
    type: "collection",
    floor: "maniax",
    label: "R18 已购",
    url: `${DLSITE_BASE}/maniax/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/1`,
    watchlist: false,
  },
];

function absoluteUrl(url, base = DLSITE_BASE) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  try {
    return new URL(url, base).toString();
  } catch {
    return "";
  }
}

function extractNumber(text) {
  const match = String(text ?? "").replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function normalizeProductId(value) {
  return String(value ?? "").trim().toUpperCase();
}

function readProductId($, node) {
  const direct =
    $(node).attr("data-product_id") ||
    $(node).attr("data-list_item_product_id") ||
    $(node).find("[data-product_id]").first().attr("data-product_id") ||
    $(node).find("[data-list_item_product_id]").first().attr("data-list_item_product_id") ||
    "";
  if (direct) return normalizeProductId(direct);

  const inputId = $(node).find("input.__product_attributes").first().attr("id") ?? "";
  const inputMatch = inputId.match(PRODUCT_ID_PATTERN);
  if (inputMatch) return normalizeProductId(inputMatch[0]);

  const link = $(node).is("a") ? $(node).attr("href") : $(node).find('a[href*="/product_id/"]').first().attr("href");
  const linkMatch = String(link ?? "").match(PRODUCT_ID_PATTERN);
  return linkMatch ? normalizeProductId(linkMatch[0]) : "";
}

function readFloor(url, fallback = "home") {
  if (/\/maniax\//i.test(url)) return "maniax";
  if (/\/home\//i.test(url)) return "home";
  return fallback;
}

function readImageUrl($, container) {
  const raw =
    container.find("img").first().attr("data-src") ||
    container.find("img").first().attr(":src") ||
    container.find("img").first().attr("src") ||
    "";
  const match = raw.match(/\/\/[^'"\s]+/);
  return absoluteUrl(match?.[0] ?? raw);
}

function readWorkType($, container) {
  const direct = container.find("[data-worktype]").first().attr("data-worktype");
  if (direct) return direct;

  const categoryClass = container.find(".work_category").first().attr("class") ?? "";
  const typeMatch = categoryClass.match(/\btype_([A-Z0-9]+)/);
  if (typeMatch) return typeMatch[1];

  const attributes = container.find("input.__product_attributes").first().attr("value") ?? "";
  return attributes.split(",").map((part) => part.trim()).find(Boolean) ?? "";
}

function readAccountWork($, node, source) {
  const container =
    $(node).closest("li, tr, article, .n_worklist_item, .worklist_item, .search_result_img_box_inner, .work").first();
  const context = container.length ? container : $(node).parent();
  const productId = readProductId($, context.length ? context : node);
  if (!productId) return null;

  const titleLink = context.find('a[href*="/product_id/"]').first();
  const url = absoluteUrl(titleLink.attr("href"), source.url);
  const title = normalizeSpace(
    titleLink.attr("title") ||
      titleLink.text() ||
      context.find(".work_name, .work_title, .product_name").first().text() ||
      productId
  );
  const makerLink = context.find('.maker_name a, a[href*="/maker_id/"]').first();
  const categoryLabel = normalizeSpace(
    context.find(".work_category a").first().text() || context.find(".work_category").first().text()
  );
  const genres = context
    .find(".search_tag a, .work_genre a, .work_genre span")
    .map((_, genreNode) => normalizeSpace($(genreNode).text() || $(genreNode).attr("title")))
    .get()
    .filter(Boolean);

  const priceJpy = extractNumber(context.find(".work_price_wrap .work_price, .work_price").first().text());
  const officialPriceJpy = extractNumber(context.find(".work_price_wrap .strike, .strike").first().text()) ?? priceJpy;

  return {
    productId,
    title,
    url: url || `${DLSITE_BASE}/${source.floor}/work/=/product_id/${productId}.html`,
    imageUrl: readImageUrl($, context),
    circle: normalizeSpace(makerLink.text()),
    circleId: (makerLink.attr("href") ?? "").match(/maker_id\/([^/.]+)/)?.[1] ?? "",
    floor: readFloor(url, source.floor),
    workType: readWorkType($, context),
    categoryLabel,
    genres,
    priceJpy,
    officialPriceJpy,
    discountRate: extractNumber(context.find(".icon_campaign, .type_sale").first().text()),
    sales: extractNumber(context.find(".work_dl, [class*='dl_count']").first().text()),
    ratingCount: extractNumber(context.find(".work_rating .star_rating").first().text()),
    raw: {
      source: "account_html",
      listType: source.type,
      sourceUrl: source.url,
    },
    sourceUrl: source.url,
  };
}

export function normalizeDlsiteCookieHeader(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/^cookie:\s*/i, "")
    .replace(/[\r\n]+/g, "; ");

  if (!raw || !raw.includes("=")) {
    const error = new Error("没有收到 DLsite 登录会话，请先在 Chrome 中登录 DLsite，再通过扩展同步。");
    error.statusCode = 400;
    throw error;
  }
  if (raw.length > MAX_COOKIE_LENGTH) {
    const error = new Error("Cookie 内容过长，请只粘贴 dlsite.com 相关 Cookie。");
    error.statusCode = 400;
    throw error;
  }
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .join("; ");
}

function isLoginPage(url, html) {
  if (/\/regist\/user/i.test(url)) return true;
  return /name=["']login_id["']|login_form/i.test(html);
}

async function fetchAccountHtml(url, { cookieHeader, minDelayMs }) {
  const response = await politeFetch(url, {
    minDelayMs,
    headers: {
      Cookie: cookieHeader,
      Referer: `${DLSITE_BASE}/home/mypage`,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en;q=0.8,zh-CN;q=0.7",
    },
  });
  const html = await response.text();
  const finalUrl = response.url || url;
  if (isLoginPage(finalUrl, html)) {
    const error = new Error("DLsite 会话已失效，请确认已在同一个 Chrome 个人资料中登录 DLsite，然后在扩展里重新同步账号。");
    error.statusCode = 401;
    throw error;
  }
  return { html, finalUrl };
}

export function parseAccountPointsHtml(html) {
  const $ = load(html);
  $("script, style, noscript").remove();

  const candidates = [];
  $("[class*='point'], [id*='point'], [class*='balance'], [id*='balance']").each((_, node) => {
    const text = normalizeSpace($(node).text());
    if (text) candidates.push(text);
  });

  const pageText = normalizeSpace($.root().text());
  candidates.push(pageText);

  const labelPatterns = [
    /(?:保有|利用可能|現在|所持|残高)[^0-9]{0,30}([0-9,]+)\s*(?:pt|ポイント|P)/iu,
    /([0-9,]+)\s*(?:pt|ポイント|P)[^。]{0,30}(?:保有|利用可能|現在|所持|残高)/iu,
    /(?:Available|Current|Owned)\s+points?[^0-9]{0,30}([0-9,]+)/iu,
  ];

  for (const text of candidates) {
    for (const pattern of labelPatterns) {
      const match = text.match(pattern);
      if (match) return extractNumber(match[1]);
    }
  }

  const pointMatches = pageText.matchAll(/([0-9][0-9,]*)\s*(?:pt|ポイント)/giu);
  const values = [...pointMatches].map((match) => extractNumber(match[1])).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

export function parseAccountDisplayName(html) {
  const $ = load(html);
  const direct = normalizeSpace(
    $(".user_name, .mypage_user_name, [class*='user_name'], [id*='user_name']").first().text()
  );
  if (direct) return direct.replace(/様$/u, "");

  const text = normalizeSpace($.root().text());
  const match = text.match(/([^\s]{1,40})\s*様/u);
  return match ? match[1] : "";
}

export function parseAccountWorksHtml(html, source) {
  const $ = load(html);
  const byId = new Map();
  const selectors = [
    "[data-product_id]",
    "[data-list_item_product_id]",
    "input.__product_attributes",
    'a[href*="/product_id/"]',
  ];

  $(selectors.join(",")).each((_, node) => {
    const item = readAccountWork($, node, source);
    if (item?.productId && !byId.has(item.productId)) byId.set(item.productId, item);
  });

  return [...byId.values()];
}

function sameUrl(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return `${a.origin}${a.pathname}`.replace(/\/+$/, "") === `${b.origin}${b.pathname}`.replace(/\/+$/, "");
  } catch {
    return String(left ?? "").replace(/\/+$/, "") === String(right ?? "").replace(/\/+$/, "");
  }
}

function pageMatchesSource(page, source) {
  if (sameUrl(page.sourceUrl, source.url)) return true;
  if (page.type === source.type && (!source.floor || page.floor === source.floor)) return true;

  const url = String(page.sourceUrl || page.finalUrl || page.url || "");
  const listPath = source.type === "collection" ? "userbuy" : "wishlist";
  return url.includes(`/${source.floor}/mypage/${listPath}`);
}

export function importDlsiteAccountPages(repository, { pages = [], syncMode = "full" } = {}) {
  const pageList = Array.isArray(pages) ? pages : [];
  const normalizedSyncMode = syncMode === "quick" ? "quick" : "full";
  const pointPage =
    pageList.find((page) => page.type === "point") ??
    pageList.find((page) => /\/home\/mypage(?:\/point)?(?:[/?#]|$)/i.test(page.finalUrl || page.url || ""));

  if (!pointPage?.html) {
    const error = new Error("没有收到 DLsite 点数页，请在扩展中重新同步账号。");
    error.statusCode = 400;
    throw error;
  }

  if (isLoginPage(pointPage.finalUrl || pointPage.url || "", pointPage.html)) {
    const error = new Error("Chrome 当前仍未登录 DLsite，请打开账号页确认能看到自己的账号后再同步。");
    error.statusCode = 401;
    throw error;
  }

  const lists = [];
  const errors = [];
  for (const source of ACCOUNT_LIST_SOURCES) {
    const sourcePages = pageList.filter((candidate) => pageMatchesSource(candidate, source));
    const listErrors = [];
    const byId = new Map();

    if (!sourcePages.length) {
      const error = { source: source.label, url: source.url, error: "扩展没有返回该页面。" };
      errors.push(error);
      continue;
    }

    for (const page of sourcePages) {
      const pageUrl = page.finalUrl || page.url || source.url;
      if (!page?.html) {
        const error = { source: source.label, url: pageUrl, error: page.error || "扩展没有返回该页面。" };
        errors.push(error);
        listErrors.push(error);
        continue;
      }
      if (isLoginPage(pageUrl, page.html)) {
        const error = { source: source.label, url: pageUrl, error: "该页面返回登录页。" };
        errors.push(error);
        listErrors.push(error);
        continue;
      }

      for (const item of parseAccountWorksHtml(page.html, {
        ...source,
        url: pageUrl,
      })) {
        if (!byId.has(item.productId)) byId.set(item.productId, item);
      }
    }

    lists.push({
      ...source,
      url: sourcePages[0]?.finalUrl || sourcePages[0]?.url || source.url,
      items: [...byId.values()],
      fetchedPages: sourcePages.length,
      fullSync:
        normalizedSyncMode === "full"
          ? sourcePages.every((page) => page.fullSync !== false)
          : sourcePages.every((page) => page.fullSync === true),
      errors: listErrors,
    });
  }

  const profile = repository.saveAccountSyncResult({
    displayName: parseAccountDisplayName(pointPage.html),
    pointsJpy: parseAccountPointsHtml(pointPage.html),
    loginState: "active",
    raw: {
      source: "browser_extension_pages",
      pointUrl: pointPage.finalUrl || pointPage.url || "",
      syncMode: normalizedSyncMode,
      errors,
    },
    syncMode: normalizedSyncMode,
    lists,
  });

  return {
    profile,
    lists: lists.map((list) => ({
      type: list.type,
      floor: list.floor,
      label: list.label,
      count: list.items.length,
      fetchedPages: list.fetchedPages,
      fullSync: list.fullSync,
      errors: list.errors,
    })),
    errors,
  };
}

function nextPageUrls(html, currentUrl) {
  const $ = load(html);
  const urls = [];
  $("a[href]").each((_, node) => {
    const text = normalizeSpace($(node).text());
    const rel = normalizeSpace($(node).attr("rel"));
    const className = normalizeSpace($(node).attr("class"));
    const href = $(node).attr("href") ?? "";
    const looksNext = /next|次|>|›|»/iu.test(`${text} ${rel} ${className}`);
    const looksPaged = /(?:^|[?/&])page(?:[=/]|=)|\/page\//i.test(href);
    if (!looksNext && !looksPaged) return;

    const url = absoluteUrl(href, currentUrl);
    if (url && /\/mypage\//i.test(url)) urls.push(url);
  });
  return [...new Set(urls)];
}

async function fetchAccountList(source, { cookieHeader, maxPages, minDelayMs }) {
  const queue = [source.url];
  const visited = new Set();
  const items = [];
  const errors = [];

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    try {
      const { html, finalUrl } = await fetchAccountHtml(url, { cookieHeader, minDelayMs });
      items.push(...parseAccountWorksHtml(html, { ...source, url: finalUrl || url }));
      for (const nextUrl of nextPageUrls(html, finalUrl || url)) {
        if (!visited.has(nextUrl) && queue.length + visited.size < maxPages) queue.push(nextUrl);
      }
    } catch (error) {
      if (error.statusCode === 401) throw error;
      errors.push({ source: source.label, url, error: error.message });
      break;
    }
  }

  return {
    ...source,
    items,
    fetchedPages: visited.size,
    errors,
  };
}

export async function syncDlsiteAccount(
  repository,
  {
    minDelayMs = Number(process.env.DLSITE_ACCOUNT_DELAY_MS) || DEFAULT_ACCOUNT_DELAY_MS,
    maxPages = Number(process.env.DLSITE_ACCOUNT_MAX_PAGES) || 3,
    sources = ACCOUNT_LIST_SOURCES,
  } = {}
) {
  const session = repository.getAccountProfile({ includeSecret: true });
  if (!session.cookieHeader) {
    const error = new Error("请先通过 Chrome 扩展连接 DLsite 账号。");
    error.statusCode = 400;
    throw error;
  }

  try {
    const pointPage = await fetchAccountHtml(`${DLSITE_BASE}/home/mypage`, {
      cookieHeader: session.cookieHeader,
      minDelayMs,
    });
    const displayName = parseAccountDisplayName(pointPage.html) || session.displayName;
    const pointsJpy = parseAccountPointsHtml(pointPage.html);
    const lists = [];
    const errors = [];

    for (const source of sources) {
      const list = await fetchAccountList(source, {
        cookieHeader: session.cookieHeader,
        maxPages: Math.min(Math.max(Number(maxPages) || 3, 1), 10),
        minDelayMs,
      });
      lists.push(list);
      errors.push(...list.errors);
    }

    const profile = repository.saveAccountSyncResult({
      displayName,
      pointsJpy,
      loginState: "active",
      raw: {
        pointUrl: pointPage.finalUrl,
        errors,
      },
      lists,
    });

    return {
      profile,
      lists: lists.map((list) => ({
        type: list.type,
        floor: list.floor,
        label: list.label,
        count: list.items.length,
        fetchedPages: list.fetchedPages,
        errors: list.errors,
      })),
      errors,
    };
  } catch (error) {
    repository.saveAccountSession({
      loginState: error.statusCode === 401 ? "expired" : "error",
      raw: { error: error.message },
    });
    throw error;
  }
}

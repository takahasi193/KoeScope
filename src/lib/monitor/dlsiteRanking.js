import { load } from "cheerio";
import { normalizeSpace } from "../cache.js";
import { politeFetch } from "../fetcher.js";

const DLSITE_BASE = "https://www.dlsite.com";
const RANKING_MIN_DELAY_MS = 1_500;
const AJAX_BATCH_SIZE = 50;

export const MONITOR_FLOORS = ["home", "maniax"];
export const MONITOR_PERIODS = ["day", "week", "month"];
export const MONITOR_CATEGORIES = ["all", "voice", "game", "manga"];
export const MONITOR_CATEGORY = "all";

export const MONITOR_CATEGORY_LABELS = {
  all: "总榜",
  voice: "ASMR/音声",
  game: "游戏",
  manga: "漫画",
};

const RANKING_CATEGORY_PARAMS = {
  all: {},
  voice: { category: "voice", sub: "SOU" },
  game: { category: "game" },
  manga: { category: "comic" },
};

const TOP_RANKING_GROUP_BY_CATEGORY = {
  all: 0,
  manga: 1,
  game: 2,
  voice: 3,
};

const AGE_CATEGORY_BY_CODE = new Map([
  [1, "general"],
  [2, "r15"],
  [3, "r18"],
]);

function absoluteUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${DLSITE_BASE}${url}`;
  return url;
}

function extractNumber(text) {
  const match = String(text ?? "").replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function extractProductId($, row) {
  const direct = $(row).find("[data-product_id]").first().attr("data-product_id");
  if (direct) return direct;

  const inputId = $(row).find("input.__product_attributes").first().attr("id") ?? "";
  const inputMatch = inputId.match(/(RJ\d+)/i);
  if (inputMatch) return inputMatch[1].toUpperCase();

  const link = $(row).find('a[href*="/product_id/"]').first().attr("href") ?? "";
  const linkMatch = link.match(/product_id\/(RJ\d+)/i);
  return linkMatch ? linkMatch[1].toUpperCase() : "";
}

function extractThumb($, row) {
  const thumbCandidates = $(row).find("[\\:thumb-candidates], thumb-with-ng-filter").first().attr(":thumb-candidates") ?? "";
  const candidateMatch = thumbCandidates.match(/['"]([^'"]+)['"]/);
  if (candidateMatch) return absoluteUrl(candidateMatch[1]);

  const rawSrc =
    $(row).find(".work_img_popover img").first().attr(":src") ||
    $(row).find(".work_thumb img, img").first().attr("data-src") ||
    $(row).find(".work_thumb img, img").first().attr("src") ||
    "";
  const match = rawSrc.match(/\/\/[^'"\s]+/);
  return absoluteUrl(match?.[0] ?? rawSrc);
}

function readWorkType($, row) {
  const categoryClass = $(row).find(".work_category").first().attr("class") ?? "";
  const typeMatch = categoryClass.match(/\btype_([A-Z0-9]+)/);
  if (typeMatch) return typeMatch[1];

  const attributes = $(row).find("input.__product_attributes").first().attr("value") ?? "";
  const knownTypes = new Set(["SOU", "MUS", "ADV", "RPG", "SLN", "ACN", "STG", "PZL", "TBL", "QIZ", "ETC", "TYP", "MNG", "ICG", "MOV"]);
  return attributes
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .find((part) => knownTypes.has(part)) ?? "";
}

function readAgeCategory($, row, floor) {
  const ageText = normalizeSpace(
    $(row).find(".icon_R15, .icon_ADL, .icon_GEN").first().attr("title") ||
      $(row).find(".icon_R15, .icon_ADL, .icon_GEN").first().text() ||
      $(row).find(".work_genre").text()
  );
  if (/R-?15/i.test(ageText)) return "r15";
  if (/R-?18|18禁|成人/i.test(ageText)) return "r18";
  if (/全年齢|全年龄|一般|全年/i.test(ageText)) return "general";
  return floor === "maniax" ? "r18" : "general";
}

function normalizeDiscountEnd(value) {
  const text = normalizeSpace(value);
  if (!text) return "";
  const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})時(\d{1,2})分/);
  if (!match) return text;
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00+09:00`;
}

export function buildRankingUrl({ floor, period, category = MONITOR_CATEGORY }) {
  const params = new URLSearchParams();
  const categoryParams = RANKING_CATEGORY_PARAMS[category] ?? RANKING_CATEGORY_PARAMS[MONITOR_CATEGORY];
  for (const [key, value] of Object.entries(categoryParams)) {
    params.set(key, value);
  }
  const query = params.toString();
  const rankingPath = period === "day" ? "ranking" : `ranking/${period}`;
  return `${DLSITE_BASE}/${floor}/${rankingPath}${query ? `?${query}` : ""}`;
}

function readRankingRow($, row, { index, rank, floor, period, category, sourceUrl }) {
  const productId = extractProductId($, row);
  if (!productId) return null;

  const resolvedRank = rank ?? extractNumber($(row).find(".ranking_count .rank_no, .rank_no, .rank").first().text()) ?? index + 1;
  const $titleLink = $(row).find("dt.work_name a, .work_name a").first();
  const title = normalizeSpace($titleLink.attr("title") || $titleLink.text());
  const url = absoluteUrl($titleLink.attr("href"));
  const $makerLink = $(row).find(".maker_name a").first();
  const categoryLabel = normalizeSpace($(row).find(".work_category").first().text());
  const workType = readWorkType($, row);
  const genres = $(row)
    .find(".search_tag a, .work_genre a, .work_genre span")
    .map((_, node) => normalizeSpace($(node).text() || $(node).attr("title")))
    .get()
    .filter(Boolean);
  const priceJpy = extractNumber($(row).find(".work_price_wrap .work_price, .work_price").first().text());
  const officialPriceJpy = extractNumber($(row).find(".work_price_wrap .strike, .strike").first().text()) ?? priceJpy;
  const discountRate = extractNumber($(row).find(".icon_campaign, .type_sale").first().text());
  const sales =
    extractNumber($(row).find(".work_dl [class*='dl_count']").first().text()) ??
    extractNumber($(row).find(".ranking_count .dl_count").first().text());
  const ratingCount = extractNumber($(row).find(".work_rating .star_rating").first().text());

  return {
    productId,
    rank: resolvedRank,
    title: title || productId,
    url,
    imageUrl: extractThumb($, row),
    circle: normalizeSpace($makerLink.text()),
    circleId: ($makerLink.attr("href") ?? "").match(/maker_id\/([^/.]+)/)?.[1] ?? "",
    floor,
    period,
    category,
    ageCategory: readAgeCategory($, row, floor),
    workType,
    categoryLabel,
    genres,
    priceJpy,
    officialPriceJpy,
    discountRate,
    sales,
    ratingCount,
    discountEndsAt: normalizeDiscountEnd($(row).find(".period_date").first().text()),
    sourceUrl,
    raw: { source: "ranking_html" },
  };
}

function parseTableRankingRows($, context) {
  const items = [];
  $("#ranking_table tr, table.ranking_worklist tr").each((index, row) => {
    const item = readRankingRow($, row, { ...context, index });
    if (item) items.push(item);
  });
  return items;
}

function parseTopRankingRows($, context) {
  const targetGroup = TOP_RANKING_GROUP_BY_CATEGORY[context.category] ?? TOP_RANKING_GROUP_BY_CATEGORY[MONITOR_CATEGORY];
  const groups = [];
  let currentGroup = [];
  let previousRank = 0;

  $("li.ranking_top_worklist_item").each((index, row) => {
    const rank = extractNumber($(row).find(".rank").first().text()) ?? currentGroup.length + 1;
    if (currentGroup.length > 0 && rank <= previousRank) {
      groups.push(currentGroup);
      currentGroup = [];
    }
    currentGroup.push({ row, index, rank });
    previousRank = rank;
  });
  if (currentGroup.length > 0) groups.push(currentGroup);

  return (groups[targetGroup] ?? groups[0] ?? [])
    .map(({ row, index, rank }) => readRankingRow($, row, { ...context, index, rank }))
    .filter(Boolean);
}

export function parseRankingHtml(html, { floor = "home", period = "week", category = MONITOR_CATEGORY, sourceUrl = "" } = {}) {
  const $ = load(html);
  const context = { floor, period, category, sourceUrl };
  const tableItems = parseTableRankingRows($, context);
  return tableItems.length ? tableItems : parseTopRankingRows($, context);
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function normalizeAgeCategory(value, fallback = "") {
  const number = Number(value);
  return AGE_CATEGORY_BY_CODE.get(number) ?? fallback;
}

function normalizeAjaxProduct(productId, product, fallback = {}) {
  if (!product) return fallback;
  const floor = product.site_id || fallback.floor || "home";
  const officialPrice = Number(product.official_price || product.price || fallback.officialPriceJpy);
  const price = Number(product.price || fallback.priceJpy || officialPrice);
  const discountRate = Number(product.discount_rate ?? fallback.discountRate);

  return {
    ...fallback,
    productId,
    title: product.work_name || fallback.title || productId,
    url: fallback.url || `${DLSITE_BASE}/${floor}/work/=/product_id/${productId}.html`,
    imageUrl: absoluteUrl(product.work_image || fallback.imageUrl),
    circle: product.maker_name || fallback.circle || "",
    circleId: product.maker_id || fallback.circleId || "",
    floor,
    ageCategory: normalizeAgeCategory(product.age_category, fallback.ageCategory),
    workType: product.work_type || fallback.workType || "",
    categoryLabel: fallback.categoryLabel || "",
    genres: Array.isArray(product.custom_genres) && product.custom_genres.length ? product.custom_genres : fallback.genres ?? [],
    priceJpy: Number.isFinite(price) ? price : fallback.priceJpy,
    officialPriceJpy: Number.isFinite(officialPrice) ? officialPrice : fallback.officialPriceJpy,
    discountRate: Number.isFinite(discountRate) ? discountRate : fallback.discountRate,
    sales: Number(product.dl_count ?? product.dl_count_total ?? fallback.sales) || fallback.sales || null,
    ratingCount: Number(product.rate_count ?? fallback.ratingCount) || fallback.ratingCount || null,
    discountEndsAt: product.discount_end_date || product.discount_to || fallback.discountEndsAt || "",
    raw: { source: "product_info_ajax", ajax: product },
  };
}

function shouldFetchProductInfo(item) {
  return !item.imageUrl || !item.circle || !item.workType || item.priceJpy === null || item.priceJpy === undefined;
}

async function fetchProductInfoBatch({ floor, ids, minDelayMs }) {
  const url = `${DLSITE_BASE}/${floor}/product/info/ajax?product_id=${ids.join(",")}`;
  const response = await politeFetch(url, {
    minDelayMs,
    headers: {
      Accept: "application/json,text/html;q=0.8,*/*;q=0.7",
      "Accept-Language": "ja,en;q=0.8,zh-CN;q=0.7",
    },
  });
  return response.json();
}

export async function fetchRankingItems({ floor, period, category = MONITOR_CATEGORY, minDelayMs = RANKING_MIN_DELAY_MS } = {}) {
  const sourceUrl = buildRankingUrl({ floor, period, category });
  const response = await politeFetch(sourceUrl, {
    minDelayMs,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en;q=0.8,zh-CN;q=0.7",
    },
  });
  const html = await response.text();
  return parseRankingHtml(html, { floor, period, category, sourceUrl });
}

export async function enrichRankingItems(
  items,
  {
    detailCache = new Map(),
    fetchProductInfo = fetchProductInfoBatch,
    minDelayMs = RANKING_MIN_DELAY_MS,
  } = {}
) {
  const byFloor = new Map();
  for (const item of items) {
    const floorItems = byFloor.get(item.floor) ?? [];
    floorItems.push(item);
    byFloor.set(item.floor, floorItems);
  }

  const enriched = new Map(items.map((item) => [item.productId, item]));

  for (const [floor, floorItems] of byFloor) {
    const missingItems = [];
    for (const item of floorItems) {
      const cacheKey = `${floor}:${item.productId}`;
      const cached = detailCache.get(cacheKey);
      if (cached) {
        enriched.set(item.productId, { ...item, ...cached });
      } else if (!shouldFetchProductInfo(item)) {
        detailCache.set(cacheKey, item);
      } else {
        missingItems.push(item);
      }
    }

    for (const batch of chunk(missingItems, AJAX_BATCH_SIZE)) {
      const ids = [...new Set(batch.map((item) => item.productId))];
      if (ids.length === 0) continue;

      const payload = await fetchProductInfo({ floor, ids, minDelayMs });
      for (const id of ids) {
        const normalized = normalizeAjaxProduct(id, payload[id], enriched.get(id));
        detailCache.set(`${floor}:${id}`, normalized);
        enriched.set(id, normalized);
      }
    }
  }

  return items.map((item) => ({
    ...enriched.get(item.productId),
    rank: item.rank,
    period: item.period,
    category: item.category,
    sourceUrl: item.sourceUrl,
  }));
}

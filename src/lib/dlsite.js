import { load } from "cheerio";
import { TTLCache, normalizeSpace } from "./cache.js";
import { politeFetch } from "./fetcher.js";

const DLSITE_BASE = "https://www.dlsite.com";
const cache = new TTLCache(1000 * 60 * 60 * 6);

const GAME_TYPES = new Set([
  "ADV",
  "RPG",
  "SLN",
  "ACN",
  "STG",
  "PZL",
  "TBL",
  "QIZ",
  "ETC",
  "TYP",
]);

const TYPE_LABELS = {
  voice: "音声/ASMR",
  game: "游戏",
  manga: "漫画",
  cg: "CG/插画",
  video: "视频",
  other: "其他",
};

const AGE_LABELS = {
  general: "全年龄",
  r15: "R15",
  r18: "R18",
  unknown: "未知",
};

const AGE_RANK = {
  unknown: 0,
  general: 1,
  r15: 2,
  r18: 3,
};

const STAFF_FIELD_PATTERN =
  /声優|声优|CV|出演|キャスト|作者|著者|シナリオ|原画|イラスト|音楽|スタッフ|制作|サークル名|ブランド名/u;

function absoluteUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${DLSITE_BASE}${url}`;
  return url;
}

function searchFloors(scope = "all") {
  if (scope === "adult" || scope === "allR18") {
    return [{ key: "maniax", label: "R18", base: `${DLSITE_BASE}/maniax/fsr/=/keyword` }];
  }

  if (scope === "nonAdult") {
    return [{ key: "home", label: "全年龄/R15", base: `${DLSITE_BASE}/home/fsr/=/keyword` }];
  }

  return [
    { key: "maniax", label: "R18", base: `${DLSITE_BASE}/maniax/fsr/=/keyword` },
    { key: "home", label: "全年龄/R15", base: `${DLSITE_BASE}/home/fsr/=/keyword` },
  ];
}

function buildSearchUrl(floor, keyword, page, perPage) {
  return `${floor.base}/${encodeURIComponent(keyword)}/order/release/per_page/${perPage}/page/${page}`;
}

function normalizeForMatch(value) {
  return normalizeSpace(value)
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ja-JP");
}

function canSearchWholeField(alias) {
  const normalized = normalizeForMatch(alias);
  return normalized.length >= 4 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(alias);
}

function extractThumb($, element) {
  const popup = $(element).find("thumb-with-ng-filter-block").first();
  const candidates = popup.attr(":thumb-candidates") ?? "";
  const candidateMatch = candidates.match(/['"]([^'"]+)['"]/);
  if (candidateMatch) return absoluteUrl(candidateMatch[1]);

  const img = $(element).find("img").first();
  const rawSrc = img.attr("data-src") ?? img.attr(":src") ?? img.attr("src") ?? "";
  const match = rawSrc.match(/\/\/[^'"\s]+/);
  return absoluteUrl(match?.[0] ?? rawSrc);
}

function readWorkType($, element) {
  const direct = $(element).find("[data-worktype]").first().attr("data-worktype");
  if (direct) return direct;

  const attributes = $(element).find("input.__product_attributes").first().attr("value") ?? "";
  const known = attributes
    .split(",")
    .map((part) => part.trim())
    .find((part) => GAME_TYPES.has(part) || ["SOU", "MNG", "ICG", "MOV"].includes(part));
  return known ?? "";
}

function classifyWork({ category, workType, genres, attributes }) {
  const haystack = `${category} ${workType} ${genres.join(" ")} ${attributes}`.toUpperCase();

  if (/SOU|ボイス|音声|ASMR|VOICE|ドラマCD/i.test(haystack)) return "voice";
  if (
    GAME_TYPES.has(workType) ||
    /ゲーム|アドベンチャー|ロールプレイング|シミュレーション|ノベル|GAME/i.test(haystack)
  ) {
    return "game";
  }
  if (/MNG|マンガ|漫画|コミック|COMIC/i.test(haystack)) return "manga";
  if (/ICG|CG|イラスト|ILLUST/i.test(haystack)) return "cg";
  if (/MOV|動画|ムービー|アニメ|MOVIE|VIDEO/i.test(haystack)) return "video";
  return "other";
}

function readAgeCategory($, element, attributes, floorKey, url) {
  const $element = $(element);
  const ageText = normalizeSpace(
    $element.find(".icon_R15, .icon_ADL, .icon_GEN").first().attr("title") ||
      $element.find(".icon_R15, .icon_ADL, .icon_GEN").first().text() ||
      $element.find(".work_genre").text()
  );
  const attributeParts = attributes.split(",").map((part) => part.trim().toLowerCase());

  if (/R-?15/i.test(ageText)) return "r15";
  if (/R-?18|18禁|成人/i.test(ageText)) return "r18";
  if (/全年齢|全年龄|一般|全年/i.test(ageText)) return "general";
  if (attributeParts.includes("r15")) return "r15";
  if (attributeParts.includes("adl")) return floorKey === "home" ? "r15" : "r18";
  if (/\/maniax\//i.test(url)) return "r18";
  if (floorKey === "home") return "general";
  return "unknown";
}

function extractNumber(text) {
  const match = String(text ?? "").replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function unknownVerification() {
  return {
    status: "unknown",
    matchedAliases: [],
    fields: [],
  };
}

export function parseSearchHtml(html, alias, page, floorKey = "maniax") {
  const $ = load(html);
  const items = [];

  $("li.search_result_img_box_inner").each((_, element) => {
    const $element = $(element);
    const productId =
      $element.attr("data-list_item_product_id") ||
      $element.find("[data-product_id]").first().attr("data-product_id") ||
      "";

    const $titleLink = $element.find(".work_name a").first();
    const title = normalizeSpace($titleLink.attr("title") || $titleLink.text());
    const url = absoluteUrl($titleLink.attr("href"));

    if (!productId || !title || !url) return;

    const $makerLink = $element.find(".maker_name a").first();
    const category = normalizeSpace(
      $element.find(".work_category a").first().text() ||
        $element.find(".work_category").first().text()
    );
    const genres = $element
      .find(".work_genre a, .work_genre span")
      .map((__, node) => normalizeSpace($(node).text()))
      .get()
      .filter(Boolean);
    const attributes = $element.find("input.__product_attributes").first().attr("value") ?? "";
    const workType = readWorkType($, element);
    const type = classifyWork({ category, workType, genres, attributes });
    const ageCategory = readAgeCategory($, element, attributes, floorKey, url);

    items.push({
      productId,
      title,
      url,
      image: extractThumb($, element),
      circle: normalizeSpace($makerLink.text()),
      circleUrl: absoluteUrl($makerLink.attr("href")),
      category,
      floor: floorKey,
      type,
      typeLabel: TYPE_LABELS[type],
      ageCategory,
      ageLabel: AGE_LABELS[ageCategory],
      workType,
      genres,
      priceJpy: extractNumber($element.find(".work_price .work_price_base").first().text()),
      sales: extractNumber($element.find(".work_dl").first().text()),
      ratingCount: extractNumber($element.find(".work_rating .star_rating").first().text()),
      labels: $element
        .find(".work_labels span")
        .map((__, node) => normalizeSpace($(node).text()))
        .get()
        .filter(Boolean),
      matchedAliases: [alias],
      matchedPages: [page],
      verification: unknownVerification(),
    });
  });

  return items;
}

export async function searchDlsiteAlias(alias, options = {}) {
  const perPage = Math.min(Math.max(Number(options.perPage) || 30, 10), 100);
  const maxPages = Math.min(Math.max(Number(options.maxPages) || 1, 1), 10);
  const floors = searchFloors(options.scope);
  const results = [];

  for (const floor of floors) {
    for (let page = 1; page <= maxPages; page += 1) {
      const url = buildSearchUrl(floor, alias, page, perPage);
      const cacheKey = `dlsite:${floor.key}:${alias}:${page}:${perPage}`;
      let html = cache.get(cacheKey);

      if (!html) {
        const response = await politeFetch(url, {
          minDelayMs: Number(options.minDelayMs) || 900,
        });
        html = await response.text();
        cache.set(cacheKey, html);
      }

      const pageItems = parseSearchHtml(html, alias, page, floor.key);
      results.push(...pageItems);
      if (pageItems.length === 0 || pageItems.length < Math.min(perPage, 30)) break;
    }
  }

  return {
    alias,
    count: results.length,
    items: results,
  };
}

function extractVerificationFields(html) {
  const $ = load(html);
  const fields = [];

  $("script, style, noscript").remove();

  $("#work_maker tr, #work_outline tr, table tr").each((_, row) => {
    const label = normalizeSpace($(row).find("th").first().text());
    if (!label || !STAFF_FIELD_PATTERN.test(label)) return;

    const text = normalizeSpace($(row).find("td").text());
    if (text) fields.push({ label, text });
  });

  const intro = normalizeSpace(
    $("#work_intro, #work_explanation, .work_parts_area, [itemprop='description']").text()
  );
  if (intro) fields.push({ label: "作品介绍", text: intro });

  const description = normalizeSpace($("meta[name='description']").attr("content"));
  if (description) fields.push({ label: "页面描述", text: description });

  return fields;
}

function extractDetailAgeCategory(html) {
  const $ = load(html);
  let ageText = "";

  $("#work_outline tr, table tr").each((_, row) => {
    const label = normalizeSpace($(row).find("th").first().text());
    if (label !== "年齢指定") return;
    ageText = normalizeSpace($(row).find("td").text());
  });

  if (/R-?15/i.test(ageText)) return "r15";
  if (/R-?18|18禁|成人/i.test(ageText)) return "r18";
  if (/全年齢|全年龄|一般|全年/i.test(ageText)) return "general";
  return "";
}

function matchAliasesInFields(fields, aliases) {
  const matches = new Map();

  for (const field of fields) {
    const normalizedText = normalizeForMatch(field.text);
    for (const alias of aliases) {
      const normalizedAlias = normalizeForMatch(alias);
      if (!normalizedAlias || !canSearchWholeField(alias)) continue;
      if (!normalizedText.includes(normalizedAlias)) continue;

      const existing = matches.get(alias) ?? new Set();
      existing.add(field.label);
      matches.set(alias, existing);
    }
  }

  return matches;
}

async function verifyDlsiteItem(item, aliases, options = {}) {
  const cacheKey = `detail:${item.productId}`;
  let html = cache.get(cacheKey);

  try {
    if (!html) {
      const response = await politeFetch(item.url, {
        minDelayMs: Number(options.minDelayMs) || 900,
      });
      html = await response.text();
      cache.set(cacheKey, html);
    }

    const fields = extractVerificationFields(html);
    const detailAgeCategory = extractDetailAgeCategory(html);
    if (detailAgeCategory) {
      item.ageCategory = detailAgeCategory;
      item.ageLabel = AGE_LABELS[detailAgeCategory];
    }

    const matches = matchAliasesInFields(fields, aliases);

    if (matches.size > 0) {
      return {
        status: "matched",
        matchedAliases: [...matches.keys()],
        fields: [...new Set([...matches.values()].flatMap((set) => [...set]))],
      };
    }

    if (fields.length > 0) {
      return {
        status: "not_matched",
        matchedAliases: [],
        fields: [...new Set(fields.map((field) => field.label))],
      };
    }

    return unknownVerification();
  } catch (error) {
    return {
      status: "unknown",
      matchedAliases: [],
      fields: [`详情页请求失败: ${error.message}`],
    };
  }
}

export async function verifyDlsiteItems(items, aliases, options = {}) {
  for (const item of items) {
    item.verification = await verifyDlsiteItem(item, aliases, options);
  }
  return items;
}

export function aggregateDlsiteResults(aliasResults) {
  const byId = new Map();
  const aliasSummaries = [];
  const errors = [];

  for (const result of aliasResults) {
    if (result.error) {
      errors.push({ alias: result.alias, error: result.error });
      aliasSummaries.push({ alias: result.alias, count: 0, error: result.error });
      continue;
    }

    aliasSummaries.push({ alias: result.alias, count: result.count });

    for (const item of result.items ?? []) {
      const existing = byId.get(item.productId);
      if (!existing) {
        byId.set(item.productId, {
          ...item,
          matchedAliases: [...new Set(item.matchedAliases)],
          matchedPages: [...new Set(item.matchedPages)],
          verification: item.verification ?? unknownVerification(),
        });
        continue;
      }

      existing.matchedAliases = [...new Set([...existing.matchedAliases, ...item.matchedAliases])];
      existing.matchedPages = [...new Set([...existing.matchedPages, ...item.matchedPages])];
      if (AGE_RANK[item.ageCategory] > AGE_RANK[existing.ageCategory]) {
        existing.ageCategory = item.ageCategory;
        existing.ageLabel = item.ageLabel;
      }
    }
  }

  const items = [...byId.values()].sort((a, b) => {
    const aliasDelta = b.matchedAliases.length - a.matchedAliases.length;
    if (aliasDelta !== 0) return aliasDelta;
    return a.title.localeCompare(b.title, "ja-JP");
  });

  const groups = Object.fromEntries(
    Object.entries(TYPE_LABELS).map(([key, label]) => [
      key,
      {
        key,
        label,
        count: items.filter((item) => item.type === key).length,
      },
    ])
  );
  const ageGroups = summarizeAgeGroups(items);

  return {
    total: items.length,
    items,
    groups,
    ageGroups,
    aliasSummaries,
    errors,
  };
}

export function summarizeAgeGroups(items) {
  return Object.fromEntries(
    Object.entries(AGE_LABELS).map(([key, label]) => [
      key,
      {
        key,
        label,
        count: items.filter((item) => item.ageCategory === key).length,
      },
    ])
  );
}

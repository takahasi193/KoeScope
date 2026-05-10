import { load } from "cheerio";
import { normalizeSpace } from "../cache.js";
import { politeFetch } from "../fetcher.js";

const DLSITE_BASE = "https://www.dlsite.com";
const MEDIA_BASE = "https://media.vivion-bcs.com";
const LEGACY_BCS_BASE = "https://www.eisys-bcs.jp";
const DEFAULT_ACTIVITY_DELAY_MS = 1_500;
const DEFAULT_ACTIVITY_DETAIL_CACHE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_ACTIVITY_DETAIL_LIMIT = 24;
const DETAIL_TEXT_LIMIT = 180;

const activityDetailCache = new Map();

export const DLSITE_ALLCAMPAIGN_URL = `${DLSITE_BASE}/maniax/allcampaign?locale=zh_CN`;

export const ACTIVITY_BENEFIT_TYPES = ["point", "coupon", "discount", "free", "bonus", "info"];

export const ACTIVITY_BENEFIT_LABELS = {
  point: "点数",
  coupon: "优惠券",
  discount: "折扣",
  free: "免费",
  bonus: "福利",
  info: "专题",
};

const ACTIVITY_BENEFIT_SUMMARIES = {
  point: "可查看点数返还、点数赠送或点数相关活动；实际到账以 DLsite 账号为准。",
  coupon: "可能提供优惠券或可用优惠券作品入口；是否已领取以 DLsite 账号为准。",
  discount: "可直接查看折扣、套装折扣或特价作品。",
  free: "可能包含免费领取或限时免费内容，请打开活动页确认条件。",
  bonus: "可能包含特典、赠品或抽选福利，请打开活动页确认领取条件。",
  info: "DLsite 官方活动或专题入口。",
};

export const DLSITE_ACTIVITY_SOURCES = [
  {
    key: "campaign",
    slot: "main",
    url: `${MEDIA_BASE}/data/dlsite/jajp/maniax/top/pc/campaign/data.json`,
  },
  {
    key: "campaign-mini",
    slot: "mini",
    url: `${MEDIA_BASE}/data/dlsite/jajp/maniax/top/pc/campaign-mini/data.json`,
  },
];

const LEGACY_ACTIVITY_KEYS = [
  "dlsite-doujin_maniax_center2-allcampaign-mini",
  "dlsite-doujin_maniax_center2-allcampaign",
];

const PUBLIC_DETAIL_PATH_PATTERN =
  /^\/(?:maniax|home|girls|bl|books|pro|app)\/(?:campaign|fsr|discount|bulkbuy|allcampaign|modpub|lp|event|feature|announce)(?:\/|$)/i;
const PRIVATE_DETAIL_PATH_PATTERN = /\/(?:login|mypage|user|account|circle|circle_room|affiliate|cart)(?:\/|$)/i;
const CONDITION_LABEL_PATTERN =
  /(?:参加条件|利用条件|使用条件|獲得条件|取得条件|配布条件|応募条件|対象者|対象条件|领取条件|領取條件|领券条件|クーポン条件|条件)/i;
const SCOPE_LABEL_PATTERN =
  /(?:対象作品|対象商品|対象ジャンル|対象フロア|対象カテゴリ|適用範囲|対象範囲|適用対象|适用范围|适用作品|対象サークル)/i;
const DEADLINE_LABEL_PATTERN =
  /(?:開催期間|実施期間|配布期間|利用期限|有効期限|終了|截止|结束|結束|期限|まで|迄)/i;
const DETAIL_DATE_PATTERN =
  /(\d{4})[./\-年](\d{1,2})[./\-月](\d{1,2})日?(?:[^\d]{0,12}(\d{1,2})(?::|：|時)(\d{2})?)?/g;

export function absoluteUrl(url, base = MEDIA_BASE) {
  if (!url) return "";
  const raw = String(url).trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, base.endsWith("/") ? base : `${base}/`).toString();
  } catch {
    return "";
  }
}

function trimDetailText(value, maxLength = DETAIL_TEXT_LIMIT) {
  const text = normalizeSpace(value);
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function uniqueLines(lines) {
  const seen = new Set();
  const result = [];
  for (const line of lines.map((value) => trimDetailText(value, 260)).filter(Boolean)) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function extractDetailLines($) {
  $("script, style, noscript, svg, iframe").remove();
  const lines = [];
  const root =
    $("main").first().length
      ? $("main").first()
      : $("article").first().length
        ? $("article").first()
        : $("#main_inner, #container, .campaign, .main").first().length
          ? $("#main_inner, #container, .campaign, .main").first()
          : $("body").first();

  root.find("h1, h2, h3, h4, p, li, dt, dd, th, td, caption, summary").each((_index, element) => {
    lines.push($(element).text());
  });

  if (lines.length < 3) {
    lines.push(...normalizeSpace(root.text()).split(/(?<=[。.!?！？])\s+|\n+/));
  }

  return uniqueLines(lines);
}

function extractMetaDescription($) {
  return trimDetailText(
    $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      ""
  );
}

function isStandaloneDetailLabel(value) {
  const text = normalizeSpace(value).replace(/[:：]$/, "");
  if (!text || text.length > 24) return false;
  return CONDITION_LABEL_PATTERN.test(text) || SCOPE_LABEL_PATTERN.test(text) || DEADLINE_LABEL_PATTERN.test(text);
}

function isLikelyDetailNoise(value) {
  const text = normalizeSpace(value);
  if (!text) return true;
  if (isStandaloneDetailLabel(text)) return true;
  if (/現在の検索|検索条件|検索結果|検索する|検索を変更|ジャンルを選択|\{\{.*\}\}|条件を保存|並び替え|表示件数|絞り込み|前へ|次へ/i.test(text)) return true;
  if (/ガイド\s+ヘルプ|初めての方へ|サークル登録|お支払方法|ポイントについて/.test(text)) return true;
  if (isGenericDlsiteDescription(text)) return true;
  if (/カートに追加|お気に入りに追加|販売数|レビュー/.test(text)) return true;
  if (/(\d[\d,]*\s*円).{0,100}(販売数|カート|お気に入り|レビュー)|(販売数|カート|お気に入り|レビュー).{0,100}(\d[\d,]*\s*円)/.test(text)) {
    return true;
  }
  return false;
}

function isUsefulDetailValue(value) {
  const text = trimDetailText(value, 260);
  if (text.length < 4) return false;
  return !isLikelyDetailNoise(text);
}

function extractLabeledLine(lines, labelPattern, fallbackPattern = null) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelPattern.test(line)) continue;

    const afterLabel = trimDetailText(line.replace(labelPattern, "").replace(/^[\s:：\-・|]+/, ""));
    if (isUsefulDetailValue(afterLabel)) return afterLabel;

    const next = lines[index + 1];
    const nextLooksLikeStandaloneLabel =
      next && next.length <= 24 && (CONDITION_LABEL_PATTERN.test(next) || SCOPE_LABEL_PATTERN.test(next));
    if (next && !nextLooksLikeStandaloneLabel && isUsefulDetailValue(next)) return trimDetailText(next);
  }

  if (fallbackPattern) {
    const line = lines.find((value) => fallbackPattern.test(value));
    if (line && isUsefulDetailValue(line)) return trimDetailText(line);
  }
  return "";
}

function inferRequiresLogin(text) {
  if (/ログイン不要|ログインなし|无需登录|不需要登录|免登录/i.test(text)) return false;
  if (/(ログイン|会員登録|アカウント|DLsiteアカウント|需要登录|登录后|登入后).{0,18}(必要|後|してください|领取|取得|獲得|応募|参加|使用)|(?:必要|後|领取|取得|獲得|応募|参加|使用).{0,18}(ログイン|会員登録|アカウント|需要登录|登录)/i.test(text)) {
    return true;
  }
  return null;
}

function inferLimited(text) {
  if (/数量制限なし|数量限定なし|不限量|先着なし/i.test(text)) return false;
  if (/(先着|数量限定|なくなり次第|なくなり次第終了|予定数|枚限定|本限定|名様限定|限量|售完即止)/i.test(text)) {
    return true;
  }
  return null;
}

function dateToJstIso(year, month, day, hour = 23, minute = 59) {
  const date = new Date(Date.UTC(year, month - 1, day, hour - 9, minute, hour === 23 && minute === 59 ? 59 : 0));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function extractDetailEndsAt(lines) {
  const candidates = [];
  for (const line of lines) {
    if (!DEADLINE_LABEL_PATTERN.test(line)) continue;
    for (const match of line.matchAll(DETAIL_DATE_PATTERN)) {
      const [, year, month, day, hour, minute] = match;
      const iso = dateToJstIso(
        Number(year),
        Number(month),
        Number(day),
        hour === undefined ? 23 : Number(hour),
        minute === undefined ? (hour === undefined ? 59 : 0) : Number(minute)
      );
      if (iso) candidates.push(iso);
    }
  }
  return candidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || "";
}

function isGenericDlsiteDescription(value) {
  const text = normalizeSpace(value);
  return /DLsite/.test(text) && /ダウンロードショップ|検索結果|同人誌・同人ゲーム/.test(text);
}

function buildDetailSummary($, lines, { title = "" } = {}) {
  const meta = extractMetaDescription($);
  if (meta && !isGenericDlsiteDescription(meta)) return meta;

  const pageTitle = trimDetailText($("h1").first().text() || $("title").first().text());
  const blocked = new Set([trimDetailText(title).toLowerCase(), pageTitle.toLowerCase()].filter(Boolean));
  const line = lines.find(
    (value) => value.length >= 16 && !blocked.has(value.toLowerCase()) && !isLikelyDetailNoise(value)
  );
  return trimDetailText(line || pageTitle || "详情页已读取，但没有提取到可结构化的公开条件。");
}

export function parseActivityDetailHtml(html, options = {}) {
  const $ = load(String(html || ""));
  const lines = extractDetailLines($);
  const joinedText = normalizeSpace(lines.join(" "));
  const claimCondition = extractLabeledLine(lines, CONDITION_LABEL_PATTERN, /(クーポン|coupon|领取|獲得|取得|応募|購入).{0,32}(条件|必要|対象|以上)/i);
  const applicableScope = extractLabeledLine(lines, SCOPE_LABEL_PATTERN, /(対象|適用|适用).{0,32}(作品|商品|ジャンル|フロア|カテゴリ|サークル)/i);
  const endsAt = extractDetailEndsAt(lines);
  const requiresLogin = inferRequiresLogin(joinedText);
  const isLimited = inferLimited(joinedText);
  const summary = buildDetailSummary($, lines, options);
  const hasStructuredFields = Boolean(
    claimCondition || applicableScope || endsAt || requiresLogin !== null || isLimited !== null
  );

  return {
    status: hasStructuredFields ? "parsed" : "fallback",
    summary,
    claimCondition,
    applicableScope,
    endsAt,
    requiresLogin,
    isLimited,
    raw: {
      pageTitle: trimDetailText($("title").first().text(), 120),
      lineCount: lines.length,
    },
  };
}

function stableHash(value) {
  let hash = 0;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function normalizeBannerDate(value) {
  const text = normalizeSpace(value);
  if (!text) return "";

  const jstMatch = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  const date = jstMatch ? new Date(`${jstMatch[1]}T${jstMatch[2]}+09:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function activityIdFor(banner, sourceKey) {
  const directId = banner.banner_id ?? banner.schedule_reserve_id ?? banner.id;
  if (directId) return `dlsite:${String(directId).trim()}`;
  return `dlsite:${sourceKey}:${stableHash(`${banner.title ?? ""}|${banner.alt ?? ""}|${banner.link ?? ""}`)}`;
}

export function classifyActivityBenefit({ title = "", url = "" } = {}) {
  const haystack = `${title} ${url}`.normalize("NFKC").toLowerCase();

  if (/クーポン|coupon|优惠券|優惠券/.test(haystack)) return "coupon";
  if (/ポイント|point|pt\b|還元|还元|点数|點數/.test(haystack)) return "point";
  if (/無料|free|0円|0\s*yen|限时免费|限時免費/.test(haystack)) return "free";
  if (/特典|bonus|プレゼント|gift|スクラッチ|scratch|抽選|抽奖|赠品|贈品/.test(haystack)) return "bonus";
  if (/%\s*off|％\s*off|割引|値引|セール|sale|discount|bulkbuy|セット割|折扣|特价|特價|优惠|優惠/.test(haystack)) {
    return "discount";
  }
  return "info";
}

function normalizeBanner(banner, { sourceKey = "campaign", sourceUrl = "", slot = "main", imageBase = MEDIA_BASE } = {}) {
  const title = normalizeSpace(banner.title || banner.alt || banner.name || "");
  const url = absoluteUrl(banner.link || banner.url || DLSITE_ALLCAMPAIGN_URL, DLSITE_BASE);
  if (!title || !url) return null;

  const imageUrl = absoluteUrl(
    banner.webp_path || banner.ssl_path || banner.path || banner.image || banner.src || "",
    imageBase
  );
  const benefitType = classifyActivityBenefit({ title, url });

  return {
    activityId: activityIdFor(banner, sourceKey),
    source: sourceKey,
    slot,
    title,
    url,
    imageUrl,
    benefitType,
    benefitLabel: ACTIVITY_BENEFIT_LABELS[benefitType],
    benefitSummary: ACTIVITY_BENEFIT_SUMMARIES[benefitType],
    startsAt: normalizeBannerDate(banner.start_datetime || banner.start_at || banner.date),
    endsAt: normalizeBannerDate(banner.end_datetime || banner.end_at || banner.end_date),
    sourceUrl,
    raw: banner,
  };
}

export function parseActivityBannerPayload(payload, options = {}) {
  const banners = Array.isArray(payload?.banners) ? payload.banners : [];
  return banners.map((banner) => normalizeBanner(banner, options)).filter(Boolean);
}

function parseLegacyElement(html, index, options) {
  const $ = load(html);
  const link = $("a[href]").first();
  const image = $("img").first();
  return normalizeBanner(
    {
      banner_id: `legacy-element-${index}-${stableHash(html)}`,
      link: link.attr("href") || "",
      title: image.attr("title") || image.attr("alt") || normalizeSpace(link.text()),
      alt: image.attr("alt") || "",
      path: image.attr("src") || "",
    },
    options
  );
}

export function parseLegacyActivityBannerPayload(payload, options = {}) {
  const data = payload?.data ?? {};
  const items = [];

  for (const [key, group] of Object.entries(data)) {
    const sourceKey = options.sourceKey || key;
    const slot = key.includes("mini") ? "mini" : "main";
    const groupOptions = { ...options, sourceKey, slot, imageBase: DLSITE_BASE };

    for (const banner of Array.isArray(group?.banners) ? group.banners : []) {
      const item = normalizeBanner(banner, groupOptions);
      if (item) items.push(item);
    }

    if (items.length > 0) continue;
    for (const [index, element] of (group?.elements ?? []).entries()) {
      const item = parseLegacyElement(element, index, groupOptions);
      if (item) items.push(item);
    }
  }

  return items;
}

function dedupeActivities(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = item.activityId || item.url;
    if (!byKey.has(key)) {
      byKey.set(key, item);
      continue;
    }

    const existing = byKey.get(key);
    byKey.set(key, {
      ...existing,
      ...item,
      imageUrl: existing.imageUrl || item.imageUrl,
      startsAt: existing.startsAt || item.startsAt,
      endsAt: existing.endsAt || item.endsAt,
      raw: {
        sources: [existing.raw, item.raw].filter(Boolean),
      },
    });
  }
  return [...byKey.values()].sort((a, b) => {
    const endDelta = new Date(a.endsAt || "9999-12-31").getTime() - new Date(b.endsAt || "9999-12-31").getTime();
    if (endDelta !== 0) return endDelta;
    return a.title.localeCompare(b.title, "ja-JP");
  });
}

async function fetchJson(url, { minDelayMs }) {
  const response = await politeFetch(url, {
    minDelayMs,
    headers: {
      Accept: "application/json,text/javascript;q=0.9,*/*;q=0.8",
      Referer: DLSITE_ALLCAMPAIGN_URL,
    },
  });
  return response.json();
}

async function fetchActivityDetailHtml(url, { minDelayMs }) {
  const response = await politeFetch(url, {
    minDelayMs,
    retries: 1,
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      Referer: DLSITE_ALLCAMPAIGN_URL,
    },
  });
  const contentType = response.headers?.get("content-type") || "";
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`Unsupported detail content type: ${contentType}`);
  }
  return response.text();
}

function detailCacheKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(url || "");
  }
}

function readCachedActivityDetail(url, { nowMs, cacheTtlMs }) {
  const cached = activityDetailCache.get(detailCacheKey(url));
  if (!cached) return null;
  if (cacheTtlMs <= 0 || cached.expiresAt <= nowMs) {
    activityDetailCache.delete(detailCacheKey(url));
    return null;
  }
  return { ...cached.detail, cached: true };
}

function writeCachedActivityDetail(url, detail, { nowMs, cacheTtlMs }) {
  if (cacheTtlMs <= 0 || !url) return;
  activityDetailCache.set(detailCacheKey(url), {
    expiresAt: nowMs + cacheTtlMs,
    detail,
  });
}

function classifyActivityDetailTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return {
      canFetch: false,
      status: "skipped",
      summary: "活动链接无法识别，已保留 banner 信息。",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!["www.dlsite.com", "dlsite.com"].includes(host)) {
    return {
      canFetch: false,
      status: "external",
      summary: "外部专题链接未自动抓取详情，请打开原页面确认公开条件。",
    };
  }

  if (PRIVATE_DETAIL_PATH_PATTERN.test(parsed.pathname)) {
    return {
      canFetch: false,
      status: "skipped",
      summary: "疑似登录或账号相关页面，已跳过详情抓取。",
    };
  }

  if (/^\/(?:maniax|home|girls|bl|books|pro|app)\/fsr(?:\/|$)/i.test(parsed.pathname)) {
    return {
      canFetch: false,
      status: "fallback",
      summary: "FSR 搜索结果页未解析作品列表正文，已保留 banner 入口和公开筛选链接。",
    };
  }

  if (!PUBLIC_DETAIL_PATH_PATTERN.test(parsed.pathname)) {
    return {
      canFetch: false,
      status: "skipped",
      summary: "非活动专题路径，已保留 banner 信息。",
    };
  }

  return { canFetch: true, url: parsed.toString() };
}

export async function fetchActivityDetail(activity, {
  detailFetcher = fetchActivityDetailHtml,
  minDelayMs = DEFAULT_ACTIVITY_DELAY_MS,
  cacheTtlMs = DEFAULT_ACTIVITY_DETAIL_CACHE_MS,
  nowMs = Date.now(),
} = {}) {
  const target = classifyActivityDetailTarget(activity?.url || "");
  const fetchedAt = new Date(nowMs).toISOString();
  if (!target.canFetch) {
    return {
      status: target.status,
      summary: target.summary,
      claimCondition: "",
      applicableScope: "",
      endsAt: "",
      requiresLogin: null,
      isLimited: null,
      fetchedAt: "",
      error: "",
      raw: {},
    };
  }

  const cached = readCachedActivityDetail(target.url, { nowMs, cacheTtlMs });
  if (cached) return cached;

  try {
    const html = await detailFetcher(target.url, { minDelayMs, activity });
    const detail = {
      ...parseActivityDetailHtml(html, activity),
      fetchedAt,
      error: "",
    };
    writeCachedActivityDetail(target.url, detail, { nowMs, cacheTtlMs });
    return detail;
  } catch (error) {
    return {
      status: "failed",
      summary: "详情页暂时无法读取，活动列表仍可正常显示。",
      claimCondition: "",
      applicableScope: "",
      endsAt: "",
      requiresLogin: null,
      isLimited: null,
      fetchedAt,
      error: error.message,
      raw: {},
    };
  }
}

export async function enrichActivityDetails(items, {
  includeDetails = false,
  detailFetcher = fetchActivityDetailHtml,
  minDelayMs = DEFAULT_ACTIVITY_DELAY_MS,
  cacheTtlMs = DEFAULT_ACTIVITY_DETAIL_CACHE_MS,
  detailLimit = DEFAULT_ACTIVITY_DETAIL_LIMIT,
  nowMs = Date.now(),
} = {}) {
  if (!includeDetails) return items;

  const limit = Math.max(0, Number(detailLimit) || 0);
  let fetchCount = 0;
  const enriched = [];
  for (const item of items) {
    const target = classifyActivityDetailTarget(item.url);
    if (target.canFetch && fetchCount >= limit) {
      enriched.push({
        ...item,
        details: {
          status: "skipped",
          summary: "本次刷新已达到详情抓取上限，保留 banner 信息。",
          claimCondition: "",
          applicableScope: "",
          endsAt: "",
          requiresLogin: null,
          isLimited: null,
          fetchedAt: "",
          error: "",
          raw: {},
        },
      });
      continue;
    }

    if (target.canFetch) fetchCount += 1;
    const details = await fetchActivityDetail(item, { detailFetcher, minDelayMs, cacheTtlMs, nowMs });
    enriched.push({
      ...item,
      endsAt: item.endsAt || details.endsAt || "",
      details,
    });
  }
  return enriched;
}

async function fetchLegacyActivities({ fetcher, minDelayMs }) {
  const url = new URL(`${LEGACY_BCS_BASE}/data.json`);
  for (const key of LEGACY_ACTIVITY_KEYS) url.searchParams.append("key[]", key);
  const payload = await fetcher(url.toString(), { minDelayMs });
  return {
    sourceUrl: url.toString(),
    items: parseLegacyActivityBannerPayload(payload, {
      sourceUrl: url.toString(),
      sourceKey: "legacy-bcs",
    }),
  };
}

export async function fetchDlsiteActivities({
  sources = DLSITE_ACTIVITY_SOURCES,
  fetcher = fetchJson,
  minDelayMs = Number(process.env.DLSITE_ACTIVITY_DELAY_MS) || DEFAULT_ACTIVITY_DELAY_MS,
  includeDetails = false,
  detailFetcher = fetchActivityDetailHtml,
  detailCacheTtlMs =
    Number(process.env.DLSITE_ACTIVITY_DETAIL_CACHE_MS) || DEFAULT_ACTIVITY_DETAIL_CACHE_MS,
  detailLimit = Number(process.env.DLSITE_ACTIVITY_DETAIL_LIMIT) || DEFAULT_ACTIVITY_DETAIL_LIMIT,
} = {}) {
  const errors = [];
  const fetchedSources = [];
  const items = [];

  for (const source of sources) {
    try {
      const payload = await fetcher(source.url, { minDelayMs });
      const sourceItems = parseActivityBannerPayload(payload, {
        sourceKey: source.key,
        sourceUrl: source.url,
        slot: source.slot,
        imageBase: MEDIA_BASE,
      });
      fetchedSources.push({ key: source.key, url: source.url, count: sourceItems.length });
      items.push(...sourceItems);
    } catch (error) {
      errors.push({ source: source.key, url: source.url, error: error.message });
    }
  }

  if (items.length === 0) {
    try {
      const legacy = await fetchLegacyActivities({ fetcher, minDelayMs });
      fetchedSources.push({ key: "legacy-bcs", url: legacy.sourceUrl, count: legacy.items.length });
      items.push(...legacy.items);
    } catch (error) {
      errors.push({ source: "legacy-bcs", url: `${LEGACY_BCS_BASE}/data.json`, error: error.message });
    }
  }

  return {
    items: await enrichActivityDetails(dedupeActivities(items), {
      includeDetails,
      detailFetcher,
      minDelayMs,
      cacheTtlMs: detailCacheTtlMs,
      detailLimit,
    }),
    sources: fetchedSources,
    errors,
    allCampaignUrl: DLSITE_ALLCAMPAIGN_URL,
  };
}

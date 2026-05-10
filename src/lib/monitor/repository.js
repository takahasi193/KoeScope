import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { alertFingerprint, evaluatePriceAlert } from "./alerts.js";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "dlsite-monitor.sqlite");
const ACCOUNT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const PERSONAL_ACTIVITY_BENEFITS = ["point", "coupon", "discount"];
const ACTIVITY_WORK_MATCH_MIN_SCORE = 40;
const PERSONAL_ACTIVITY_BENEFIT_COPY = {
  point: {
    label: "Point campaigns",
    description: "Public point campaigns shown with your current point balance as context.",
    priority: 1,
  },
  coupon: {
    label: "Coupon campaigns",
    description: "Public coupon campaigns; verify coupon ownership and eligibility on DLsite.",
    priority: 2,
  },
  discount: {
    label: "Discount campaigns",
    description: "Public discount campaigns that may be useful alongside synced account points.",
    priority: 3,
  },
};
const FOLLOW_SOURCE_COPY = {
  watchlist: "本地关注",
  wishlist: "DLsite 愿望单",
  favorite: "DLsite 收藏",
  account_watchlist: "账号关注",
};
const ACTIVITY_TERM_GROUPS = [
  {
    id: "voice",
    label: "音声/ASMR",
    activityTerms: ["asmr", "音声", "ボイス", "voice", "耳かき", "バイノーラル"],
    workTerms: ["asmr", "音声", "ボイス", "voice", "sou", "耳かき", "バイノーラル"],
  },
  {
    id: "game",
    label: "游戏",
    activityTerms: ["ゲーム", "game", "rpg", "slg", "act"],
    workTerms: ["ゲーム", "game", "rpg", "slg", "act", "gam"],
  },
  {
    id: "manga",
    label: "漫画",
    activityTerms: ["マンガ", "漫画", "コミック", "manga", "comic", "同人誌"],
    workTerms: ["マンガ", "漫画", "コミック", "manga", "comic", "同人誌", "mng", "bkm"],
  },
];

function isoNow() {
  return new Date().toISOString();
}

function asJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toNullableBooleanInt(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === 1 || value === "1") return 1;
  if (value === 0 || value === "0") return 0;
  return null;
}

function fromNullableBooleanInt(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number(value) === 1;
}

function compactText(...values) {
  return values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => {
      if (Array.isArray(value)) return value.join(" ");
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    })
    .join(" ")
    .toLowerCase();
}

function normalizeComparableText(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function includesMeaningfulText(haystack, needle, minLength = 4) {
  const normalizedNeedle = normalizeComparableText(needle);
  if (normalizedNeedle.length < minLength) return false;
  return normalizeComparableText(haystack).includes(normalizedNeedle);
}

function containsAnyTerm(text, terms) {
  return terms.some((term) => text.includes(String(term).toLowerCase()));
}

function extractProductIds(text) {
  const ids = String(text ?? "").match(/\b(?:RJ|VJ|BJ)\d{5,}\b/gi) ?? [];
  return new Set(ids.map((id) => id.toUpperCase()));
}

function toNullableInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function toNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function toNullablePrice(value, fieldName = "price") {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${fieldName} must be a non-negative number.`);
    error.statusCode = 400;
    throw error;
  }

  return Math.trunc(number);
}

function normalizeProductId(value) {
  return String(value ?? "").trim().toUpperCase();
}

function accountListLabel(type) {
  const labels = {
    wishlist: "DLsite 关注",
    favorite: "DLsite 收藏",
    collection: "DLsite 已购",
  };
  return labels[type] ?? type;
}

function mapWorkRow(row) {
  if (!row) return null;
  return {
    productId: row.product_id,
    title: row.title,
    url: row.url,
    imageUrl: row.image_url,
    circle: row.circle,
    circleId: row.circle_id,
    floor: row.floor,
    ageCategory: row.age_category,
    workType: row.work_type,
    categoryLabel: row.category_label,
    genres: parseJson(row.genres_json, []),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    latestPriceJpy: row.latest_price_jpy,
    latestOfficialPriceJpy: row.latest_official_price_jpy,
    latestDiscountRate: row.latest_discount_rate,
    latestSales: row.latest_sales,
    latestRatingCount: row.latest_rating_count,
    latestRank: row.latest_rank,
    latestRankPeriod: row.latest_rank_period,
    latestRankFloor: row.latest_rank_floor,
    latestRankedAt: row.latest_ranked_at,
    previousPriceJpy: row.previous_price_jpy,
    priceDeltaJpy: row.price_delta_jpy,
    priceDeltaPercent: row.price_delta_percent,
    discountEndsAt: row.discount_ends_at,
    isWatched: Boolean(row.is_watched),
    targetPriceJpy: row.target_price_jpy,
  };
}

function mapSyncRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    scope: parseJson(row.scope_json, {}),
    progress: parseJson(row.progress_json, {}),
    totalTargets: row.total_targets,
    fetchedRankings: row.fetched_rankings,
    enrichedWorks: row.enriched_works,
    error: row.error || "",
  };
}

function mapAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    type: row.type,
    previousPriceJpy: row.previous_price_jpy,
    currentPriceJpy: row.current_price_jpy,
    targetPriceJpy: row.target_price_jpy,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    sourceRunId: row.source_run_id,
    title: row.title,
    imageUrl: row.image_url,
    circle: row.circle,
  };
}

function mapActivitySyncRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    scope: parseJson(row.scope_json, {}),
    sourceCount: row.source_count,
    activityCount: row.activity_count,
    error: row.error || "",
    isRunning: row.status === "running",
  };
}

function mapActivityAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    activityId: row.activity_id,
    type: row.type,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapActivityAlertSummaryItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    activityId: row.activity_id,
    type: row.type,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    activityTitle: row.activity_title || "",
    activityUrl: row.activity_url || "",
    benefitType: row.benefit_type || "",
    benefitLabel: row.benefit_label || "",
    endsAt: row.ends_at || "",
  };
}

function mapActivityDetail(row) {
  const detail = {
    status: row.detail_status || "pending",
    summary: row.detail_summary || "",
    claimCondition: row.claim_condition || "",
    applicableScope: row.applicable_scope || "",
    endsAt: row.detail_ends_at || "",
    requiresLogin: fromNullableBooleanInt(row.requires_login),
    isLimited: fromNullableBooleanInt(row.is_limited),
    fetchedAt: row.detail_fetched_at || "",
    error: row.detail_error || "",
    raw: parseJson(row.detail_json, {}),
  };
  return detail;
}

function mapActivity(row, alerts = []) {
  if (!row) return null;
  return {
    activityId: row.activity_id,
    source: row.source,
    slot: row.slot,
    title: row.title,
    url: row.url,
    imageUrl: row.image_url,
    benefitType: row.benefit_type,
    benefitLabel: row.benefit_label,
    benefitSummary: row.benefit_summary,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSyncedAt: row.last_synced_at,
    details: mapActivityDetail(row),
    raw: parseJson(row.raw_json, {}),
    unreadAlerts: alerts,
  };
}

function mapWatchlist(row) {
  if (!row) return null;
  return {
    productId: row.product_id,
    targetPriceJpy: row.target_price_jpy,
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    url: row.url,
    imageUrl: row.image_url,
    circle: row.circle,
    latestPriceJpy: row.latest_price_jpy,
    latestOfficialPriceJpy: row.latest_official_price_jpy,
    latestDiscountRate: row.latest_discount_rate,
    source: row.source || "local",
  };
}

function mapFollowedActivityWork(row) {
  const accountTypes = String(row.account_list_types || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const sourceTypes = new Set(accountTypes);
  if (row.is_watched) {
    sourceTypes.add(row.watch_source === "local" ? "watchlist" : "account_watchlist");
  }

  return {
    ...mapWorkRow(row),
    sourceTypes: [...sourceTypes],
    sourceLabels: [...sourceTypes].map((type) => FOLLOW_SOURCE_COPY[type] ?? type),
    watchSource: row.watch_source || "",
    accountListTypes: accountTypes,
  };
}

function hasPriceDiscount(work) {
  if ((work.latestDiscountRate ?? 0) > 0) return true;
  return (
    Number.isFinite(Number(work.latestPriceJpy)) &&
    Number.isFinite(Number(work.latestOfficialPriceJpy)) &&
    Number(work.latestOfficialPriceJpy) > Number(work.latestPriceJpy)
  );
}

function workSearchText(work) {
  return compactText(
    work.productId,
    work.title,
    work.circle,
    work.circleId,
    work.floor,
    work.ageCategory,
    work.workType,
    work.categoryLabel,
    work.genres
  );
}

function activitySearchText(activity) {
  return compactText(
    activity.activityId,
    activity.title,
    activity.url,
    activity.benefitType,
    activity.benefitLabel,
    activity.benefitSummary,
    activity.raw
  );
}

function priceText(work) {
  if (!Number.isFinite(Number(work.latestPriceJpy))) return "";
  return `${Number(work.latestPriceJpy).toLocaleString("ja-JP")}円`;
}

function publicWorkMatch(work, { score, confidence, reasons }) {
  return {
    productId: work.productId,
    title: work.title,
    url: work.url,
    imageUrl: work.imageUrl,
    circle: work.circle,
    latestPriceJpy: work.latestPriceJpy,
    latestOfficialPriceJpy: work.latestOfficialPriceJpy,
    latestDiscountRate: work.latestDiscountRate,
    sourceTypes: work.sourceTypes,
    sourceLabels: work.sourceLabels,
    score,
    confidence,
    reasons,
    claimsEntitlement: false,
  };
}

function scoreActivityWorkMatch(activity, work) {
  const activityText = activitySearchText(activity);
  const currentWorkText = workSearchText(work);
  const reasons = [];
  let score = 0;

  if (extractProductIds(activityText).has(work.productId)) {
    score += 90;
    reasons.push("活动链接或描述直接包含作品编号");
  }

  if (work.circleId && activityText.includes(String(work.circleId).toLowerCase())) {
    score += 56;
    reasons.push("活动信息包含关注作品的社团编号");
  } else if (includesMeaningfulText(activityText, work.circle, 4)) {
    score += 50;
    reasons.push("活动标题或链接提到关注作品的社团");
  }

  if (includesMeaningfulText(activityText, work.title, 8)) {
    score += 70;
    reasons.push("活动标题或链接提到关注作品标题");
  }

  for (const group of ACTIVITY_TERM_GROUPS) {
    if (containsAnyTerm(activityText, group.activityTerms) && containsAnyTerm(currentWorkText, group.workTerms)) {
      score += 32;
      reasons.push(`活动主题与作品分类同为${group.label}`);
      break;
    }
  }

  if (activity.benefitType === "discount" && hasPriceDiscount(work)) {
    score += 36;
    reasons.push(`关注作品当前有折扣${work.latestDiscountRate ? ` ${work.latestDiscountRate}%OFF` : ""}`);
  }

  if (activity.benefitType === "coupon" && /coupon|クーポン|%off|％off|off|割引/i.test(activityText)) {
    score += 14;
    reasons.push("活动公开信息是优惠券或折扣入口");
  }

  if (activity.benefitType === "point" && Number.isFinite(Number(work.latestPriceJpy))) {
    score += 8;
    reasons.push(`作品有价格信息 ${priceText(work)}`);
  }

  if (activity.url?.includes("/maniax/") && work.floor === "maniax") {
    score += 6;
    reasons.push("活动楼层与作品楼层一致");
  } else if (activity.url?.includes("/home/") && work.floor === "home") {
    score += 6;
    reasons.push("活动楼层与作品楼层一致");
  }

  if (work.sourceTypes.includes("watchlist")) {
    score += 8;
    reasons.push("来自本地 watchlist");
  }
  if (work.sourceTypes.some((type) => type === "wishlist" || type === "favorite" || type === "account_watchlist")) {
    score += 8;
    reasons.push("来自账号愿望单或收藏");
  }

  if (score < ACTIVITY_WORK_MATCH_MIN_SCORE) return null;

  return publicWorkMatch(work, {
    score,
    confidence: score >= 80 ? "high" : "medium",
    reasons: [...new Set(reasons)].slice(0, 5),
  });
}

function buildActivityWorkMatchPayload({ activities, followedWorks }) {
  const byActivity = new Map();
  const allMatches = [];

  for (const activity of activities) {
    const matches = followedWorks
      .map((work) => scoreActivityWorkMatch(activity, work))
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.latestDiscountRate ?? 0) - (a.latestDiscountRate ?? 0) ||
          String(a.productId).localeCompare(String(b.productId))
      )
      .slice(0, 4);

    if (!matches.length) continue;
    byActivity.set(activity.activityId, matches);
    allMatches.push(...matches.map((match) => ({ ...match, activityId: activity.activityId, activityTitle: activity.title })));
  }

  const matchedWorks = new Set(allMatches.map((match) => match.productId));
  const matchedActivities = new Set(allMatches.map((match) => match.activityId));
  const emptyReason = followedWorks.length === 0
    ? "no_followed_works"
    : activities.length === 0
      ? "no_active_activities"
      : allMatches.length === 0
        ? "no_matches"
        : null;
  const message = emptyReason === "no_followed_works"
    ? "关注作品或同步 DLsite 愿望单后，这里会显示可能相关的活动入口。"
    : emptyReason === "no_active_activities"
      ? "当前没有可匹配的活动快照。"
      : emptyReason === "no_matches"
        ? "当前没有发现关注作品与活动的保守匹配。"
        : `发现 ${allMatches.length.toLocaleString("ja-JP")} 个可能相关的活动/作品匹配。`;

  return {
    byActivity,
    summary: {
      totalMatches: allMatches.length,
      matchedWorks: matchedWorks.size,
      matchedActivities: matchedActivities.size,
      followedWorks: followedWorks.length,
      emptyReason,
      message,
      claimsEntitlement: false,
      disclaimer: "仅基于公开活动信息和本地/账号关注数据做保守匹配；优惠券领取、适用条件和最终价格请以 DLsite 页面为准。",
      sampleMatches: allMatches.slice(0, 6),
    },
  };
}

function normalizeActivityId(value) {
  return String(value ?? "").trim();
}

function normalizeActivityDetail(value) {
  const detail = value && typeof value === "object" ? value : null;
  return {
    hasDetail: detail ? 1 : 0,
    detailStatus: String(detail?.status || "pending").trim() || "pending",
    detailSummary: String(detail?.summary || "").trim(),
    claimCondition: String(detail?.claimCondition || "").trim(),
    applicableScope: String(detail?.applicableScope || "").trim(),
    detailEndsAt: detail?.endsAt || null,
    requiresLogin: toNullableBooleanInt(detail?.requiresLogin),
    isLimited: toNullableBooleanInt(detail?.isLimited),
    detailFetchedAt: detail?.fetchedAt || null,
    detailError: String(detail?.error || "").trim(),
    detailJson: asJson(detail?.raw ?? {}),
  };
}

function isActivityEndingSoon(endsAt, nowIsoValue) {
  if (!endsAt) return false;
  const endMs = new Date(endsAt).getTime();
  const nowMs = new Date(nowIsoValue).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) return false;
  const remainingMs = endMs - nowMs;
  return remainingMs > 0 && remainingMs <= 24 * 60 * 60 * 1000;
}

function activityAlertFingerprint(activityId, type, endsAt = "") {
  return `activity:${activityId}:${type}:${endsAt || "open"}`;
}

function accountFreshness(lastSyncedAt, hasSession = false) {
  const syncedAtMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : NaN;
  const syncAgeMs = Number.isFinite(syncedAtMs) ? Math.max(0, Date.now() - syncedAtMs) : null;
  return {
    syncAgeMs,
    staleAfterMs: ACCOUNT_STALE_AFTER_MS,
    isStale: hasSession && (syncAgeMs === null || syncAgeMs > ACCOUNT_STALE_AFTER_MS),
  };
}

function mapAccountSession(row, { includeSecret = false } = {}) {
  if (!row) {
    return {
      hasSession: false,
      displayName: "",
      pointsJpy: null,
      loginState: "disconnected",
      lastSyncedAt: null,
      updatedAt: null,
      syncAgeMs: null,
      staleAfterMs: ACCOUNT_STALE_AFTER_MS,
      isStale: false,
      lists: {},
    };
  }

  const hasSession = Boolean(row.cookie_header || row.login_state === "active");
  const mapped = {
    hasSession,
    displayName: row.display_name || "",
    pointsJpy: row.points_jpy,
    loginState: row.login_state || "unknown",
    lastSyncedAt: row.last_synced_at,
    updatedAt: row.updated_at,
    raw: parseJson(row.raw_json, {}),
    ...accountFreshness(row.last_synced_at, hasSession),
  };
  if (includeSecret) mapped.cookieHeader = row.cookie_header || "";
  return mapped;
}

function publicAccountSnapshot(account) {
  return {
    hasSession: account.hasSession,
    displayName: account.displayName || "",
    pointsJpy: account.pointsJpy,
    loginState: account.loginState,
    lastSyncedAt: account.lastSyncedAt,
    updatedAt: account.updatedAt,
    syncAgeMs: account.syncAgeMs,
    staleAfterMs: account.staleAfterMs,
    isStale: account.isStale,
    lists: account.lists ?? {},
  };
}

function formatPointBalance(pointsJpy) {
  const points = toNonNegativeInteger(pointsJpy);
  return Number.isFinite(points) ? `${points.toLocaleString("ja-JP")} pt` : "Not synced";
}

function describeAccountSync(syncState, account) {
  if (syncState === "fresh") return `Synced ${account.lastSyncedAt}`;
  if (syncState === "stale") return `Stale since ${account.lastSyncedAt || account.updatedAt || "unknown"}`;
  if (syncState === "pending") return "Connected; waiting for first account sync";
  return "Connect DLsite account for personal context";
}

function buildActivityHighlights({ account, activeBenefitCounts, syncState, relatedWorkSummary = null }) {
  const relatedPointCouponCount = (activeBenefitCounts.point ?? 0) + (activeBenefitCounts.coupon ?? 0);
  const relatedMatches = relatedWorkSummary?.totalMatches ?? 0;
  if (!account.hasSession && relatedPointCouponCount === 0 && relatedMatches === 0) return [];

  const highlights = [
    {
      id: "points",
      label: "Current points",
      value: account.pointsJpy,
      valueText: account.hasSession ? formatPointBalance(account.pointsJpy) : "Not connected",
      tone: account.hasSession ? "default" : "muted",
    },
    {
      id: "freshness",
      label: "Account sync",
      value: account.lastSyncedAt,
      valueText: describeAccountSync(syncState, account),
      tone: syncState === "stale" || syncState === "pending" ? "warn" : account.hasSession ? "default" : "muted",
    },
    {
      id: "related-public-activities",
      label: "Point/coupon entries",
      value: relatedPointCouponCount,
      valueText: `${relatedPointCouponCount.toLocaleString("ja-JP")} public`,
      tone: relatedPointCouponCount > 0 ? "default" : "muted",
    },
  ];

  if (relatedMatches > 0) {
    highlights.push({
      id: "activity-work-matches",
      label: "Potential matches",
      value: relatedMatches,
      valueText: `${relatedMatches.toLocaleString("ja-JP")} possible`,
      tone: "default",
    });
  }

  return highlights;
}

function recommendationReason(item) {
  const reasons = [];
  if (item.bestRank) reasons.push(`${item.bestRankLabel} #${item.bestRank}`);
  if (item.latestDiscountRate) reasons.push(`${item.latestDiscountRate}%OFF`);
  if (item.officialDiscountRate && item.officialDiscountRate > (item.latestDiscountRate ?? 0)) {
    reasons.push(`约 ${item.officialDiscountRate}%OFF`);
  }
  if (Number.isFinite(item.leftoverJpy)) reasons.push(`剩余 ${item.leftoverJpy.toLocaleString("ja-JP")}円`);
  return reasons;
}

function scoreRecommendation(item, budgetJpy) {
  const rankBase = Number.isFinite(item.bestRank) ? Math.max(0, 101 - item.bestRank) : 0;
  const salesScore = Math.min(100, Math.log10(Math.max(1, item.latestSales ?? 0) + 1) * 26);
  const popularityScore = Math.min(100, rankBase * item.bestRankWeight + salesScore * 0.18);

  const officialDiscountRate =
    item.latestOfficialPriceJpy && item.latestOfficialPriceJpy > item.latestPriceJpy
      ? Math.round(((item.latestOfficialPriceJpy - item.latestPriceJpy) * 100) / item.latestOfficialPriceJpy)
      : 0;
  const discountScore = Math.max(item.latestDiscountRate ?? 0, officialDiscountRate);
  const budgetFitScore =
    budgetJpy > 0 ? Math.max(0, Math.min(30, ((budgetJpy - item.latestPriceJpy) * 30) / budgetJpy)) : 0;
  const valueScore = Math.min(100, discountScore + budgetFitScore);

  return {
    ...item,
    officialDiscountRate,
    popularityScore: Math.round(popularityScore * 10) / 10,
    valueScore: Math.round(valueScore * 10) / 10,
    recommendationScore: Math.round((popularityScore * 0.78 + valueScore * 0.22) * 10) / 10,
    leftoverJpy: budgetJpy - item.latestPriceJpy,
  };
}

function migrate(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS works (
      product_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      image_url TEXT,
      circle TEXT,
      circle_id TEXT,
      floor TEXT NOT NULL,
      age_category TEXT,
      work_type TEXT,
      category_label TEXT,
      genres_json TEXT NOT NULL DEFAULT '[]',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      latest_price_jpy INTEGER,
      latest_official_price_jpy INTEGER,
      latest_discount_rate INTEGER,
      latest_sales INTEGER,
      latest_rating_count INTEGER,
      latest_rank INTEGER,
      latest_rank_period TEXT,
      latest_rank_floor TEXT,
      latest_ranked_at TEXT,
      discount_ends_at TEXT,
      raw_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      scope_json TEXT NOT NULL DEFAULT '{}',
      progress_json TEXT NOT NULL DEFAULT '{}',
      total_targets INTEGER NOT NULL DEFAULT 0,
      fetched_rankings INTEGER NOT NULL DEFAULT 0,
      enriched_works INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS ranking_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES works(product_id) ON DELETE CASCADE,
      sync_run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
      floor TEXT NOT NULL,
      period TEXT NOT NULL,
      category TEXT NOT NULL,
      rank INTEGER NOT NULL,
      sales INTEGER,
      price_jpy INTEGER,
      captured_at TEXT NOT NULL,
      source_url TEXT NOT NULL,
      UNIQUE(product_id, sync_run_id, floor, period, category)
    );

    CREATE INDEX IF NOT EXISTS idx_ranking_latest
      ON ranking_snapshots(floor, period, category, captured_at DESC, rank ASC);

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES works(product_id) ON DELETE CASCADE,
      sync_run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
      price_jpy INTEGER,
      official_price_jpy INTEGER,
      discount_rate INTEGER,
      sales INTEGER,
      captured_at TEXT NOT NULL,
      UNIQUE(product_id, sync_run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_price_history
      ON price_snapshots(product_id, captured_at ASC);

    CREATE TABLE IF NOT EXISTS watchlist (
      product_id TEXT PRIMARY KEY REFERENCES works(product_id) ON DELETE CASCADE,
      target_price_jpy INTEGER,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES works(product_id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      previous_price_jpy INTEGER,
      current_price_jpy INTEGER,
      target_price_jpy INTEGER,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      created_at TEXT NOT NULL,
      source_run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL,
      fingerprint TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_status_created
      ON alerts(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS account_session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie_header TEXT NOT NULL DEFAULT '',
      display_name TEXT,
      points_jpy INTEGER,
      login_state TEXT NOT NULL DEFAULT 'unknown',
      last_synced_at TEXT,
      updated_at TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS account_works (
      product_id TEXT NOT NULL REFERENCES works(product_id) ON DELETE CASCADE,
      list_type TEXT NOT NULL,
      floor TEXT,
      synced_at TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(product_id, list_type)
    );

    CREATE INDEX IF NOT EXISTS idx_account_works_type
      ON account_works(list_type, synced_at DESC);

    CREATE TABLE IF NOT EXISTS activity_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      scope_json TEXT NOT NULL DEFAULT '{}',
      source_count INTEGER NOT NULL DEFAULT 0,
      activity_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS activities (
      activity_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      slot TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      image_url TEXT,
      benefit_type TEXT NOT NULL,
      benefit_label TEXT NOT NULL,
      benefit_summary TEXT NOT NULL,
      starts_at TEXT,
      ends_at TEXT,
      detail_status TEXT NOT NULL DEFAULT 'pending',
      detail_summary TEXT,
      claim_condition TEXT,
      applicable_scope TEXT,
      detail_ends_at TEXT,
      requires_login INTEGER,
      is_limited INTEGER,
      detail_fetched_at TEXT,
      detail_error TEXT,
      detail_json TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_activities_active
      ON activities(benefit_type, ends_at, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS activity_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id TEXT NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      created_at TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_activity_alerts_status_created
      ON activity_alerts(status, created_at DESC);
  `);

  db.exec(`
    DELETE FROM watchlist
    WHERE product_id IN (
        SELECT product_id
        FROM account_works
        WHERE list_type = 'collection'
      );
  `);

  const watchlistColumns = new Set(
    db.prepare("PRAGMA table_info(watchlist)").all().map((column) => column.name)
  );
  if (!watchlistColumns.has("source")) {
    db.exec("ALTER TABLE watchlist ADD COLUMN source TEXT NOT NULL DEFAULT 'local'");
  }

  const activityColumns = new Set(
    db.prepare("PRAGMA table_info(activities)").all().map((column) => column.name)
  );
  const activityColumnMigrations = [
    ["detail_status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["detail_summary", "TEXT"],
    ["claim_condition", "TEXT"],
    ["applicable_scope", "TEXT"],
    ["detail_ends_at", "TEXT"],
    ["requires_login", "INTEGER"],
    ["is_limited", "INTEGER"],
    ["detail_fetched_at", "TEXT"],
    ["detail_error", "TEXT"],
    ["detail_json", "TEXT NOT NULL DEFAULT '{}'"],
  ];
  for (const [columnName, definition] of activityColumnMigrations) {
    if (!activityColumns.has(columnName)) {
      db.exec(`ALTER TABLE activities ADD COLUMN ${columnName} ${definition}`);
    }
  }
}

export function createMonitorRepository({ dbPath = process.env.DLSITE_MONITOR_DB || DEFAULT_DB_PATH } = {}) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  migrate(db);

  const statements = {
    createSyncRun: db.prepare(`
      INSERT INTO sync_runs (status, started_at, scope_json, progress_json, total_targets)
      VALUES ('running', @startedAt, @scopeJson, @progressJson, @totalTargets)
    `),
    updateSyncRun: db.prepare(`
      UPDATE sync_runs
      SET status = @status,
          finished_at = @finishedAt,
          progress_json = @progressJson,
          fetched_rankings = @fetchedRankings,
          enriched_works = @enrichedWorks,
          error = @error
      WHERE id = @id
    `),
    getSyncRun: db.prepare("SELECT * FROM sync_runs WHERE id = ?"),
    latestSyncRun: db.prepare("SELECT * FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT 1"),
    createActivitySyncRun: db.prepare(`
      INSERT INTO activity_sync_runs (status, started_at, scope_json)
      VALUES ('running', @startedAt, @scopeJson)
    `),
    updateActivitySyncRun: db.prepare(`
      UPDATE activity_sync_runs
      SET status = @status,
          finished_at = @finishedAt,
          source_count = @sourceCount,
          activity_count = @activityCount,
          error = @error
      WHERE id = @id
    `),
    getActivitySyncRun: db.prepare("SELECT * FROM activity_sync_runs WHERE id = ?"),
    latestActivitySyncRun: db.prepare("SELECT * FROM activity_sync_runs ORDER BY started_at DESC, id DESC LIMIT 1"),
    previousPrice: db.prepare(`
      SELECT price_jpy
      FROM price_snapshots
      WHERE product_id = ? AND sync_run_id <> ?
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `),
    upsertWork: db.prepare(`
      INSERT INTO works (
        product_id, title, url, image_url, circle, circle_id, floor, age_category,
        work_type, category_label, genres_json, first_seen_at, last_seen_at,
        latest_price_jpy, latest_official_price_jpy, latest_discount_rate,
        latest_sales, latest_rating_count, latest_rank, latest_rank_period,
        latest_rank_floor, latest_ranked_at, discount_ends_at, raw_json
      )
      VALUES (
        @productId, @title, @url, @imageUrl, @circle, @circleId, @floor, @ageCategory,
        @workType, @categoryLabel, @genresJson, @seenAt, @seenAt,
        @priceJpy, @officialPriceJpy, @discountRate,
        @sales, @ratingCount, @rank, @period,
        @floor, @seenAt, @discountEndsAt, @rawJson
      )
      ON CONFLICT(product_id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        image_url = COALESCE(excluded.image_url, works.image_url),
        circle = COALESCE(excluded.circle, works.circle),
        circle_id = COALESCE(excluded.circle_id, works.circle_id),
        floor = excluded.floor,
        age_category = COALESCE(excluded.age_category, works.age_category),
        work_type = COALESCE(excluded.work_type, works.work_type),
        category_label = COALESCE(excluded.category_label, works.category_label),
        genres_json = excluded.genres_json,
        last_seen_at = excluded.last_seen_at,
        latest_price_jpy = COALESCE(excluded.latest_price_jpy, works.latest_price_jpy),
        latest_official_price_jpy = COALESCE(excluded.latest_official_price_jpy, works.latest_official_price_jpy),
        latest_discount_rate = COALESCE(excluded.latest_discount_rate, works.latest_discount_rate),
        latest_sales = COALESCE(excluded.latest_sales, works.latest_sales),
        latest_rating_count = COALESCE(excluded.latest_rating_count, works.latest_rating_count),
        latest_rank = excluded.latest_rank,
        latest_rank_period = excluded.latest_rank_period,
        latest_rank_floor = excluded.latest_rank_floor,
        latest_ranked_at = excluded.latest_ranked_at,
        discount_ends_at = COALESCE(excluded.discount_ends_at, works.discount_ends_at),
        raw_json = excluded.raw_json
    `),
    insertRankingSnapshot: db.prepare(`
      INSERT INTO ranking_snapshots (
        product_id, sync_run_id, floor, period, category, rank, sales, price_jpy, captured_at, source_url
      )
      VALUES (@productId, @syncRunId, @floor, @period, @category, @rank, @sales, @priceJpy, @capturedAt, @sourceUrl)
      ON CONFLICT(product_id, sync_run_id, floor, period, category) DO UPDATE SET
        rank = excluded.rank,
        sales = COALESCE(excluded.sales, ranking_snapshots.sales),
        price_jpy = COALESCE(excluded.price_jpy, ranking_snapshots.price_jpy),
        captured_at = excluded.captured_at,
        source_url = COALESCE(NULLIF(excluded.source_url, ''), ranking_snapshots.source_url)
    `),
    insertPriceSnapshot: db.prepare(`
      INSERT INTO price_snapshots (
        product_id, sync_run_id, price_jpy, official_price_jpy, discount_rate, sales, captured_at
      )
      VALUES (@productId, @syncRunId, @priceJpy, @officialPriceJpy, @discountRate, @sales, @capturedAt)
      ON CONFLICT(product_id, sync_run_id) DO UPDATE SET
        price_jpy = COALESCE(excluded.price_jpy, price_snapshots.price_jpy),
        official_price_jpy = COALESCE(excluded.official_price_jpy, price_snapshots.official_price_jpy),
        discount_rate = COALESCE(excluded.discount_rate, price_snapshots.discount_rate),
        sales = COALESCE(excluded.sales, price_snapshots.sales),
        captured_at = excluded.captured_at
    `),
    getWatch: db.prepare("SELECT * FROM watchlist WHERE product_id = ?"),
    getOwnedAccountWork: db.prepare("SELECT product_id FROM account_works WHERE product_id = ? AND list_type = 'collection'"),
    insertAlert: db.prepare(`
      INSERT OR IGNORE INTO alerts (
        product_id, type, previous_price_jpy, current_price_jpy, target_price_jpy,
        message, status, created_at, source_run_id, fingerprint
      )
      VALUES (
        @productId, @type, @previousPriceJpy, @currentPriceJpy, @targetPriceJpy,
        @message, 'unread', @createdAt, @sourceRunId, @fingerprint
      )
    `),
    addWatchlist: db.prepare(`
      INSERT INTO watchlist (product_id, target_price_jpy, note, source, created_at, updated_at)
      VALUES (@productId, @targetPriceJpy, @note, @source, @now, @now)
      ON CONFLICT(product_id) DO UPDATE SET
        target_price_jpy = CASE
          WHEN excluded.source = 'dlsite_account' AND watchlist.source = 'local' THEN watchlist.target_price_jpy
          ELSE excluded.target_price_jpy
        END,
        note = CASE
          WHEN excluded.source = 'dlsite_account' AND watchlist.source = 'local' THEN watchlist.note
          ELSE excluded.note
        END,
        source = CASE
          WHEN excluded.source = 'dlsite_account' AND watchlist.source = 'local' THEN watchlist.source
          ELSE excluded.source
        END,
        updated_at = excluded.updated_at
    `),
    deleteWatchlist: db.prepare("DELETE FROM watchlist WHERE product_id = ?"),
    markAlertRead: db.prepare("UPDATE alerts SET status = 'read' WHERE id = ?"),
    getAccountSession: db.prepare("SELECT * FROM account_session WHERE id = 1"),
    upsertAccountSession: db.prepare(`
      INSERT INTO account_session (
        id, cookie_header, display_name, points_jpy, login_state,
        last_synced_at, updated_at, raw_json
      )
      VALUES (
        1, @cookieHeader, @displayName, @pointsJpy, @loginState,
        @lastSyncedAt, @updatedAt, @rawJson
      )
      ON CONFLICT(id) DO UPDATE SET
        cookie_header = excluded.cookie_header,
        display_name = excluded.display_name,
        points_jpy = excluded.points_jpy,
        login_state = excluded.login_state,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at,
        raw_json = excluded.raw_json
    `),
    clearAccountSession: db.prepare("DELETE FROM account_session WHERE id = 1"),
    deleteAccountWorksByType: db.prepare("DELETE FROM account_works WHERE list_type = ?"),
    insertAccountWork: db.prepare(`
      INSERT INTO account_works (product_id, list_type, floor, synced_at, raw_json)
      VALUES (@productId, @listType, @floor, @syncedAt, @rawJson)
      ON CONFLICT(product_id, list_type) DO UPDATE SET
        floor = excluded.floor,
        synced_at = excluded.synced_at,
        raw_json = excluded.raw_json
    `),
    deleteAccountWatchlistNotIn: db.prepare(`
      DELETE FROM watchlist
      WHERE source = 'dlsite_account'
        AND product_id NOT IN (SELECT value FROM json_each(@productIdsJson))
    `),
    deleteOwnedAccountWatchlist: db.prepare(`
      DELETE FROM watchlist
      WHERE product_id IN (
          SELECT product_id
          FROM account_works
          WHERE list_type = 'collection'
        )
    `),
    deleteAccountWatchlist: db.prepare("DELETE FROM watchlist WHERE source = 'dlsite_account'"),
    deleteAllAccountWorks: db.prepare("DELETE FROM account_works"),
    getActivity: db.prepare("SELECT * FROM activities WHERE activity_id = ?"),
    upsertActivity: db.prepare(`
      INSERT INTO activities (
        activity_id, source, slot, title, url, image_url,
        benefit_type, benefit_label, benefit_summary,
        starts_at, ends_at,
        detail_status, detail_summary, claim_condition, applicable_scope,
        detail_ends_at, requires_login, is_limited, detail_fetched_at, detail_error, detail_json,
        first_seen_at, last_seen_at, last_synced_at, raw_json
      )
      VALUES (
        @activityId, @source, @slot, @title, @url, @imageUrl,
        @benefitType, @benefitLabel, @benefitSummary,
        @startsAt, @endsAt,
        @detailStatus, @detailSummary, @claimCondition, @applicableScope,
        @detailEndsAt, @requiresLogin, @isLimited, @detailFetchedAt, @detailError, @detailJson,
        @firstSeenAt, @seenAt, @seenAt, @rawJson
      )
      ON CONFLICT(activity_id) DO UPDATE SET
        source = excluded.source,
        slot = excluded.slot,
        title = excluded.title,
        url = excluded.url,
        image_url = COALESCE(excluded.image_url, activities.image_url),
        benefit_type = excluded.benefit_type,
        benefit_label = excluded.benefit_label,
        benefit_summary = excluded.benefit_summary,
        starts_at = COALESCE(excluded.starts_at, activities.starts_at),
        ends_at = COALESCE(excluded.ends_at, activities.ends_at),
        detail_status = CASE WHEN @hasDetail = 1 THEN excluded.detail_status ELSE activities.detail_status END,
        detail_summary = CASE WHEN @hasDetail = 1 THEN excluded.detail_summary ELSE activities.detail_summary END,
        claim_condition = CASE WHEN @hasDetail = 1 THEN excluded.claim_condition ELSE activities.claim_condition END,
        applicable_scope = CASE WHEN @hasDetail = 1 THEN excluded.applicable_scope ELSE activities.applicable_scope END,
        detail_ends_at = CASE WHEN @hasDetail = 1 THEN excluded.detail_ends_at ELSE activities.detail_ends_at END,
        requires_login = CASE WHEN @hasDetail = 1 THEN excluded.requires_login ELSE activities.requires_login END,
        is_limited = CASE WHEN @hasDetail = 1 THEN excluded.is_limited ELSE activities.is_limited END,
        detail_fetched_at = CASE WHEN @hasDetail = 1 THEN excluded.detail_fetched_at ELSE activities.detail_fetched_at END,
        detail_error = CASE WHEN @hasDetail = 1 THEN excluded.detail_error ELSE activities.detail_error END,
        detail_json = CASE WHEN @hasDetail = 1 THEN excluded.detail_json ELSE activities.detail_json END,
        last_seen_at = excluded.last_seen_at,
        last_synced_at = excluded.last_synced_at,
        raw_json = excluded.raw_json
    `),
    insertActivityAlert: db.prepare(`
      INSERT OR IGNORE INTO activity_alerts (
        activity_id, type, message, status, created_at, fingerprint
      )
      VALUES (@activityId, @type, @message, 'unread', @createdAt, @fingerprint)
    `),
    getUnreadActivityAlertsForActivity: db.prepare(`
      SELECT *
      FROM activity_alerts
      WHERE activity_id = ? AND status = 'unread'
      ORDER BY created_at DESC, id DESC
    `),
    getUnreadActivityAlertTypeCounts: db.prepare(`
      SELECT type, COUNT(*) AS count
      FROM activity_alerts
      WHERE status = 'unread'
      GROUP BY type
    `),
    getUnreadActivityAlertSummaryItems: db.prepare(`
      SELECT
        aa.*,
        a.title AS activity_title,
        a.url AS activity_url,
        a.benefit_type,
        a.benefit_label,
        a.ends_at
      FROM activity_alerts aa
      LEFT JOIN activities a
        ON a.activity_id = aa.activity_id
      WHERE aa.status = 'unread'
      ORDER BY aa.created_at DESC, aa.id DESC
      LIMIT ?
    `),
    unreadActivityAlertCount: db.prepare("SELECT COUNT(*) AS count FROM activity_alerts WHERE status = 'unread'"),
    markActivityAlertRead: db.prepare("UPDATE activity_alerts SET status = 'read' WHERE id = ?"),
  };

  const saveImportedWorkTransaction = db.transaction((entry) => {
    const productId = normalizeProductId(entry.productId);
    if (!productId) {
      const error = new Error("productId is required.");
      error.statusCode = 400;
      throw error;
    }

    const now = isoNow();
    statements.upsertWork.run({
      productId,
      title: entry.title || productId,
      url: entry.url || `https://www.dlsite.com/${entry.floor || "home"}/work/=/product_id/${productId}.html`,
      imageUrl: entry.imageUrl || "",
      circle: entry.circle || "",
      circleId: entry.circleId || "",
      floor: entry.floor || "home",
      ageCategory: entry.ageCategory || "",
      workType: entry.workType || "",
      categoryLabel: entry.categoryLabel || "",
      genresJson: asJson(entry.genres ?? []),
      seenAt: now,
      priceJpy: toNullableInteger(entry.priceJpy),
      officialPriceJpy: toNullableInteger(entry.officialPriceJpy ?? entry.priceJpy),
      discountRate: toNullableInteger(entry.discountRate),
      sales: toNullableInteger(entry.sales),
      ratingCount: toNullableInteger(entry.ratingCount),
      rank: null,
      period: "",
      discountEndsAt: entry.discountEndsAt || null,
      rawJson: asJson(entry.raw ?? { source: "manual_import" }),
    });

    return productId;
  });

  const saveProductsTransaction = db.transaction(({ syncRunId, capturedAt, entries, evaluateAlerts = true }) => {
    for (const entry of entries) {
      const productId = normalizeProductId(entry.productId);
      if (!productId) continue;

      const previousPriceJpy = statements.previousPrice.get(productId, syncRunId)?.price_jpy ?? null;
      const work = {
        productId,
        title: entry.title || productId,
        url: entry.url || `https://www.dlsite.com/${entry.floor || "home"}/work/=/product_id/${productId}.html`,
        imageUrl: entry.imageUrl || "",
        circle: entry.circle || "",
        circleId: entry.circleId || "",
        floor: entry.floor || "home",
        ageCategory: entry.ageCategory || "",
        workType: entry.workType || "",
        categoryLabel: entry.categoryLabel || "",
        genresJson: asJson(entry.genres ?? []),
        seenAt: capturedAt,
        priceJpy: toNullableInteger(entry.priceJpy),
        officialPriceJpy: toNullableInteger(entry.officialPriceJpy),
        discountRate: toNullableInteger(entry.discountRate),
        sales: toNullableInteger(entry.sales),
        ratingCount: toNullableInteger(entry.ratingCount),
        rank: toNullableInteger(entry.rank),
        period: entry.period || "",
        discountEndsAt: entry.discountEndsAt || null,
        rawJson: asJson(entry.raw ?? {}),
      };

      statements.upsertWork.run(work);
      statements.insertRankingSnapshot.run({
        productId,
        syncRunId,
        floor: work.floor,
        period: entry.period,
        category: entry.category || "voice",
        rank: work.rank,
        sales: work.sales,
        priceJpy: work.priceJpy,
        capturedAt,
        sourceUrl: entry.sourceUrl || "",
      });
      statements.insertPriceSnapshot.run({
        productId,
        syncRunId,
        priceJpy: work.priceJpy,
        officialPriceJpy: work.officialPriceJpy,
        discountRate: work.discountRate,
        sales: work.sales,
        capturedAt,
      });

      if (!evaluateAlerts) continue;
      if (statements.getOwnedAccountWork.get(productId)) continue;

      const watch = statements.getWatch.get(productId);
      if (!watch) continue;

      const alert = evaluatePriceAlert({
        productId,
        title: work.title,
        previousPriceJpy,
        currentPriceJpy: work.priceJpy,
        targetPriceJpy: watch.target_price_jpy,
      });
      if (!alert) continue;

      statements.insertAlert.run({
        productId,
        ...alert,
        createdAt: capturedAt,
        sourceRunId: syncRunId,
        fingerprint: alertFingerprint(productId, alert),
      });
    }
  });

  const saveActivitiesTransaction = db.transaction(({ capturedAt = isoNow(), entries = [] } = {}) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const activityId = normalizeActivityId(entry.activityId);
      const title = String(entry.title ?? "").trim();
      const url = String(entry.url ?? "").trim();
      if (!activityId || !title || !url) continue;

      const existing = statements.getActivity.get(activityId);
      const benefitType = String(entry.benefitType || "info").trim() || "info";
      const firstSeenAt = existing?.first_seen_at || capturedAt;
      const details = normalizeActivityDetail(entry.details ?? entry.detail);
      const endsAt = entry.endsAt || details.detailEndsAt || null;
      statements.upsertActivity.run({
        activityId,
        source: String(entry.source || "dlsite").trim() || "dlsite",
        slot: String(entry.slot || "main").trim() || "main",
        title,
        url,
        imageUrl: entry.imageUrl || "",
        benefitType,
        benefitLabel: entry.benefitLabel || benefitType,
        benefitSummary: entry.benefitSummary || "",
        startsAt: entry.startsAt || null,
        endsAt,
        ...details,
        firstSeenAt,
        seenAt: capturedAt,
        rawJson: asJson(entry.raw ?? {}),
      });

      if (!existing) {
        statements.insertActivityAlert.run({
          activityId,
          type: "new_activity",
          message: `新活动：${title}`,
          createdAt: capturedAt,
          fingerprint: activityAlertFingerprint(activityId, "new_activity"),
        });
      }

      if (isActivityEndingSoon(endsAt, capturedAt)) {
        statements.insertActivityAlert.run({
          activityId,
          type: "ending_soon",
          message: `即将结束：${title}`,
          createdAt: capturedAt,
          fingerprint: activityAlertFingerprint(activityId, "ending_soon", endsAt),
        });
      }
    }
  });

  const saveAccountSyncTransaction = db.transaction(
    ({ displayName = "", pointsJpy = null, loginState = "active", raw = {}, lists = [], syncMode = "full" }) => {
      const existing = mapAccountSession(statements.getAccountSession.get(), { includeSecret: true });
      const syncedAt = isoNow();
      statements.upsertAccountSession.run({
        cookieHeader: existing.cookieHeader || "",
        displayName: displayName || existing.displayName || "",
        pointsJpy: toNonNegativeInteger(pointsJpy),
        loginState,
        lastSyncedAt: syncedAt,
        updatedAt: syncedAt,
        rawJson: asJson(raw),
      });

      const accountWatchProductIds = new Set();
      const mergedLists = new Map();

      for (const list of Array.isArray(lists) ? lists : []) {
        const listType = String(list.type || "wishlist").trim() || "wishlist";
        const existingList = mergedLists.get(listType) ?? {
          ...list,
          type: listType,
          items: [],
          watchlist: false,
          fullSync: list.fullSync !== false,
        };
        existingList.watchlist = existingList.watchlist || list.watchlist !== false;
        existingList.fullSync = existingList.fullSync && list.fullSync !== false;
        existingList.items.push(...(Array.isArray(list.items) ? list.items : []));
        mergedLists.set(listType, existingList);
      }

      const fullySyncedWatchTypes = new Set();

      for (const list of mergedLists.values()) {
        const listType = list.type;
        const works = list.items;
        const fullSync = list.fullSync !== false;
        if (fullSync) statements.deleteAccountWorksByType.run(listType);
        if (fullSync && list.watchlist !== false && ["wishlist", "favorite"].includes(listType)) {
          fullySyncedWatchTypes.add(listType);
        }

        for (const entry of works) {
          const productId = normalizeProductId(entry.productId);
          if (!productId) continue;

          const work = {
            productId,
            title: entry.title || productId,
            url: entry.url || `https://www.dlsite.com/${entry.floor || "home"}/work/=/product_id/${productId}.html`,
            imageUrl: entry.imageUrl || entry.image || "",
            circle: entry.circle || "",
            circleId: entry.circleId || "",
            floor: entry.floor || "home",
            ageCategory: entry.ageCategory || "",
            workType: entry.workType || "",
            categoryLabel: entry.categoryLabel || entry.category || "",
            genresJson: asJson(entry.genres ?? []),
            seenAt: syncedAt,
            priceJpy: toNullableInteger(entry.priceJpy),
            officialPriceJpy: toNullableInteger(entry.officialPriceJpy ?? entry.priceJpy),
            discountRate: toNullableInteger(entry.discountRate),
            sales: toNullableInteger(entry.sales),
            ratingCount: toNullableInteger(entry.ratingCount),
            rank: null,
            period: "",
            discountEndsAt: entry.discountEndsAt || null,
            rawJson: asJson(entry.raw ?? { source: `account_${listType}` }),
          };

          statements.upsertWork.run(work);
          statements.insertAccountWork.run({
            productId,
            listType,
            floor: work.floor,
            syncedAt,
            rawJson: asJson(entry.raw ?? { sourceUrl: entry.sourceUrl || "" }),
          });

          if (list.watchlist !== false && ["wishlist", "favorite"].includes(listType)) {
            accountWatchProductIds.add(productId);
            statements.addWatchlist.run({
              productId,
              targetPriceJpy: null,
              note: accountListLabel(listType),
              source: "dlsite_account",
              now: syncedAt,
            });
          }
        }
      }

      if (fullySyncedWatchTypes.size > 0) {
        statements.deleteAccountWatchlistNotIn.run({
          productIdsJson: asJson([...accountWatchProductIds]),
        });
      }
      statements.deleteOwnedAccountWatchlist.run();

      return getAccountProfile({ includeSecret: false });
    }
  );

  function createSyncRun({ scope, totalTargets }) {
    const startedAt = isoNow();
    const result = statements.createSyncRun.run({
      startedAt,
      scopeJson: asJson(scope),
      progressJson: asJson({ current: "", completedTargets: 0 }),
      totalTargets,
    });
    return getSyncRun(result.lastInsertRowid);
  }

  function updateSyncRun(id, patch = {}) {
    const existing = getSyncRun(id);
    if (!existing) return null;
    const status = patch.status ?? existing.status;
    statements.updateSyncRun.run({
      id,
      status,
      finishedAt: patch.finishedAt ?? (status === "running" ? null : isoNow()),
      progressJson: asJson(patch.progress ?? existing.progress),
      fetchedRankings: patch.fetchedRankings ?? existing.fetchedRankings,
      enrichedWorks: patch.enrichedWorks ?? existing.enrichedWorks,
      error: patch.error ?? existing.error,
    });
    return getSyncRun(id);
  }

  function getSyncRun(id) {
    return mapSyncRun(statements.getSyncRun.get(id));
  }

  function getLatestSyncRun() {
    return mapSyncRun(statements.latestSyncRun.get());
  }

  function createActivitySyncRun({ scope = {} } = {}) {
    const startedAt = isoNow();
    const result = statements.createActivitySyncRun.run({
      startedAt,
      scopeJson: asJson(scope),
    });
    return getActivitySyncRun(result.lastInsertRowid);
  }

  function updateActivitySyncRun(id, patch = {}) {
    const existing = getActivitySyncRun(id);
    if (!existing) return null;
    const status = patch.status ?? existing.status;
    statements.updateActivitySyncRun.run({
      id,
      status,
      finishedAt: patch.finishedAt ?? (status === "running" ? null : isoNow()),
      sourceCount: patch.sourceCount ?? existing.sourceCount,
      activityCount: patch.activityCount ?? existing.activityCount,
      error: patch.error ?? existing.error,
    });
    return getActivitySyncRun(id);
  }

  function getActivitySyncRun(id) {
    return mapActivitySyncRun(statements.getActivitySyncRun.get(id));
  }

  function getLatestActivitySyncRun() {
    return mapActivitySyncRun(statements.latestActivitySyncRun.get());
  }

  function saveSyncedProducts(payload) {
    saveProductsTransaction(payload);
  }

  function saveActivities(payload) {
    saveActivitiesTransaction(payload);
  }

  function activityDashboardStats() {
    const now = isoNow();
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const activeActivities = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM activities
         WHERE (starts_at IS NULL OR starts_at = '' OR starts_at <= ?)
           AND (ends_at IS NULL OR ends_at = '' OR ends_at > ?)`
      )
      .get(now, now)?.count ?? 0;
    const endingSoonActivities = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM activities
         WHERE ends_at IS NOT NULL AND ends_at <> ''
           AND ends_at > ?
           AND ends_at <= ?`
      )
      .get(now, soon)?.count ?? 0;
    const unreadActivityAlerts = statements.unreadActivityAlertCount.get()?.count ?? 0;
    return {
      activeActivities,
      endingSoonActivities,
      unreadActivityAlerts,
    };
  }

  function getFollowedActivityWorks(limit = 300) {
    return db
      .prepare(
        `SELECT
           w.*,
           wl.source AS watch_source,
           wl.target_price_jpy,
           wl.product_id IS NOT NULL AS is_watched,
           GROUP_CONCAT(DISTINCT aw.list_type) AS account_list_types,
           COALESCE(wl.updated_at, MAX(aw.synced_at), w.last_seen_at) AS followed_at
         FROM works w
         LEFT JOIN watchlist wl
           ON wl.product_id = w.product_id
         LEFT JOIN account_works aw
           ON aw.product_id = w.product_id
          AND aw.list_type IN ('wishlist', 'favorite')
         LEFT JOIN account_works owned
           ON owned.product_id = w.product_id
          AND owned.list_type = 'collection'
         WHERE owned.product_id IS NULL
           AND (wl.product_id IS NOT NULL OR aw.product_id IS NOT NULL)
         GROUP BY w.product_id
         ORDER BY followed_at DESC, w.product_id ASC
         LIMIT ?`
      )
      .all(Math.min(Math.max(Number(limit) || 300, 1), 500))
      .map(mapFollowedActivityWork);
  }

  function getActivityRows({ status = "active", benefit = "all", limit = 50, now = isoNow(), search = "" } = {}) {
    const soon = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const activeWhere =
      status === "all" || status === "unread"
        ? ""
        : "AND (starts_at IS NULL OR starts_at = '' OR starts_at <= @now) AND (ends_at IS NULL OR ends_at = '' OR ends_at > @now)";
    const endingSoonWhere =
      status === "endingSoon"
        ? "AND ends_at IS NOT NULL AND ends_at <> '' AND ends_at > @now AND ends_at <= @soon"
        : "";
    const unreadWhere =
      status === "unread"
        ? `AND EXISTS (
            SELECT 1
            FROM activity_alerts aa
            WHERE aa.activity_id = activities.activity_id
              AND aa.status = 'unread'
          )`
        : "";
    const benefitWhere = benefit === "all" ? "" : "AND benefit_type = @benefit";
    const normalizedSearch = String(search ?? "").trim().toLowerCase();
    const searchWhere = normalizedSearch
      ? `AND (
          LOWER(title) LIKE @search
          OR LOWER(benefit_summary) LIKE @search
          OR LOWER(detail_summary) LIKE @search
          OR LOWER(url) LIKE @search
        )`
      : "";
    return db
      .prepare(
        `SELECT *
         FROM activities
         WHERE 1 = 1
            ${activeWhere}
            ${endingSoonWhere}
            ${unreadWhere}
            ${benefitWhere}
            ${searchWhere}
          ORDER BY
            CASE WHEN ends_at IS NULL OR ends_at = '' THEN 1 ELSE 0 END ASC,
            ends_at ASC,
            first_seen_at DESC
         LIMIT @limit`
      )
      .all({
        now,
        soon,
        benefit,
        search: `%${normalizedSearch}%`,
        limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
      });
  }

  function getActivityWorkMatchSummary({ now = isoNow() } = {}) {
    const activities = getActivityRows({ status: "active", benefit: "all", limit: 100, now }).map((row) =>
      mapActivity(row, [])
    );
    const followedWorks = getFollowedActivityWorks();
    return buildActivityWorkMatchPayload({ activities, followedWorks }).summary;
  }

  function getActiveActivityBenefitCounts(now = isoNow()) {
    const rows = db
      .prepare(
        `SELECT benefit_type AS benefitType, COUNT(*) AS count
         FROM activities
         WHERE (starts_at IS NULL OR starts_at = '' OR starts_at <= @now)
           AND (ends_at IS NULL OR ends_at = '' OR ends_at > @now)
         GROUP BY benefit_type`
      )
      .all({ now });
    const counts = Object.fromEntries(rows.map((row) => [row.benefitType, row.count ?? 0]));
    counts.all = rows.reduce((total, row) => total + (row.count ?? 0), 0);
    return counts;
  }

  function getActivityPersonalSummary({ now = isoNow(), relatedWorkSummary = null } = {}) {
    const account = getAccountProfile();
    const activeBenefitCounts = getActiveActivityBenefitCounts(now);
    const syncState = !account.hasSession
      ? "disconnected"
      : account.isStale
        ? "stale"
        : account.lastSyncedAt
          ? "fresh"
          : "pending";
    const entrypoints = PERSONAL_ACTIVITY_BENEFITS
      .filter((benefit) => (activeBenefitCounts[benefit] ?? 0) > 0)
      .map((benefit) => ({
        benefit,
        count: activeBenefitCounts[benefit],
        label: PERSONAL_ACTIVITY_BENEFIT_COPY[benefit]?.label ?? benefit,
        description: PERSONAL_ACTIVITY_BENEFIT_COPY[benefit]?.description ?? "",
        priority: PERSONAL_ACTIVITY_BENEFIT_COPY[benefit]?.priority ?? 99,
        hasAccountContext: account.hasSession,
        pointsJpy: benefit === "point" ? account.pointsJpy : null,
        filter: { status: "active", benefit },
        claimsEntitlement: false,
      }));
    const highlights = buildActivityHighlights({ account, activeBenefitCounts, syncState, relatedWorkSummary });

    return {
      generatedAt: now,
      syncState,
      account: publicAccountSnapshot(account),
      activeBenefitCounts,
      highlights,
      entrypoints,
      relatedWorks: relatedWorkSummary,
      disclaimer: "Public DLsite campaign data only; coupon ownership and eligibility must be checked on DLsite.",
    };
  }

  function getDashboardSummary() {
    const workStats = db
      .prepare(
        `SELECT
          COUNT(*) AS totalWorks,
          SUM(CASE WHEN latest_price_jpy IS NOT NULL THEN 1 ELSE 0 END) AS pricedWorks,
          SUM(CASE WHEN latest_discount_rate IS NOT NULL AND latest_discount_rate > 0 THEN 1 ELSE 0 END) AS discountedWorks
        FROM works`
      )
      .get();
    const watchStats = db
      .prepare(
        `SELECT COUNT(*) AS watchedWorks
         FROM watchlist wl
         LEFT JOIN account_works owned
           ON owned.product_id = wl.product_id AND owned.list_type = 'collection'
         WHERE owned.product_id IS NULL`
      )
      .get();
    const alertStats = db.prepare("SELECT COUNT(*) AS unreadAlerts FROM alerts WHERE status = 'unread'").get();
    const latestRun = getLatestSyncRun();
    const notableDrops = getNotablePriceDrops(8);
    const activityStats = activityDashboardStats();
    const activityMatchStats = getActivityWorkMatchSummary();

    return {
      totalWorks: workStats.totalWorks ?? 0,
      pricedWorks: workStats.pricedWorks ?? 0,
      discountedWorks: workStats.discountedWorks ?? 0,
      watchedWorks: watchStats.watchedWorks ?? 0,
      unreadAlerts: alertStats.unreadAlerts ?? 0,
      ...activityStats,
      activityWorkMatches: activityMatchStats.totalMatches,
      activityMatchedWorks: activityMatchStats.matchedWorks,
      activityMatchedActivities: activityMatchStats.matchedActivities,
      activityFollowedWorks: activityMatchStats.followedWorks,
      latestRun,
      notableDrops,
    };
  }

  function getActivities({ status = "active", benefit = "all", limit = 50, search = "", relatedOnly = false } = {}) {
    const now = isoNow();
    const rows = getActivityRows({ status, benefit, limit, now, search });

    const baseItems = rows.map((row) => {
      const alerts = statements.getUnreadActivityAlertsForActivity.all(row.activity_id).map(mapActivityAlert);
      return mapActivity(row, alerts);
    });
    const followedWorks = getFollowedActivityWorks();
    const matchPayload = buildActivityWorkMatchPayload({ activities: baseItems, followedWorks });
    const items = baseItems.map((item) => ({
      ...item,
      relatedWorks: matchPayload.byActivity.get(item.activityId) ?? [],
    })).filter((item) => !relatedOnly || item.relatedWorks.length > 0);

    return {
      generatedAt: now,
      unreadCount: statements.unreadActivityAlertCount.get()?.count ?? 0,
      personalSummary: getActivityPersonalSummary({ now, relatedWorkSummary: matchPayload.summary }),
      activityMatches: matchPayload.summary,
      filters: {
        status,
        benefit,
        search,
        relatedOnly: Boolean(relatedOnly),
        limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
      },
      items,
    };
  }

  function getActivityAlertSummary({ limit = 3 } = {}) {
    const stats = activityDashboardStats();
    const typeCounts = {
      new_activity: 0,
      ending_soon: 0,
    };
    for (const row of statements.getUnreadActivityAlertTypeCounts.all()) {
      typeCounts[row.type] = row.count ?? 0;
    }

    return {
      generatedAt: isoNow(),
      activeActivities: stats.activeActivities,
      endingSoonActivities: stats.endingSoonActivities,
      unreadCount: stats.unreadActivityAlerts,
      unreadActivityAlerts: stats.unreadActivityAlerts,
      typeCounts,
      items: statements.getUnreadActivityAlertSummaryItems
        .all(Math.min(Math.max(Number(limit) || 3, 1), 10))
        .map(mapActivityAlertSummaryItem),
    };
  }

  function latestCapturedAt({ floor, period, category }) {
    return db
      .prepare(
        `SELECT captured_at
         FROM ranking_snapshots
         WHERE floor = ? AND period = ? AND category = ?
         ORDER BY captured_at DESC
         LIMIT 1`
      )
      .get(floor, period, category)?.captured_at;
  }

  function getRankings({ floor = "home", period = "week", category = "all", limit = 100 } = {}) {
    const capturedAt = latestCapturedAt({ floor, period, category });
    if (!capturedAt) return { floor, period, category, capturedAt: null, items: [] };

    const rows = db
      .prepare(
        `WITH previous_prices AS (
           SELECT product_id, price_jpy
           FROM (
             SELECT
               product_id,
               price_jpy,
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY captured_at DESC, id DESC) AS rn
             FROM price_snapshots
             WHERE captured_at < ?
           )
           WHERE rn = 1
         )
         SELECT
           w.*,
           rs.rank,
           rs.sales AS snapshot_sales,
           rs.price_jpy AS snapshot_price_jpy,
           pp.price_jpy AS previous_price_jpy,
           CASE
             WHEN pp.price_jpy IS NOT NULL AND w.latest_price_jpy IS NOT NULL
             THEN w.latest_price_jpy - pp.price_jpy
           END AS price_delta_jpy,
           CASE
             WHEN pp.price_jpy IS NOT NULL AND pp.price_jpy > 0 AND w.latest_price_jpy IS NOT NULL
             THEN ROUND(((w.latest_price_jpy - pp.price_jpy) * 100.0) / pp.price_jpy, 1)
           END AS price_delta_percent,
           wl.product_id IS NOT NULL AS is_watched,
           wl.target_price_jpy
         FROM ranking_snapshots rs
         JOIN works w ON w.product_id = rs.product_id
         LEFT JOIN previous_prices pp ON pp.product_id = rs.product_id
         LEFT JOIN watchlist wl ON wl.product_id = rs.product_id
         WHERE rs.floor = ? AND rs.period = ? AND rs.category = ? AND rs.captured_at = ?
         ORDER BY rs.rank ASC
         LIMIT ?`
      )
      .all(capturedAt, floor, period, category, capturedAt, limit)
      .map((row) =>
        mapWorkRow({
          ...row,
          latest_rank: row.rank,
          latest_sales: row.snapshot_sales ?? row.latest_sales,
          latest_price_jpy: row.snapshot_price_jpy ?? row.latest_price_jpy,
        })
      );

    return { floor, period, category, capturedAt, items: rows };
  }

  function getWorkHistory(productId) {
    const normalized = normalizeProductId(productId);
    const work = mapWorkRow(db.prepare("SELECT * FROM works WHERE product_id = ?").get(normalized));
    if (!work) return null;
    const prices = db
      .prepare(
        `SELECT price_jpy AS priceJpy, official_price_jpy AS officialPriceJpy,
                discount_rate AS discountRate, sales, captured_at AS capturedAt
         FROM price_snapshots
         WHERE product_id = ?
         ORDER BY captured_at ASC, id ASC`
      )
      .all(normalized);
    const ranks = db
      .prepare(
        `SELECT floor, period, category, rank, sales, price_jpy AS priceJpy,
                captured_at AS capturedAt, source_url AS sourceUrl
         FROM ranking_snapshots
         WHERE product_id = ?
         ORDER BY captured_at ASC, id ASC`
      )
      .all(normalized);
    return { work, prices, ranks };
  }

  function addWatchlist({ productId, targetPriceJpy = null, note = "" }) {
    const normalized = normalizeProductId(productId);
    const normalizedTargetPrice = toNullablePrice(targetPriceJpy, "targetPriceJpy");
    const exists = db.prepare("SELECT product_id FROM works WHERE product_id = ?").get(normalized);
    if (!exists) {
      const error = new Error("作品尚未同步，无法加入关注。");
      error.statusCode = 404;
      throw error;
    }
    if (statements.getOwnedAccountWork.get(normalized)) {
      const error = new Error("已购作品无需加入价格关注。");
      error.statusCode = 400;
      throw error;
    }

    const now = isoNow();
    statements.addWatchlist.run({
      productId: normalized,
      targetPriceJpy: normalizedTargetPrice,
      note: String(note ?? "").trim(),
      source: "local",
      now,
    });
    return getWatchlist().find((item) => item.productId === normalized) ?? null;
  }

  function importWorkToWatchlist({ work, targetPriceJpy = null, note = "" }) {
    const normalizedTargetPrice = toNullablePrice(targetPriceJpy, "targetPriceJpy");
    const productId = saveImportedWorkTransaction(work ?? {});
    return addWatchlist({ productId, targetPriceJpy: normalizedTargetPrice, note });
  }

  function deleteWatchlist(productId) {
    const result = statements.deleteWatchlist.run(normalizeProductId(productId));
    return result.changes > 0;
  }

  function getWatchlist() {
    return db
      .prepare(
        `SELECT wl.*, w.title, w.url, w.image_url, w.circle, w.latest_price_jpy,
                w.latest_official_price_jpy, w.latest_discount_rate
         FROM watchlist wl
         JOIN works w ON w.product_id = wl.product_id
         LEFT JOIN account_works owned
           ON owned.product_id = wl.product_id AND owned.list_type = 'collection'
         WHERE owned.product_id IS NULL
         ORDER BY wl.updated_at DESC`
      )
      .all()
      .map(mapWatchlist);
  }

  function getAlerts({ status = "unread", limit = 50 } = {}) {
    const sql =
      status === "all"
        ? `SELECT a.*, w.title, w.image_url, w.circle
           FROM alerts a JOIN works w ON w.product_id = a.product_id
           ORDER BY a.created_at DESC LIMIT ?`
        : `SELECT a.*, w.title, w.image_url, w.circle
           FROM alerts a JOIN works w ON w.product_id = a.product_id
           WHERE a.status = 'unread'
           ORDER BY a.created_at DESC LIMIT ?`;
    return db.prepare(sql).all(limit).map(mapAlert);
  }

  function markAlertRead(id) {
    const result = statements.markAlertRead.run(Number(id));
    return result.changes > 0;
  }

  function markActivityAlertRead(id) {
    const result = statements.markActivityAlertRead.run(Number(id));
    return result.changes > 0;
  }

  function saveAccountSession({ cookieHeader, displayName = "", pointsJpy = null, loginState = "pending", raw = {} }) {
    const now = isoNow();
    const existing = mapAccountSession(statements.getAccountSession.get(), { includeSecret: true });
    statements.upsertAccountSession.run({
      cookieHeader: String(cookieHeader ?? existing.cookieHeader ?? "").trim(),
      displayName: displayName || existing.displayName || "",
      pointsJpy: toNonNegativeInteger(pointsJpy ?? existing.pointsJpy),
      loginState,
      lastSyncedAt: existing.lastSyncedAt ?? null,
      updatedAt: now,
      rawJson: asJson(raw ?? existing.raw ?? {}),
    });
    return getAccountProfile({ includeSecret: false });
  }

  function saveAccountSyncResult(payload) {
    return saveAccountSyncTransaction(payload ?? {});
  }

  function getAccountProfile({ includeSecret = false } = {}) {
    const session = mapAccountSession(statements.getAccountSession.get(), { includeSecret });
    const listRows = db
      .prepare(
        `SELECT aw.list_type AS type, COUNT(*) AS count, MAX(aw.synced_at) AS syncedAt
         FROM account_works aw
         LEFT JOIN account_works owned
           ON owned.product_id = aw.product_id AND owned.list_type = 'collection'
         WHERE aw.list_type = 'collection' OR owned.product_id IS NULL
         GROUP BY aw.list_type
         ORDER BY aw.list_type ASC`
      )
      .all();

    return {
      ...session,
      lists: Object.fromEntries(
        listRows.map((row) => [row.type, { count: row.count ?? 0, syncedAt: row.syncedAt }])
      ),
    };
  }

  function getAccountSyncState() {
    const rows = db
      .prepare(
        `SELECT product_id, list_type, floor, synced_at
         FROM account_works
         ORDER BY list_type ASC, synced_at DESC, product_id ASC`
      )
      .all();
    const lists = {};

    for (const row of rows) {
      const type = row.list_type || "wishlist";
      const list = lists[type] ?? {
        count: 0,
        productIds: [],
        syncedAt: row.synced_at,
        floors: {},
      };
      list.count += 1;
      list.productIds.push(row.product_id);
      if (!list.syncedAt || row.synced_at > list.syncedAt) list.syncedAt = row.synced_at;
      if (row.floor) list.floors[row.floor] = (list.floors[row.floor] ?? 0) + 1;
      lists[type] = list;
    }

    return {
      generatedAt: isoNow(),
      lists,
    };
  }

  function clearAccountSession() {
    const clearTransaction = db.transaction(() => {
      statements.deleteAccountWatchlist.run();
      statements.deleteAllAccountWorks.run();
      statements.clearAccountSession.run();
    });
    clearTransaction();
    return getAccountProfile();
  }

  function getAffordableRecommendations({ budgetJpy = null, limit = 10, excludeCollection = true } = {}) {
    const account = getAccountProfile();
    const budget = toNonNegativeInteger(budgetJpy ?? account.pointsJpy);
    if (!budget) {
      return {
        budgetJpy: budget,
        items: [],
        algorithm: "popular-first-affordable-value",
      };
    }

    const rows = db
      .prepare(
        `WITH latest_rankings AS (
           SELECT
             rs.*,
             ROW_NUMBER() OVER (
               PARTITION BY rs.product_id, rs.floor, rs.period, rs.category
               ORDER BY rs.captured_at DESC, rs.id DESC
             ) AS rn
           FROM ranking_snapshots rs
         )
         SELECT
           w.*,
           lr.rank AS snapshot_rank,
           lr.floor AS snapshot_floor,
           lr.period AS snapshot_period,
           lr.category AS snapshot_category,
           owned.product_id IS NOT NULL AS is_owned
         FROM latest_rankings lr
         JOIN works w ON w.product_id = lr.product_id
         LEFT JOIN account_works owned
           ON owned.product_id = w.product_id AND owned.list_type = 'collection'
         WHERE lr.rn = 1
           AND w.latest_price_jpy IS NOT NULL
           AND w.latest_price_jpy <= ?
           AND (? = 0 OR owned.product_id IS NULL)`
      )
      .all(budget, excludeCollection ? 1 : 0);

    const periodWeights = { day: 1, week: 0.96, month: 0.92 };
    const categoryWeights = { all: 1, voice: 0.98, game: 0.96, manga: 0.96 };
    const byProduct = new Map();

    for (const row of rows) {
      const productId = row.product_id;
      const rank = toNullableInteger(row.snapshot_rank);
      if (!rank) continue;

      const rankWeight =
        (periodWeights[row.snapshot_period] ?? 0.9) * (categoryWeights[row.snapshot_category] ?? 0.94);
      const rankSignal = Math.max(0, 101 - rank) * rankWeight;
      const existing = byProduct.get(productId);
      const base = existing ?? {
        ...mapWorkRow(row),
        latestPriceJpy: row.latest_price_jpy,
        bestRank: rank,
        bestRankWeight: rankWeight,
        bestRankSignal: rankSignal,
        bestRankLabel: `${row.snapshot_floor}/${row.snapshot_period}/${row.snapshot_category}`,
      };

      if (rankSignal > base.bestRankSignal) {
        base.bestRank = rank;
        base.bestRankWeight = rankWeight;
        base.bestRankSignal = rankSignal;
        base.bestRankLabel = `${row.snapshot_floor}/${row.snapshot_period}/${row.snapshot_category}`;
      }
      byProduct.set(productId, base);
    }

    const scored = [...byProduct.values()]
      .map((item) => scoreRecommendation(item, budget))
      .filter((item) => {
        const popularEnough = item.popularityScore >= 20;
        const valueEnough =
          item.valueScore >= 12 ||
          (item.latestDiscountRate ?? 0) >= 10 ||
          item.latestPriceJpy <= Math.floor(budget * 0.85);
        return popularEnough && valueEnough;
      })
      .sort((a, b) => b.recommendationScore - a.recommendationScore || a.bestRank - b.bestRank)
      .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 30))
      .map((item) => ({
        ...item,
        reasons: recommendationReason(item),
      }));

    return {
      budgetJpy: budget,
      items: scored,
      algorithm: "eligible(price <= points) -> popular rank/sales filter -> 78% popularity + 22% value",
    };
  }

  function getNotablePriceDrops(limit = 8) {
    return db
      .prepare(
        `WITH latest AS (
           SELECT product_id, price_jpy, captured_at,
                  ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY captured_at DESC, id DESC) AS rn
           FROM price_snapshots
         ),
         previous AS (
           SELECT product_id, price_jpy,
                  ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY captured_at DESC, id DESC) AS rn
           FROM price_snapshots
           WHERE product_id IN (SELECT product_id FROM latest WHERE rn = 1)
             AND captured_at < (SELECT l.captured_at FROM latest l WHERE l.product_id = price_snapshots.product_id AND l.rn = 1)
         )
         SELECT w.*, previous.price_jpy AS previous_price_jpy,
                latest.price_jpy - previous.price_jpy AS price_delta_jpy,
                ROUND(((latest.price_jpy - previous.price_jpy) * 100.0) / previous.price_jpy, 1) AS price_delta_percent,
                wl.product_id IS NOT NULL AS is_watched,
                wl.target_price_jpy
         FROM latest
         JOIN previous ON previous.product_id = latest.product_id AND previous.rn = 1
         JOIN works w ON w.product_id = latest.product_id
         LEFT JOIN watchlist wl ON wl.product_id = w.product_id
         LEFT JOIN account_works owned
           ON owned.product_id = w.product_id AND owned.list_type = 'collection'
         WHERE latest.rn = 1
           AND latest.price_jpy IS NOT NULL
           AND previous.price_jpy IS NOT NULL
           AND latest.price_jpy < previous.price_jpy
           AND owned.product_id IS NULL
         ORDER BY (previous.price_jpy - latest.price_jpy) DESC
         LIMIT ?`
      )
      .all(limit)
      .map(mapWorkRow);
  }

  function close() {
    db.close();
  }

  return {
    db,
    createSyncRun,
    updateSyncRun,
    getSyncRun,
    getLatestSyncRun,
    createActivitySyncRun,
    updateActivitySyncRun,
    getActivitySyncRun,
    getLatestActivitySyncRun,
    saveSyncedProducts,
    saveActivities,
    getDashboardSummary,
    getActivities,
    getActivityAlertSummary,
    getActivityPersonalSummary,
    getRankings,
    getWorkHistory,
    addWatchlist,
    importWorkToWatchlist,
    deleteWatchlist,
    getWatchlist,
    getAlerts,
    markAlertRead,
    markActivityAlertRead,
    saveAccountSession,
    saveAccountSyncResult,
    getAccountProfile,
    getAccountSyncState,
    clearAccountSession,
    getAffordableRecommendations,
    close,
  };
}

export const ACCOUNT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const PERSONAL_ACTIVITY_BENEFITS = ["point", "coupon", "discount"];
export const ACTIVITY_WORK_MATCH_MIN_SCORE = 40;
export const PERSONAL_ACTIVITY_BENEFIT_COPY = {
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
export const FOLLOW_SOURCE_COPY = {
  watchlist: "本地关注",
  wishlist: "DLsite 愿望单",
  favorite: "DLsite 收藏",
  account_watchlist: "账号关注",
};
export const ACTIVITY_TERM_GROUPS = [
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

export function isoNow() {
  return new Date().toISOString();
}

export function asJson(value) {
  return JSON.stringify(value ?? null);
}

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toNullableBooleanInt(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === 1 || value === "1") return 1;
  if (value === 0 || value === "0") return 0;
  return null;
}

export function fromNullableBooleanInt(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number(value) === 1;
}

export function compactText(...values) {
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

export function normalizeComparableText(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function includesMeaningfulText(haystack, needle, minLength = 4) {
  const normalizedNeedle = normalizeComparableText(needle);
  if (normalizedNeedle.length < minLength) return false;
  return normalizeComparableText(haystack).includes(normalizedNeedle);
}

export function containsAnyTerm(text, terms) {
  return terms.some((term) => text.includes(String(term).toLowerCase()));
}

export function extractProductIds(text) {
  const ids = String(text ?? "").match(/\b(?:RJ|VJ|BJ)\d{5,}\b/gi) ?? [];
  return new Set(ids.map((id) => id.toUpperCase()));
}

export function toNullableInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

export function toNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

export function toNullablePrice(value, fieldName = "price") {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${fieldName} must be a non-negative number.`);
    error.statusCode = 400;
    throw error;
  }

  return Math.trunc(number);
}

export function normalizeProductId(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function accountListLabel(type) {
  const labels = {
    wishlist: "DLsite 关注",
    favorite: "DLsite 收藏",
    collection: "DLsite 已购",
  };
  return labels[type] ?? type;
}

export function mapWorkRow(row) {
  if (!row) return null;
  const latestPriceJpy = row.latest_price_jpy;
  const historicalLowPriceJpy = row.historical_low_price_jpy;
  const priceSnapshotCount = row.price_snapshot_count ?? 0;
  const isHistoricalLow =
    row.is_historical_low !== undefined
      ? Boolean(row.is_historical_low)
      : Number.isFinite(Number(latestPriceJpy)) &&
        Number.isFinite(Number(historicalLowPriceJpy)) &&
        Number(priceSnapshotCount) > 1 &&
        Number(latestPriceJpy) <= Number(historicalLowPriceJpy);
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
    latestPriceJpy,
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
    historicalLowPriceJpy,
    historicalLowCapturedAt: row.historical_low_captured_at,
    priceSnapshotCount,
    isHistoricalLow,
    discountEndsAt: row.discount_ends_at,
    isWatched: Boolean(row.is_watched),
    targetPriceJpy: row.target_price_jpy,
  };
}

export function mapSyncRun(row) {
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

export function mapAlert(row) {
  if (!row) return null;
  const currentPriceJpy = row.current_price_jpy;
  const historicalLowPriceJpy = row.historical_low_price_jpy;
  const priceSnapshotCount = row.price_snapshot_count ?? 0;
  const isHistoricalLow =
    row.is_historical_low !== undefined
      ? Boolean(row.is_historical_low)
      : Number.isFinite(Number(currentPriceJpy)) &&
        Number.isFinite(Number(historicalLowPriceJpy)) &&
        Number(priceSnapshotCount) > 1 &&
        Number(currentPriceJpy) <= Number(historicalLowPriceJpy);
  return {
    id: row.id,
    productId: row.product_id,
    type: row.type,
    previousPriceJpy: row.previous_price_jpy,
    currentPriceJpy,
    targetPriceJpy: row.target_price_jpy,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    sourceRunId: row.source_run_id,
    title: row.title,
    imageUrl: row.image_url,
    circle: row.circle,
    historicalLowPriceJpy,
    historicalLowCapturedAt: row.historical_low_captured_at,
    priceSnapshotCount,
    isHistoricalLow,
  };
}

export function mapActivitySyncRun(row) {
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

export function mapActivityAlert(row) {
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

export function mapActivityAlertSummaryItem(row) {
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

export function mapActivityDetail(row) {
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

export function mapActivity(row, alerts = []) {
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

export function mapWatchlist(row) {
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

export function mapFollowedActivityWork(row) {
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

export function hasPriceDiscount(work) {
  if ((work.latestDiscountRate ?? 0) > 0) return true;
  return (
    Number.isFinite(Number(work.latestPriceJpy)) &&
    Number.isFinite(Number(work.latestOfficialPriceJpy)) &&
    Number(work.latestOfficialPriceJpy) > Number(work.latestPriceJpy)
  );
}

export function workSearchText(work) {
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

export function activitySearchText(activity) {
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

export function priceText(work) {
  if (!Number.isFinite(Number(work.latestPriceJpy))) return "";
  return `${Number(work.latestPriceJpy).toLocaleString("ja-JP")}円`;
}

export function publicWorkMatch(work, { score, confidence, reasons }) {
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

export function scoreActivityWorkMatch(activity, work) {
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

export function buildActivityWorkMatchPayload({ activities, followedWorks }) {
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

export function normalizeActivityId(value) {
  return String(value ?? "").trim();
}

export function normalizeActivityDetail(value) {
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

export function isActivityEndingSoon(endsAt, nowIsoValue) {
  if (!endsAt) return false;
  const endMs = new Date(endsAt).getTime();
  const nowMs = new Date(nowIsoValue).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) return false;
  const remainingMs = endMs - nowMs;
  return remainingMs > 0 && remainingMs <= 24 * 60 * 60 * 1000;
}

export function activityAlertFingerprint(activityId, type, endsAt = "") {
  return `activity:${activityId}:${type}:${endsAt || "open"}`;
}

export function accountFreshness(lastSyncedAt, hasSession = false) {
  const syncedAtMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : NaN;
  const syncAgeMs = Number.isFinite(syncedAtMs) ? Math.max(0, Date.now() - syncedAtMs) : null;
  return {
    syncAgeMs,
    staleAfterMs: ACCOUNT_STALE_AFTER_MS,
    isStale: hasSession && (syncAgeMs === null || syncAgeMs > ACCOUNT_STALE_AFTER_MS),
  };
}

export function mapAccountSession(row, { includeSecret = false } = {}) {
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

export function publicAccountSnapshot(account) {
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

export function formatPointBalance(pointsJpy) {
  const points = toNonNegativeInteger(pointsJpy);
  return Number.isFinite(points) ? `${points.toLocaleString("ja-JP")} pt` : "Not synced";
}

export function describeAccountSync(syncState, account) {
  if (syncState === "fresh") return `Synced ${account.lastSyncedAt}`;
  if (syncState === "stale") return `Stale since ${account.lastSyncedAt || account.updatedAt || "unknown"}`;
  if (syncState === "pending") return "Connected; waiting for first account sync";
  return "Connect DLsite account for personal context";
}

export function buildActivityHighlights({ account, activeBenefitCounts, syncState, relatedWorkSummary = null }) {
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

export function recommendationReason(item) {
  const reasons = [];
  if (item.bestRank) reasons.push(`${item.bestRankLabel} #${item.bestRank}`);
  if (item.latestDiscountRate) reasons.push(`${item.latestDiscountRate}%OFF`);
  if (item.officialDiscountRate && item.officialDiscountRate > (item.latestDiscountRate ?? 0)) {
    reasons.push(`约 ${item.officialDiscountRate}%OFF`);
  }
  if (Number.isFinite(item.leftoverJpy)) reasons.push(`剩余 ${item.leftoverJpy.toLocaleString("ja-JP")}円`);
  return reasons;
}

export function scoreRecommendation(item, budgetJpy) {
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

import {
  activityAlertFingerprint,
  asJson,
  buildActivityHighlights,
  buildActivityWorkMatchPayload,
  isActivityEndingSoon,
  isoNow,
  mapActivity,
  mapActivityAlert,
  mapActivityAlertSummaryItem,
  mapActivitySyncRun,
  mapFollowedActivityWork,
  normalizeActivityDetail,
  normalizeActivityId,
  PERSONAL_ACTIVITY_BENEFITS,
  PERSONAL_ACTIVITY_BENEFIT_COPY,
  publicAccountSnapshot,
} from "./utils.js";

export function createActivitiesRepository({ db, statements, getAccountProfile }) {
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

  function markActivityAlertRead(id) {
    const result = statements.markActivityAlertRead.run(Number(id));
    return result.changes > 0;
  }

  return {
    createActivitySyncRun,
    updateActivitySyncRun,
    getActivitySyncRun,
    getLatestActivitySyncRun,
    saveActivities,
    getActivityDashboardStats: activityDashboardStats,
    getActivityWorkMatchSummary,
    getActivities,
    getActivityAlertSummary,
    getActivityPersonalSummary,
    markActivityAlertRead,
  };
}

export function prepareMonitorStatements(db) {
  return {
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
}

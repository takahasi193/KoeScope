import {
  asJson,
  isoNow,
  mapSyncRun,
  mapWorkRow,
} from "./utils.js";

export function createRankingsRepository({ db, statements }) {
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
           (SELECT MIN(ps.price_jpy)
              FROM price_snapshots ps
             WHERE ps.product_id = rs.product_id
               AND ps.price_jpy IS NOT NULL) AS historical_low_price_jpy,
           (SELECT ps.captured_at
              FROM price_snapshots ps
             WHERE ps.product_id = rs.product_id
               AND ps.price_jpy IS NOT NULL
             ORDER BY ps.price_jpy ASC, ps.captured_at DESC, ps.id DESC
             LIMIT 1) AS historical_low_captured_at,
           (SELECT COUNT(ps.price_jpy)
              FROM price_snapshots ps
             WHERE ps.product_id = rs.product_id
               AND ps.price_jpy IS NOT NULL) AS price_snapshot_count,
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

  return {
    createSyncRun,
    updateSyncRun,
    getSyncRun,
    getLatestSyncRun,
    getRankings,
  };
}

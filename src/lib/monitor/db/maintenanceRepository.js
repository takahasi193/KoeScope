const DEFAULT_RETENTION_DAYS = 365;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_VACUUM_THRESHOLD = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeRetentionDays(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_RETENTION_DAYS;
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days) || days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS) {
    const error = new Error(`retentionDays must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}.`);
    error.statusCode = 400;
    throw error;
  }
  return days;
}

function normalizeNow(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    const error = new Error("now must be a valid date.");
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizeSnapshotCleanupOptions(options = {}) {
  const retentionDays = normalizeRetentionDays(options.retentionDays);
  const now = normalizeNow(options.now);
  const cutoffAt = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  const vacuumThreshold = Math.max(0, Math.trunc(Number(options.vacuumThreshold) || DEFAULT_VACUUM_THRESHOLD));
  return {
    dryRun: options.dryRun !== false,
    retentionDays,
    cutoffAt,
    vacuumThreshold,
  };
}

const priceProtectedCte = `
  latest_prices AS (
    SELECT id
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY captured_at DESC, id DESC) AS rn
      FROM price_snapshots
    )
    WHERE rn = 1
  ),
  historical_low_prices AS (
    SELECT ps.id
    FROM price_snapshots ps
    JOIN (
      SELECT product_id, MIN(price_jpy) AS low_price_jpy
      FROM price_snapshots
      WHERE price_jpy IS NOT NULL
      GROUP BY product_id
    ) lows
      ON lows.product_id = ps.product_id
     AND lows.low_price_jpy = ps.price_jpy
    WHERE ps.price_jpy IS NOT NULL
  ),
  alert_source_runs AS (
    SELECT DISTINCT source_run_id
    FROM alerts
    WHERE source_run_id IS NOT NULL
  ),
  alert_prices AS (
    SELECT id
    FROM price_snapshots
    WHERE sync_run_id IN (SELECT source_run_id FROM alert_source_runs)
  ),
  protected_prices AS (
    SELECT id FROM latest_prices
    UNION
    SELECT id FROM historical_low_prices
    UNION
    SELECT id FROM alert_prices
  )
`;

const rankingProtectedCte = `
  latest_rankings AS (
    SELECT id
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY product_id, floor, period, category
               ORDER BY captured_at DESC, id DESC
             ) AS rn
      FROM ranking_snapshots
    )
    WHERE rn = 1
  ),
  alert_source_runs AS (
    SELECT DISTINCT source_run_id
    FROM alerts
    WHERE source_run_id IS NOT NULL
  ),
  alert_rankings AS (
    SELECT id
    FROM ranking_snapshots
    WHERE sync_run_id IN (SELECT source_run_id FROM alert_source_runs)
  ),
  protected_rankings AS (
    SELECT id FROM latest_rankings
    UNION
    SELECT id FROM alert_rankings
  )
`;

function countPlan(db, cutoffAt) {
  const priceSnapshots = db
    .prepare(
      `WITH
       ${priceProtectedCte},
       older_prices AS (
         SELECT id
         FROM price_snapshots
         WHERE captured_at < @cutoffAt
       )
       SELECT
         COUNT(*) AS olderThanCutoff,
         SUM(CASE WHEN protected_prices.id IS NOT NULL THEN 1 ELSE 0 END) AS protectedOlder,
         SUM(CASE WHEN protected_prices.id IS NULL THEN 1 ELSE 0 END) AS deletable
       FROM older_prices
       LEFT JOIN protected_prices
         ON protected_prices.id = older_prices.id`
    )
    .get({ cutoffAt });

  const rankingSnapshots = db
    .prepare(
      `WITH
       ${rankingProtectedCte},
       older_rankings AS (
         SELECT id
         FROM ranking_snapshots
         WHERE captured_at < @cutoffAt
       )
       SELECT
         COUNT(*) AS olderThanCutoff,
         SUM(CASE WHEN protected_rankings.id IS NOT NULL THEN 1 ELSE 0 END) AS protectedOlder,
         SUM(CASE WHEN protected_rankings.id IS NULL THEN 1 ELSE 0 END) AS deletable
       FROM older_rankings
       LEFT JOIN protected_rankings
         ON protected_rankings.id = older_rankings.id`
    )
    .get({ cutoffAt });

  return {
    priceSnapshots: {
      olderThanCutoff: priceSnapshots.olderThanCutoff ?? 0,
      protectedOlder: priceSnapshots.protectedOlder ?? 0,
      deletable: priceSnapshots.deletable ?? 0,
    },
    rankingSnapshots: {
      olderThanCutoff: rankingSnapshots.olderThanCutoff ?? 0,
      protectedOlder: rankingSnapshots.protectedOlder ?? 0,
      deletable: rankingSnapshots.deletable ?? 0,
    },
  };
}

function executeDeletes(db, cutoffAt) {
  const transaction = db.transaction(() => {
    const rankingResult = db
      .prepare(
        `WITH
         ${rankingProtectedCte},
         deletable_rankings AS (
           SELECT rs.id
           FROM ranking_snapshots rs
           LEFT JOIN protected_rankings
             ON protected_rankings.id = rs.id
           WHERE rs.captured_at < @cutoffAt
             AND protected_rankings.id IS NULL
         )
         DELETE FROM ranking_snapshots
         WHERE id IN (SELECT id FROM deletable_rankings)`
      )
      .run({ cutoffAt });

    const priceResult = db
      .prepare(
        `WITH
         ${priceProtectedCte},
         deletable_prices AS (
           SELECT ps.id
           FROM price_snapshots ps
           LEFT JOIN protected_prices
             ON protected_prices.id = ps.id
           WHERE ps.captured_at < @cutoffAt
             AND protected_prices.id IS NULL
         )
         DELETE FROM price_snapshots
         WHERE id IN (SELECT id FROM deletable_prices)`
      )
      .run({ cutoffAt });

    return {
      priceDeleted: priceResult.changes,
      rankingDeleted: rankingResult.changes,
    };
  });

  return transaction();
}

function optimizeDatabase(db, totalDeleted, vacuumThreshold) {
  const optimization = {
    pragmaOptimize: false,
    vacuum: false,
    vacuumReason: "not_needed",
    freelistBefore: 0,
    pageCountBefore: 0,
  };

  db.pragma("optimize");
  optimization.pragmaOptimize = true;
  optimization.freelistBefore = db.pragma("freelist_count", { simple: true }) ?? 0;
  optimization.pageCountBefore = db.pragma("page_count", { simple: true }) ?? 0;

  if (totalDeleted < vacuumThreshold) {
    optimization.vacuumReason = "below_delete_threshold";
    return optimization;
  }
  if (optimization.freelistBefore <= 0) {
    optimization.vacuumReason = "no_free_pages";
    return optimization;
  }

  db.exec("VACUUM");
  optimization.vacuum = true;
  optimization.vacuumReason = "completed";
  return optimization;
}

function buildPayload(options, plan, { priceDeleted = 0, rankingDeleted = 0, optimization = null } = {}) {
  const priceSnapshots = {
    ...plan.priceSnapshots,
    deleted: priceDeleted,
  };
  const rankingSnapshots = {
    ...plan.rankingSnapshots,
    deleted: rankingDeleted,
  };
  return {
    dryRun: options.dryRun,
    retentionDays: options.retentionDays,
    cutoffAt: options.cutoffAt,
    priceSnapshots,
    rankingSnapshots,
    totalDeletable: priceSnapshots.deletable + rankingSnapshots.deletable,
    totalDeleted: priceDeleted + rankingDeleted,
    optimization: optimization ?? {
      pragmaOptimize: false,
      vacuum: false,
      vacuumReason: "dry_run",
      freelistBefore: null,
      pageCountBefore: null,
    },
  };
}

export function createMaintenanceRepository({ db }) {
  function runSnapshotCleanup(rawOptions = {}) {
    const options = normalizeSnapshotCleanupOptions(rawOptions);
    const plan = countPlan(db, options.cutoffAt);

    if (options.dryRun) {
      return buildPayload(options, plan);
    }

    const { priceDeleted, rankingDeleted } = executeDeletes(db, options.cutoffAt);
    const totalDeleted = priceDeleted + rankingDeleted;
    const optimization = optimizeDatabase(db, totalDeleted, options.vacuumThreshold);
    return buildPayload(options, plan, { priceDeleted, rankingDeleted, optimization });
  }

  return {
    runSnapshotCleanup,
  };
}

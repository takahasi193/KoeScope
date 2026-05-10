import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { alertFingerprint, evaluatePriceAlert } from "./alerts.js";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "dlsite-monitor.sqlite");
const ACCOUNT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

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

  function saveSyncedProducts(payload) {
    saveProductsTransaction(payload);
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

    return {
      totalWorks: workStats.totalWorks ?? 0,
      pricedWorks: workStats.pricedWorks ?? 0,
      discountedWorks: workStats.discountedWorks ?? 0,
      watchedWorks: watchStats.watchedWorks ?? 0,
      unreadAlerts: alertStats.unreadAlerts ?? 0,
      latestRun,
      notableDrops,
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
    saveSyncedProducts,
    getDashboardSummary,
    getRankings,
    getWorkHistory,
    addWatchlist,
    importWorkToWatchlist,
    deleteWatchlist,
    getWatchlist,
    getAlerts,
    markAlertRead,
    saveAccountSession,
    saveAccountSyncResult,
    getAccountProfile,
    getAccountSyncState,
    clearAccountSession,
    getAffordableRecommendations,
    close,
  };
}

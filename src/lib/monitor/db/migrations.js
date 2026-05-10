export function migrateMonitorDatabase(db) {
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

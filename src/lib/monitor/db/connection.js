import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrateMonitorDatabase } from "./migrations.js";

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "dlsite-monitor.sqlite");

export function openMonitorDatabase({ dbPath = process.env.DLSITE_MONITOR_DB || DEFAULT_DB_PATH } = {}) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  migrateMonitorDatabase(db);
  return db;
}

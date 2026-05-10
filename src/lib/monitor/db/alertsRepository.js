import { mapAlert } from "./utils.js";

export function createAlertsRepository({ db, statements }) {
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

  function getUnreadAlertCount() {
    return db.prepare("SELECT COUNT(*) AS unreadAlerts FROM alerts WHERE status = 'unread'").get()?.unreadAlerts ?? 0;
  }

  return {
    getAlerts,
    markAlertRead,
    getUnreadAlertCount,
  };
}

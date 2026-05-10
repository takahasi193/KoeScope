import {
  isoNow,
  mapWatchlist,
  normalizeProductId,
  toNullablePrice,
} from "./utils.js";

export function createWatchlistRepository({ db, statements, saveImportedWork }) {
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
    const productId = saveImportedWork(work ?? {});
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

  function getWatchStats() {
    return db
      .prepare(
        `SELECT COUNT(*) AS watchedWorks
         FROM watchlist wl
         LEFT JOIN account_works owned
           ON owned.product_id = wl.product_id AND owned.list_type = 'collection'
         WHERE owned.product_id IS NULL`
      )
      .get();
  }

  return {
    addWatchlist,
    importWorkToWatchlist,
    deleteWatchlist,
    getWatchlist,
    getWatchStats,
  };
}

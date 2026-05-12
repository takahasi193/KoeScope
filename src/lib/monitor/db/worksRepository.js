import { alertFingerprint, evaluatePriceAlert } from "../alerts.js";
import {
  asJson,
  isoNow,
  mapWorkRow,
  normalizeProductId,
  toNullableInteger,
} from "./utils.js";

export function createWorksRepository({ db, statements }) {
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

  function saveImportedWork(entry) {
    return saveImportedWorkTransaction(entry ?? {});
  }

  function saveSyncedProducts(payload) {
    saveProductsTransaction(payload);
  }

  function getWorkStats() {
    return db
      .prepare(
        `SELECT
          COUNT(*) AS totalWorks,
          SUM(CASE WHEN latest_price_jpy IS NOT NULL THEN 1 ELSE 0 END) AS pricedWorks,
          SUM(CASE WHEN latest_discount_rate IS NOT NULL AND latest_discount_rate > 0 THEN 1 ELSE 0 END) AS discountedWorks
        FROM works`
      )
      .get();
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
    const priceSummary = db
      .prepare(
        `WITH priced AS (
           SELECT price_jpy, captured_at, id
           FROM price_snapshots
           WHERE product_id = ?
             AND price_jpy IS NOT NULL
         ),
         lowest AS (
           SELECT MIN(price_jpy) AS historicalLowPriceJpy,
                  COUNT(price_jpy) AS priceSnapshotCount
           FROM priced
         )
         SELECT lowest.historicalLowPriceJpy,
                (
                  SELECT captured_at
                  FROM priced
                  WHERE price_jpy = lowest.historicalLowPriceJpy
                  ORDER BY captured_at DESC, id DESC
                  LIMIT 1
                ) AS historicalLowCapturedAt,
                lowest.priceSnapshotCount
         FROM lowest`
      )
      .get(normalized);
    return { work, prices, ranks, priceSummary };
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
                (SELECT MIN(ps.price_jpy)
                   FROM price_snapshots ps
                  WHERE ps.product_id = latest.product_id
                    AND ps.price_jpy IS NOT NULL) AS historical_low_price_jpy,
                (SELECT ps.captured_at
                   FROM price_snapshots ps
                  WHERE ps.product_id = latest.product_id
                    AND ps.price_jpy IS NOT NULL
                  ORDER BY ps.price_jpy ASC, ps.captured_at DESC, ps.id DESC
                  LIMIT 1) AS historical_low_captured_at,
                (SELECT COUNT(ps.price_jpy)
                   FROM price_snapshots ps
                  WHERE ps.product_id = latest.product_id
                    AND ps.price_jpy IS NOT NULL) AS price_snapshot_count,
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

  return {
    saveImportedWork,
    saveSyncedProducts,
    getWorkStats,
    getWorkHistory,
    getNotablePriceDrops,
  };
}

import {
  accountListLabel,
  asJson,
  isoNow,
  mapAccountSession,
  mapWorkRow,
  normalizeProductId,
  recommendationReason,
  scoreRecommendation,
  toNonNegativeInteger,
  toNullableInteger,
} from "./utils.js";

export function createAccountRepository({ db, statements }) {
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

  return {
    saveAccountSession,
    saveAccountSyncResult,
    getAccountProfile,
    getAccountSyncState,
    clearAccountSession,
    getAffordableRecommendations,
  };
}

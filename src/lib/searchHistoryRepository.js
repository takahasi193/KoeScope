import { openMonitorDatabase } from "./monitor/db/connection.js";
import { asJson, mapJoinedWorkAnnotation, mapPersonSubscription, parseJson } from "./monitor/db/utils.js";
import { normalizeSpace } from "./cache.js";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_WORK_LIMIT = 100;
const MAX_WORK_LIMIT = 300;
const DEFAULT_SEARCH_CLEANUP_RETENTION_DAYS = 180;
const DEFAULT_SEARCH_CLEANUP_KEEP_PER_PERSON = 20;
const DEFAULT_SEARCH_CLEANUP_KEEP_ANONYMOUS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const TYPE_LABELS = {
  voice: "音声/ASMR",
  game: "游戏",
  manga: "漫画",
  cg: "CG/插画",
  video: "视频",
  other: "其他",
};

const AGE_LABELS = {
  general: "全年龄",
  r15: "R15",
  r18: "R18",
  unknown: "未知",
};

function clampLimit(value) {
  return Math.min(Math.max(Number(value) || DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
}

function clampWorkLimit(value) {
  return Math.min(Math.max(Number(value) || DEFAULT_WORK_LIMIT, 1), MAX_WORK_LIMIT);
}

function toNullableInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function toIsoTime(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function normalizeCleanupDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    const error = new Error("now must be a valid date.");
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizeNonNegativeInteger(value, fallback, name) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${name} must be a non-negative integer.`);
    error.statusCode = 400;
    throw error;
  }
  return number;
}

function normalizeSearchHistoryCleanupOptions(options = {}) {
  const retentionDays = normalizeNonNegativeInteger(
    options.retentionDays,
    DEFAULT_SEARCH_CLEANUP_RETENTION_DAYS,
    "retentionDays"
  );
  if (retentionDays < 1) {
    const error = new Error("retentionDays must be at least 1.");
    error.statusCode = 400;
    throw error;
  }
  const now = normalizeCleanupDate(options.now);
  const cutoffAt = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  return {
    dryRun: options.dryRun !== false,
    retentionDays,
    cutoffAt,
    keepPerPerson: normalizeNonNegativeInteger(
      options.keepPerPerson,
      DEFAULT_SEARCH_CLEANUP_KEEP_PER_PERSON,
      "keepPerPerson"
    ),
    keepAnonymous: normalizeNonNegativeInteger(
      options.keepAnonymous,
      DEFAULT_SEARCH_CLEANUP_KEEP_ANONYMOUS,
      "keepAnonymous"
    ),
  };
}

function normalizeAliases(value) {
  if (Array.isArray(value)) return value.map(normalizeSpace).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map(normalizeSpace)
    .filter(Boolean);
}

function compactPayload(payload) {
  const { items: _items, ...rest } = payload ?? {};
  return rest;
}

function progressIsComplete(status) {
  return status === "completed" || status === "failed";
}

function normalizeWorkSort(value) {
  return value === "latest" ? "latest" : "hot";
}

function normalizeWorkType(value) {
  return TYPE_LABELS[value] ? value : "all";
}

function normalizeWorkAge(value) {
  return AGE_LABELS[value] ? value : "all";
}

function aliasKey(value) {
  return normalizeSpace(value).normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function buildSummary(payload) {
  return {
    total: payload.total ?? payload.items?.length ?? 0,
    order: payload.order ?? payload.options?.order ?? "dl_d",
    orderLabel: payload.orderLabel ?? payload.options?.orderLabel ?? "",
    groups: payload.groups ?? {},
    ageGroups: payload.ageGroups ?? {},
    aliasSummaries: payload.aliasSummaries ?? [],
    truncated: Boolean(payload.truncated),
    truncatedAliases: payload.truncatedAliases ?? [],
    errors: payload.errors ?? [],
    timing: payload.timing ?? {},
    progress: payload.progress ?? {},
  };
}

function sessionParamsFromPayload(payload, metadata = {}) {
  const id = normalizeSpace(metadata.id ?? payload.progress?.jobId);
  if (!id) throw new Error("search session id is required");

  const person = payload.person ?? {};
  const options = payload.options ?? {};
  const summary = buildSummary(payload);
  const updatedAt = toIsoTime(metadata.updatedAt ?? payload.progress?.updatedAt);

  return {
    id,
    personId: toNullableInteger(person.id),
    keyword: normalizeSpace(payload.keyword),
    personName: normalizeSpace(person.name),
    aliasesJson: asJson(payload.searchedAliases ?? []),
    searchOrder: normalizeSpace(payload.order ?? options.order) || "dl_d",
    scope: normalizeSpace(options.scope) || "all",
    createdAt: toIsoTime(metadata.createdAt ?? updatedAt),
    updatedAt,
    status: normalizeSpace(payload.progress?.status) || "running",
    optionsJson: asJson(options),
    personJson: asJson(person),
    summaryJson: asJson(summary),
    rawJson: asJson(compactPayload(payload)),
  };
}

function resultParamsFromItem(sessionId, item, index, updatedAt) {
  return {
    sessionId,
    productId: normalizeSpace(item.productId).toUpperCase(),
    title: normalizeSpace(item.title),
    url: normalizeSpace(item.url),
    image: normalizeSpace(item.image ?? item.imageUrl),
    circle: normalizeSpace(item.circle),
    circleUrl: normalizeSpace(item.circleUrl),
    floor: normalizeSpace(item.floor),
    type: normalizeSpace(item.type),
    ageCategory: normalizeSpace(item.ageCategory),
    category: normalizeSpace(item.category),
    priceJpy: toNullableInteger(item.priceJpy),
    sales: toNullableInteger(item.sales),
    ratingCount: toNullableInteger(item.ratingCount),
    matchedAliasesJson: asJson(item.matchedAliases ?? []),
    matchedPagesJson: asJson(item.matchedPages ?? []),
    sourceOrder: toNullableInteger(item.sourceOrder),
    displayOrder: index,
    verificationJson: asJson(item.verification ?? {}),
    rawJson: asJson(item),
    updatedAt,
  };
}

function mapResultRow(row) {
  const raw = parseJson(row.raw_json, {});
  return {
    ...raw,
    productId: row.product_id,
    title: row.title,
    url: row.url,
    image: row.image,
    circle: row.circle,
    circleUrl: row.circle_url,
    floor: row.floor,
    type: row.type,
    ageCategory: row.age_category,
    category: row.category,
    priceJpy: row.price_jpy,
    sales: row.sales,
    ratingCount: row.rating_count,
    matchedAliases: parseJson(row.matched_aliases_json, []),
    matchedPages: parseJson(row.matched_pages_json, []),
    sourceOrder: row.source_order,
    verification: parseJson(row.verification_json, raw.verification ?? {}),
  };
}

function mapPersonWorkRow(row) {
  const item = mapResultRow(row);
  const annotation = mapJoinedWorkAnnotation(row);
  return {
    ...item,
    typeLabel: item.typeLabel ?? TYPE_LABELS[item.type] ?? item.type,
    ageLabel: item.ageLabel ?? AGE_LABELS[item.ageCategory] ?? AGE_LABELS.unknown,
    searchSessionId: row.session_id,
    searchUpdatedAt: row.session_updated_at,
    searchCreatedAt: row.session_created_at,
    isWatched: Boolean(row.watched_product_id),
    targetPriceJpy: row.target_price_jpy,
    watchNote: row.watch_note,
    watchSource: row.watch_source,
    watchUpdatedAt: row.watch_updated_at,
    annotation,
  };
}

function mapSessionRow(row) {
  const summary = parseJson(row.summary_json, {});
  const progress = {
    ...(summary.progress ?? {}),
    jobId: row.id,
    status: row.status,
    isComplete: progressIsComplete(row.status),
  };
  return {
    id: row.id,
    personId: row.person_id,
    keyword: row.keyword,
    personName: row.person_name,
    aliases: parseJson(row.aliases_json, []),
    order: row.search_order,
    orderLabel: summary.orderLabel ?? "",
    scope: row.scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    total: summary.total ?? 0,
    groups: summary.groups ?? {},
    ageGroups: summary.ageGroups ?? {},
    errors: summary.errors ?? [],
    truncatedAliases: summary.truncatedAliases ?? [],
    progress,
  };
}

function buildPayload(row, items) {
  const raw = parseJson(row.raw_json, {});
  const summary = parseJson(row.summary_json, {});
  const options = parseJson(row.options_json, {});
  const person = parseJson(row.person_json, {}) ?? {};
  const progress = {
    jobId: row.id,
    status: row.status,
    isComplete: progressIsComplete(row.status),
    ...(raw.progress ?? {}),
    ...(summary.progress ?? {}),
    jobId: row.id,
    status: row.status,
    isComplete: progressIsComplete(row.status),
  };

  return {
    ...raw,
    keyword: row.keyword,
    person: {
      ...person,
      id: row.person_id ?? person.id,
      name: row.person_name ?? person.name,
    },
    searchedAliases: parseJson(row.aliases_json, []),
    options,
    timing: summary.timing ?? raw.timing ?? {},
    progress,
    total: summary.total ?? items.length,
    items,
    order: summary.order ?? row.search_order,
    orderLabel: summary.orderLabel ?? options.orderLabel ?? "",
    groups: summary.groups ?? {},
    ageGroups: summary.ageGroups ?? {},
    aliasSummaries: summary.aliasSummaries ?? [],
    truncated: Boolean(summary.truncated),
    truncatedAliases: summary.truncatedAliases ?? [],
    errors: summary.errors ?? [],
  };
}

function collectAliases(sessionRows) {
  const aliases = new Map();

  function upsertAlias(value, patch = {}) {
    const key = aliasKey(value);
    if (!key) return;
    const existing = aliases.get(key) ?? {
      value: normalizeSpace(value),
      sources: [],
      sourceKeys: [],
      isPenName: false,
      searched: false,
    };

    existing.isPenName = existing.isPenName || Boolean(patch.isPenName);
    existing.searched = existing.searched || Boolean(patch.searched);
    existing.sources = [...new Set([...existing.sources, ...(patch.sources ?? [])])];
    existing.sourceKeys = [...new Set([...existing.sourceKeys, ...(patch.sourceKeys ?? [])])];
    aliases.set(key, existing);
  }

  for (const row of sessionRows) {
    const person = parseJson(row.person_json, {}) ?? {};
    upsertAlias(person.name, { sources: ["person:name"], sourceKeys: ["name"] });

    for (const alias of person.aliases ?? []) {
      upsertAlias(alias.value ?? alias, {
        sources: alias.sources ?? [],
        sourceKeys: alias.sourceKeys ?? [],
        isPenName: alias.isPenName,
      });
    }

    for (const alias of parseJson(row.aliases_json, [])) {
      upsertAlias(alias, { sources: ["search"], sourceKeys: ["search"], searched: true });
    }
  }

  return [...aliases.values()].sort((a, b) => {
    if (a.isPenName !== b.isPenName) return a.isPenName ? -1 : 1;
    if (a.searched !== b.searched) return a.searched ? -1 : 1;
    return a.value.localeCompare(b.value, "ja-JP");
  });
}

function buildPersonStats(works, sessionCount, latestSearchAt = null) {
  const totalSales = works.reduce((total, item) => total + (item.sales ?? 0), 0);
  return {
    totalWorks: works.length,
    voiceWorks: works.filter((item) => item.type === "voice").length,
    gameWorks: works.filter((item) => item.type === "game").length,
    mangaWorks: works.filter((item) => item.type === "manga").length,
    r18Works: works.filter((item) => item.ageCategory === "r18").length,
    generalWorks: works.filter((item) => item.ageCategory === "general").length,
    r15Works: works.filter((item) => item.ageCategory === "r15").length,
    unknownAgeWorks: works.filter((item) => !item.ageCategory || item.ageCategory === "unknown").length,
    watchedWorks: works.filter((item) => item.isWatched).length,
    totalSales,
    salesWorkCount: works.filter((item) => Number.isFinite(item.sales)).length,
    searchSessions: sessionCount,
    latestSearchAt,
  };
}

export function createSearchHistoryRepository(options = {}) {
  const db = options.db ?? openMonitorDatabase(options);

  const upsertSession = db.prepare(`
    INSERT INTO search_sessions (
      id, person_id, keyword, person_name, aliases_json, search_order, scope,
      created_at, updated_at, status, options_json, person_json, summary_json, raw_json
    )
    VALUES (
      @id, @personId, @keyword, @personName, @aliasesJson, @searchOrder, @scope,
      @createdAt, @updatedAt, @status, @optionsJson, @personJson, @summaryJson, @rawJson
    )
    ON CONFLICT(id) DO UPDATE SET
      person_id = excluded.person_id,
      keyword = excluded.keyword,
      person_name = excluded.person_name,
      aliases_json = excluded.aliases_json,
      search_order = excluded.search_order,
      scope = excluded.scope,
      updated_at = excluded.updated_at,
      status = excluded.status,
      options_json = excluded.options_json,
      person_json = excluded.person_json,
      summary_json = excluded.summary_json,
      raw_json = excluded.raw_json
  `);

  const upsertResult = db.prepare(`
    INSERT INTO search_session_results (
      search_session_id, product_id, title, url, image, circle, circle_url,
      floor, type, age_category, category, price_jpy, sales, rating_count,
      matched_aliases_json, matched_pages_json, source_order, display_order,
      verification_json, raw_json, updated_at
    )
    VALUES (
      @sessionId, @productId, @title, @url, @image, @circle, @circleUrl,
      @floor, @type, @ageCategory, @category, @priceJpy, @sales, @ratingCount,
      @matchedAliasesJson, @matchedPagesJson, @sourceOrder, @displayOrder,
      @verificationJson, @rawJson, @updatedAt
    )
    ON CONFLICT(search_session_id, product_id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      image = COALESCE(excluded.image, search_session_results.image),
      circle = COALESCE(excluded.circle, search_session_results.circle),
      circle_url = COALESCE(excluded.circle_url, search_session_results.circle_url),
      floor = COALESCE(excluded.floor, search_session_results.floor),
      type = COALESCE(excluded.type, search_session_results.type),
      age_category = COALESCE(excluded.age_category, search_session_results.age_category),
      category = COALESCE(excluded.category, search_session_results.category),
      price_jpy = COALESCE(excluded.price_jpy, search_session_results.price_jpy),
      sales = COALESCE(excluded.sales, search_session_results.sales),
      rating_count = COALESCE(excluded.rating_count, search_session_results.rating_count),
      matched_aliases_json = excluded.matched_aliases_json,
      matched_pages_json = excluded.matched_pages_json,
      source_order = excluded.source_order,
      display_order = excluded.display_order,
      verification_json = excluded.verification_json,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);

  const saveTransaction = db.transaction((payload, metadata) => {
    const session = sessionParamsFromPayload(payload, metadata);
    upsertSession.run(session);

    for (const [index, item] of (payload.items ?? []).entries()) {
      const result = resultParamsFromItem(session.id, item, index, session.updatedAt);
      if (!result.productId || !result.title || !result.url) continue;
      upsertResult.run(result);
    }

    return session.id;
  });

  function saveSearchSnapshot(payload, metadata = {}) {
    return saveTransaction(payload, metadata);
  }

  function listSearches(filters = {}) {
    const clauses = [];
    const params = {
      limit: clampLimit(filters.limit),
    };

    const personId = toNullableInteger(filters.personId);
    if (personId !== null) {
      clauses.push("person_id = @personId");
      params.personId = personId;
    }

    const keyword = normalizeSpace(filters.keyword);
    if (keyword) {
      clauses.push("(keyword LIKE @keywordLike OR person_name LIKE @keywordLike)");
      params.keywordLike = `%${keyword}%`;
    }

    const order = normalizeSpace(filters.order);
    if (order) {
      clauses.push("search_order = @order");
      params.order = order;
    }

    const scope = normalizeSpace(filters.scope);
    if (scope) {
      clauses.push("scope = @scope");
      params.scope = scope;
    }

    for (const [index, alias] of normalizeAliases(filters.aliases).entries()) {
      const key = `alias${index}`;
      clauses.push(`EXISTS (SELECT 1 FROM json_each(search_sessions.aliases_json) WHERE value = @${key})`);
      params[key] = alias;
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`
        SELECT *
        FROM search_sessions
        ${where}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT @limit
      `)
      .all(params);

    return {
      items: rows.map(mapSessionRow),
    };
  }

  function getSearch(id) {
    const row = db.prepare("SELECT * FROM search_sessions WHERE id = ?").get(id);
    if (!row) return null;

    const items = db
      .prepare(`
        SELECT *
        FROM search_session_results
        WHERE search_session_id = ?
        ORDER BY display_order ASC, source_order ASC, title ASC
      `)
      .all(id)
      .map(mapResultRow);

    const session = mapSessionRow(row);
    return {
      ...session,
      payload: buildPayload(row, items),
    };
  }

  function getPersonSearches(personId, filters = {}) {
    const normalizedPersonId = toNullableInteger(personId);
    if (normalizedPersonId === null) return { items: [] };
    return listSearches({ ...filters, personId: normalizedPersonId });
  }

  function getPersonSessionRows(personId, limit = MAX_HISTORY_LIMIT) {
    return db
      .prepare(`
        SELECT *
        FROM search_sessions
        WHERE person_id = @personId
        ORDER BY updated_at DESC, created_at DESC
        LIMIT @limit
      `)
      .all({ personId, limit: clampLimit(limit) });
  }

  function getPersonWorkRows(personId, filters = {}) {
    const params = {
      personId,
    };
    const sourceClauses = ["s.person_id = @personId"];
    const resultClauses = [];

    const sessionId = normalizeSpace(filters.sessionId);
    if (sessionId) {
      sourceClauses.push("s.id = @sessionId");
      params.sessionId = sessionId;
    } else {
      resultClauses.push("rn = 1");
    }

    const type = normalizeWorkType(filters.type);
    if (type !== "all") {
      resultClauses.push("type = @type");
      params.type = type;
    }

    const age = normalizeWorkAge(filters.age);
    if (age !== "all") {
      resultClauses.push("age_category = @age");
      params.age = age;
    }

    const sort = normalizeWorkSort(filters.sort);
    const orderBy =
      sort === "latest"
        ? "session_updated_at DESC, display_order ASC, COALESCE(source_order, display_order) ASC, title ASC"
        : "COALESCE(sales, -1) DESC, session_updated_at DESC, display_order ASC, title ASC";
    const where = resultClauses.length ? `WHERE ${resultClauses.join(" AND ")}` : "";

    let limitSql = "";
    if (filters.limit !== null) {
      params.limit = clampWorkLimit(filters.limit);
      limitSql = "LIMIT @limit";
    }

    return db
      .prepare(`
        WITH ranked AS (
          SELECT
            r.*,
            s.id AS session_id,
            s.created_at AS session_created_at,
            s.updated_at AS session_updated_at,
            w.product_id AS watched_product_id,
            w.target_price_jpy,
            w.note AS watch_note,
            w.source AS watch_source,
            w.updated_at AS watch_updated_at,
            wa.product_id AS annotation_product_id,
            wa.note AS annotation_note,
            wa.tags_json AS annotation_tags_json,
            wa.status AS annotation_status,
            wa.created_at AS annotation_created_at,
            wa.updated_at AS annotation_updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY r.product_id
              ORDER BY s.updated_at DESC, r.display_order ASC, COALESCE(r.source_order, r.display_order) ASC
            ) AS rn
          FROM search_session_results r
          JOIN search_sessions s ON s.id = r.search_session_id
          LEFT JOIN watchlist w ON w.product_id = r.product_id
          LEFT JOIN work_annotations wa ON wa.product_id = r.product_id
          WHERE ${sourceClauses.join(" AND ")}
        )
        SELECT *
        FROM ranked
        ${where}
        ORDER BY ${orderBy}
        ${limitSql}
      `)
      .all(params)
      .map(mapPersonWorkRow);
  }

  function getPersonProfile(personId, { recentLimit = 6 } = {}) {
    const normalizedPersonId = toNullableInteger(personId);
    if (normalizedPersonId === null) return null;

    const sessionRows = getPersonSessionRows(normalizedPersonId, MAX_HISTORY_LIMIT);
    if (sessionRows.length === 0) return null;

    const latest = sessionRows[0];
    const person = parseJson(latest.person_json, {}) ?? {};
    const works = getPersonWorkRows(normalizedPersonId, { limit: null });
    const recentSearches = sessionRows.slice(0, clampLimit(recentLimit)).map(mapSessionRow);
    const subscription = mapPersonSubscription(
      db.prepare("SELECT * FROM person_subscriptions WHERE person_id = ?").get(normalizedPersonId)
    );

    return {
      person: {
        ...person,
        id: latest.person_id ?? person.id,
        name: latest.person_name ?? person.name,
      },
      aliases: collectAliases(sessionRows),
      stats: buildPersonStats(works, sessionRows.length, latest.updated_at),
      recentSearches,
      subscription,
      dataSource: {
        kind: "local_search_history",
        label: "本地搜索历史",
        searchSessions: sessionRows.length,
        latestSearchAt: latest.updated_at,
      },
    };
  }

  function getPersonWorks(personId, filters = {}) {
    const normalizedPersonId = toNullableInteger(personId);
    if (normalizedPersonId === null) return null;

    const latestSession = db
      .prepare("SELECT id FROM search_sessions WHERE person_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1")
      .get(normalizedPersonId);
    if (!latestSession) return null;

    const sort = normalizeWorkSort(filters.sort);
    const type = normalizeWorkType(filters.type);
    const age = normalizeWorkAge(filters.age);
    const sessionId = normalizeSpace(filters.sessionId);
    const items = getPersonWorkRows(normalizedPersonId, {
      sort,
      type,
      age,
      sessionId,
      limit: filters.limit,
    });

    return {
      personId: normalizedPersonId,
      generatedAt: new Date().toISOString(),
      filters: {
        sort,
        type,
        age,
        sessionId,
      },
      total: items.length,
      items,
    };
  }

  function getKnownPersonProductIds(personId) {
    const normalizedPersonId = toNullableInteger(personId);
    if (normalizedPersonId === null) return [];

    return db
      .prepare(
        `
          SELECT DISTINCT r.product_id
          FROM search_session_results r
          JOIN search_sessions s ON s.id = r.search_session_id
          WHERE s.person_id = ?
          ORDER BY r.product_id ASC
        `
      )
      .all(normalizedPersonId)
      .map((row) => row.product_id);
  }

  const cleanupPlanCte = `
    WITH
    ranked_person_sessions AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY person_id
               ORDER BY updated_at DESC, created_at DESC, id DESC
             ) AS rn
      FROM search_sessions
      WHERE person_id IS NOT NULL
    ),
    ranked_anonymous_sessions AS (
      SELECT id,
             ROW_NUMBER() OVER (
               ORDER BY updated_at DESC, created_at DESC, id DESC
             ) AS rn
      FROM search_sessions
      WHERE person_id IS NULL
    ),
    subscribed_latest_sessions AS (
      SELECT s.id,
             ROW_NUMBER() OVER (
               PARTITION BY s.person_id
               ORDER BY s.updated_at DESC, s.created_at DESC, s.id DESC
             ) AS rn
      FROM search_sessions s
      JOIN person_subscriptions ps ON ps.person_id = s.person_id
      WHERE s.person_id IS NOT NULL
    ),
    protected_sessions AS (
      SELECT id FROM ranked_person_sessions WHERE rn <= @keepPerPerson
      UNION
      SELECT id FROM ranked_anonymous_sessions WHERE rn <= @keepAnonymous
      UNION
      SELECT id FROM subscribed_latest_sessions WHERE rn = 1
    ),
    deletable_sessions AS (
      SELECT s.id
      FROM search_sessions s
      LEFT JOIN protected_sessions p ON p.id = s.id
      WHERE s.updated_at < @cutoffAt
        AND p.id IS NULL
    )
  `;

  function countSearchHistoryCleanupPlan(options) {
    return db
      .prepare(
        `
          ${cleanupPlanCte}
          SELECT
            (SELECT COUNT(*) FROM search_sessions WHERE updated_at < @cutoffAt) AS oldSessions,
            (SELECT COUNT(*) FROM protected_sessions) AS protectedSessions,
            (SELECT COUNT(*) FROM deletable_sessions) AS deletableSessions,
            (
              SELECT COUNT(*)
              FROM search_session_results
              WHERE search_session_id IN (SELECT id FROM deletable_sessions)
            ) AS deletableResults
        `
      )
      .get(options);
  }

  function executeSearchHistoryCleanup(options) {
    const transaction = db.transaction(() => {
      const resultDelete = db
        .prepare(
          `
            ${cleanupPlanCte}
            DELETE FROM search_session_results
            WHERE search_session_id IN (SELECT id FROM deletable_sessions)
          `
        )
        .run(options);
      const sessionDelete = db
        .prepare(
          `
            ${cleanupPlanCte}
            DELETE FROM search_sessions
            WHERE id IN (SELECT id FROM deletable_sessions)
          `
        )
        .run(options);
      return {
        deletedResults: resultDelete.changes,
        deletedSessions: sessionDelete.changes,
      };
    });

    return transaction();
  }

  function runSearchHistoryCleanup(rawOptions = {}) {
    const options = normalizeSearchHistoryCleanupOptions(rawOptions);
    const plan = countSearchHistoryCleanupPlan(options);
    const executed = options.dryRun
      ? { deletedResults: 0, deletedSessions: 0 }
      : executeSearchHistoryCleanup(options);

    return {
      dryRun: options.dryRun,
      retentionDays: options.retentionDays,
      cutoffAt: options.cutoffAt,
      keepPerPerson: options.keepPerPerson,
      keepAnonymous: options.keepAnonymous,
      oldSessions: plan.oldSessions ?? 0,
      protectedSessions: plan.protectedSessions ?? 0,
      deletableSessions: plan.deletableSessions ?? 0,
      deletableResults: plan.deletableResults ?? 0,
      deletedSessions: executed.deletedSessions,
      deletedResults: executed.deletedResults,
      touchedTables: ["search_sessions", "search_session_results"],
    };
  }

  function close() {
    if (!options.db) db.close();
  }

  return {
    db,
    saveSearchSnapshot,
    listSearches,
    getSearch,
    getPersonSearches,
    getPersonProfile,
    getPersonWorks,
    getKnownPersonProductIds,
    runSearchHistoryCleanup,
    close,
  };
}

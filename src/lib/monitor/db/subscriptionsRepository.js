import {
  asJson,
  isoNow,
  mapPersonSubscription,
  normalizePersonSubscriptionInput,
  normalizeProductId,
  toNullableInteger,
} from "./utils.js";

export function createSubscriptionsRepository({ db, statements }) {
  function getPersonSubscription(personId) {
    const normalized = toNullableInteger(personId);
    if (normalized === null) return null;
    return mapPersonSubscription(statements.getPersonSubscription.get(normalized));
  }

  function savePersonSubscription(payload = {}) {
    const normalized = normalizePersonSubscriptionInput(payload);
    const existing = getPersonSubscription(normalized.personId);
    const now = isoNow();

    statements.upsertPersonSubscription.run({
      personId: normalized.personId,
      personName: normalized.personName,
      personImage: normalized.personImage,
      sourceUrl: normalized.sourceUrl,
      keyword: normalized.keyword,
      aliasesJson: asJson(normalized.aliases),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastCheckedAt: existing?.lastCheckedAt ?? null,
      lastSuccessfulCheckAt: existing?.lastSuccessfulCheckAt ?? null,
      lastCheckStatus: existing?.lastCheckStatus ?? "idle",
      lastError: existing?.lastError ?? "",
      lastResultCount: existing?.lastResultCount ?? 0,
      lastNewItemCount: existing?.lastNewItemCount ?? 0,
    });

    return getPersonSubscription(normalized.personId);
  }

  function deletePersonSubscription(personId) {
    const normalized = toNullableInteger(personId);
    if (normalized === null) return false;
    const result = statements.deletePersonSubscription.run(normalized);
    return result.changes > 0;
  }

  function listDuePersonSubscriptions({ now = isoNow(), intervalMs = 24 * 60 * 60 * 1000, limit = 3 } = {}) {
    const dueBefore = new Date(new Date(now).getTime() - Math.max(Number(intervalMs) || 0, 0)).toISOString();
    return statements.listDuePersonSubscriptions
      .all({
        dueBefore,
        limit: Math.min(Math.max(Number(limit) || 3, 1), 20),
      })
      .map(mapPersonSubscription);
  }

  function updatePersonSubscriptionCheck(
    personId,
    {
      status = "completed",
      checkedAt = isoNow(),
      error = "",
      resultCount = 0,
      newItemCount = 0,
    } = {}
  ) {
    const normalized = toNullableInteger(personId);
    if (normalized === null) return null;
    const existing = getPersonSubscription(normalized);
    if (!existing) return null;

    statements.updatePersonSubscriptionCheck.run({
      personId: normalized,
      updatedAt: checkedAt,
      lastCheckedAt: checkedAt,
      lastSuccessfulCheckAt: status === "completed" ? checkedAt : existing.lastSuccessfulCheckAt,
      lastCheckStatus: status,
      lastError: String(error ?? "").trim(),
      lastResultCount: Math.max(Number(resultCount) || 0, 0),
      lastNewItemCount: Math.max(Number(newItemCount) || 0, 0),
    });

    return getPersonSubscription(normalized);
  }

  function createPossibleNewWorkAlert({
    personId,
    personName = "",
    productId,
    message,
    fingerprint,
    createdAt = isoNow(),
    metadata = {},
  }) {
    const normalizedPersonId = toNullableInteger(personId);
    const normalizedProductId = normalizeProductId(productId);
    if (normalizedPersonId === null || !normalizedProductId || !message || !fingerprint) return false;

    const result = statements.insertAlert.run({
      productId: normalizedProductId,
      type: "possible_new_work",
      previousPriceJpy: null,
      currentPriceJpy: null,
      targetPriceJpy: null,
      message: String(message).trim(),
      createdAt,
      sourceRunId: null,
      personId: normalizedPersonId,
      personName: String(personName ?? "").trim(),
      metadataJson: asJson(metadata),
      fingerprint,
    });

    return result.changes > 0;
  }

  function getSubscriptionStats() {
    return (
      db
        .prepare(
          `SELECT
             COUNT(*) AS subscribedPersons,
             SUM(CASE WHEN last_check_status = 'failed' THEN 1 ELSE 0 END) AS failedSubscriptions
           FROM person_subscriptions`
        )
        .get() ?? { subscribedPersons: 0, failedSubscriptions: 0 }
    );
  }

  return {
    getPersonSubscription,
    savePersonSubscription,
    deletePersonSubscription,
    listDuePersonSubscriptions,
    updatePersonSubscriptionCheck,
    createPossibleNewWorkAlert,
    getSubscriptionStats,
  };
}

import { normalizeSpace } from "./cache.js";

function normalizeProductId(value) {
  return normalizeSpace(value).toUpperCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function indexByProductId(items = []) {
  const indexed = new Map();
  for (const item of asArray(items)) {
    const productId = normalizeProductId(item?.productId);
    if (productId) indexed.set(productId, { ...item, productId });
  }
  return indexed;
}

function accountListEntries(accountLists = {}) {
  const entries = [];
  for (const [listType, list] of Object.entries(accountLists ?? {})) {
    for (const productId of asArray(list?.productIds)) {
      const normalized = normalizeProductId(productId);
      if (normalized) entries.push([normalized, listType]);
    }
  }
  return entries;
}

function indexAccountLists(localOverlay = {}) {
  const indexed = new Map();
  const lists = {
    ...(localOverlay.account?.lists ?? {}),
    ...(localOverlay.accountLists ?? {}),
  };

  for (const [productId, listType] of accountListEntries(lists)) {
    const current = indexed.get(productId) ?? new Set();
    current.add(listType);
    indexed.set(productId, current);
  }
  return indexed;
}

function publicAccountContext(account = {}) {
  return {
    hasSession: Boolean(account.hasSession),
    pointsJpy: Number.isFinite(Number(account.pointsJpy)) ? Number(account.pointsJpy) : null,
    isStale: Boolean(account.isStale),
    lastSyncedAt: account.lastSyncedAt ?? null,
    updatedAt: account.updatedAt ?? null,
  };
}

function localSubscriptionForPerson(personId, subscriptions = []) {
  const normalizedPersonId = Number(personId);
  if (!Number.isFinite(normalizedPersonId)) return null;
  return asArray(subscriptions).find((subscription) => Number(subscription?.personId) === normalizedPersonId) ?? null;
}

function publicSubscriptionContext(subscription) {
  if (!subscription) return null;
  return {
    personId: Number(subscription.personId),
    lastCheckedAt: subscription.lastCheckedAt ?? null,
    lastCheckStatus: normalizeSpace(subscription.lastCheckStatus),
    lastResultCount: Number(subscription.lastResultCount) || 0,
    lastNewItemCount: Number(subscription.lastNewItemCount) || 0,
  };
}

function withAccountOverlay(item, listTypes) {
  if (!listTypes?.size) return item;
  const accountListTypes = [...listTypes].sort();
  return {
    ...item,
    account: {
      owned: accountListTypes.includes("collection"),
      listTypes: accountListTypes,
    },
  };
}

export function applyLocalSearchOverlay(publicPayload = {}, localOverlay = {}) {
  const watchlistByProductId = indexByProductId(localOverlay.watchlist);
  const annotationsByProductId = indexByProductId(localOverlay.annotations);
  const accountListsByProductId = indexAccountLists(localOverlay);
  const subscription = publicSubscriptionContext(
    localSubscriptionForPerson(publicPayload.person?.id ?? publicPayload.cache?.publicQuery?.personId, localOverlay.subscriptions)
  );
  let watchlistMatches = 0;
  let ownedMatches = 0;
  let annotationMatches = 0;

  const items = asArray(publicPayload.items).map((item) => {
    const productId = normalizeProductId(item.productId);
    const watch = watchlistByProductId.get(productId);
    const annotation = annotationsByProductId.get(productId);
    const accountListTypes = accountListsByProductId.get(productId);
    let next = { ...item };

    if (watch) {
      watchlistMatches += 1;
      next = {
        ...next,
        isWatched: true,
        targetPriceJpy: watch.targetPriceJpy ?? null,
        watchSource: watch.source || "local",
      };
    }
    if (annotation) {
      annotationMatches += 1;
      next = {
        ...next,
        annotation: {
          productId,
          note: annotation.note || "",
          tags: asArray(annotation.tags),
          status: annotation.status || "",
          updatedAt: annotation.updatedAt ?? null,
        },
      };
    }
    if (accountListTypes?.has("collection")) ownedMatches += 1;
    return withAccountOverlay(next, accountListTypes);
  });

  return {
    ...publicPayload,
    person: subscription
      ? {
          ...(publicPayload.person ?? {}),
          subscription,
        }
      : { ...(publicPayload.person ?? {}) },
    items,
    localOverlay: {
      applied: true,
      private: true,
      account: publicAccountContext(localOverlay.account),
      watchlistMatches,
      ownedMatches,
      annotationMatches,
      subscriptionMatched: Boolean(subscription),
      claimsEntitlement: false,
    },
  };
}

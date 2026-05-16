import { randomUUID } from "node:crypto";
import {
  MONITOR_CATEGORIES,
  MONITOR_FLOORS,
  MONITOR_PERIODS,
  enrichRankingItems,
  fetchRankingItems,
} from "./dlsiteRanking.js";
import { fetchDlsiteActivities } from "./dlsiteActivities.js";
import {
  aggregateDlsiteResults,
  searchDlsiteAliasProgressive,
  searchOrderLabel,
  summarizeAgeGroups,
  verifyDlsiteItems,
} from "../dlsite.js";
import { normalizeSpace } from "../cache.js";
import {
  importDlsiteAccountPages,
  normalizeDlsiteCookieHeader,
  syncDlsiteAccount,
} from "../dlsiteAccount.js";
import { createImageCache } from "../imageCache.js";
import { createMonitorRepository } from "./repository.js";

const DAILY_SYNC_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ACTIVITY_SYNC_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MONITOR_DELAY_MS = 1_500;
const DEFAULT_SUBSCRIPTION_CHECK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SUBSCRIPTION_MAX_ALIASES = 6;
const DEFAULT_SUBSCRIPTION_MAX_PAGES = 2;
const DEFAULT_SUBSCRIPTION_PER_PAGE = 30;

function isoNow() {
  return new Date().toISOString();
}

function addMs(isoValue, ms) {
  const time = isoValue ? new Date(isoValue).getTime() : Date.now();
  return new Date(time + ms).toISOString();
}

function normalizeSubscriptionAliases(subscription = {}) {
  return [
    ...new Set(
      [subscription.personName, ...(Array.isArray(subscription.aliases) ? subscription.aliases : [])]
        .map((alias) => normalizeSpace(alias))
        .filter(Boolean)
    ),
  ].slice(0, DEFAULT_SUBSCRIPTION_MAX_ALIASES);
}

function subscriptionSearchOptions(subscription = {}) {
  const aliasCount = Math.max(normalizeSubscriptionAliases(subscription).length, 1);
  return {
    scope: "all",
    order: "release_d",
    orderLabel: searchOrderLabel("release_d"),
    verifyDetails: true,
    maxAliases: aliasCount,
    maxPagesPerAlias: DEFAULT_SUBSCRIPTION_MAX_PAGES,
    perPage: DEFAULT_SUBSCRIPTION_PER_PAGE,
  };
}

function isDefinitiveNewWork(item) {
  return item?.verification?.status === "matched";
}

function possibleNewWorkMessage(subscription, item) {
  const prefix = isDefinitiveNewWork(item) ? "\u65b0\u4f5c\u7ebf\u7d22" : "\u53ef\u80fd\u7684\u65b0\u4f5c";
  return `${subscription.personName} ${prefix}\uff1a${item.title}`;
}

function priorityScore(target, priority = null) {
  if (!priority) return 0;

  let score = 0;
  if (priority.floor && target.floor === priority.floor) score += 4;
  if (priority.period && target.period === priority.period) score += 2;
  if (priority.category && target.category === priority.category) score += 8;
  return score;
}

export function prioritizeTargets(targets, priority = null) {
  return targets
    .map((target, index) => ({ target, index, score: priorityScore(target, priority) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.target);
}

export function createDlsiteMonitor({
  repository = createMonitorRepository(),
  searchHistoryRepository = null,
  floors = MONITOR_FLOORS,
  periods = MONITOR_PERIODS,
  category,
  categories,
  minDelayMs = Number(process.env.DLSITE_MONITOR_DELAY_MS) || DEFAULT_MONITOR_DELAY_MS,
  activitySyncIntervalMs =
    Number(process.env.DLSITE_ACTIVITY_SYNC_INTERVAL_MS) || DEFAULT_ACTIVITY_SYNC_MS,
  subscriptionCheckIntervalMs =
    Number(process.env.DLSITE_PERSON_SUBSCRIPTION_SYNC_INTERVAL_MS) || DEFAULT_SUBSCRIPTION_CHECK_MS,
  fetchActivities = fetchDlsiteActivities,
  searchAliasProgressive = searchDlsiteAliasProgressive,
  verifySearchItems = verifyDlsiteItems,
  imageCache = createImageCache(),
} = {}) {
  let activeRunId = null;
  let activePromise = null;
  let scheduler = null;
  let activeActivityRunId = null;
  let activeActivityPromise = null;
  let activityScheduler = null;
  let subscriptionScheduler = null;
  let subscriptionSweepPromise = null;
  const activeSubscriptionChecks = new Map();

  function syncTargets(priority = null) {
    const selectedCategories = Array.isArray(categories) && categories.length
      ? categories
      : category
        ? [category]
        : MONITOR_CATEGORIES;
    const targets = floors.flatMap((floor) =>
      periods.flatMap((period) => selectedCategories.map((targetCategory) => ({ floor, period, category: targetCategory })))
    );
    return prioritizeTargets(targets, priority);
  }

  function attachCachedImage(item, type) {
    if (!item || typeof item !== "object") return item;
    const cachedImageUrl = imageCache.resolveCachedImageUrl?.(item.imageUrl, { type }) || "";
    if (!cachedImageUrl) return item;
    return {
      ...item,
      cachedImageUrl,
      remoteImageUrl: item.imageUrl || "",
    };
  }

  function attachCachedWorkImages(items) {
    return Array.isArray(items) ? items.map((item) => attachCachedImage(item, "work")) : items;
  }

  function attachCachedMatchSummary(summary) {
    if (!summary || typeof summary !== "object") return summary;
    return {
      ...summary,
      sampleMatches: attachCachedWorkImages(summary.sampleMatches),
    };
  }

  function attachCachedActivityPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;
    return {
      ...payload,
      activityMatches: attachCachedMatchSummary(payload.activityMatches),
      personalSummary: payload.personalSummary
        ? {
            ...payload.personalSummary,
            relatedWorks: attachCachedMatchSummary(payload.personalSummary.relatedWorks),
          }
        : payload.personalSummary,
      items: (payload.items ?? []).map((item) => {
        const activity = attachCachedImage(item, "activity");
        return {
          ...activity,
          relatedWorks: attachCachedWorkImages(item.relatedWorks),
        };
      }),
    };
  }

  function attachCachedWorkCollectionPayload(payload, keys = ["items"]) {
    if (!payload || typeof payload !== "object") return payload;
    return keys.reduce(
      (next, key) => ({
        ...next,
        [key]: attachCachedWorkImages(next[key]),
      }),
      { ...payload }
    );
  }

  function attachCachedBundlePayload(payload) {
    if (!payload || typeof payload !== "object") return payload;
    return {
      ...payload,
      items: (payload.items ?? []).map((bundle) => ({
        ...bundle,
        items: attachCachedWorkImages(bundle.items),
      })),
    };
  }

  function attachCachedWorkHistory(payload) {
    if (!payload || typeof payload !== "object") return payload;
    return {
      ...payload,
      work: attachCachedImage(payload.work, "work"),
    };
  }

  async function warmImageCache(entries, type) {
    if (typeof imageCache.cacheImageUrl !== "function") return;
    const urls = [
      ...new Set(
        (Array.isArray(entries) ? entries : [])
          .map((entry) => String(entry?.imageUrl ?? "").trim())
          .filter(Boolean)
      ),
    ];
    const workers = Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (urls.length) {
        const url = urls.shift();
        await imageCache.cacheImageUrl(url, { type });
      }
    });
    await Promise.allSettled(workers);
  }

  function serializeRun(run) {
    return run
      ? {
          ...run,
          isRunning: run.status === "running",
        }
      : null;
  }

  function getLatestRecoveringInterruptedRun() {
    const latest = repository.getLatestSyncRun();
    if (!activePromise && latest?.status === "running") {
      return repository.updateSyncRun(latest.id, {
        status: "failed",
        error: latest.error || "同步被中断或服务已重启。",
      });
    }
    return latest;
  }

  function getLatestRecoveringInterruptedActivityRun() {
    const latest = repository.getLatestActivitySyncRun();
    if (!activeActivityPromise && latest?.status === "running") {
      return repository.updateActivitySyncRun(latest.id, {
        status: "failed",
        error: latest.error || "活动同步被中断或服务已重启。",
      });
    }
    return latest;
  }

  async function performSync(runId, targets) {
    const capturedAt = isoNow();
    const totalSteps = targets.length * 2;
    const detailCache = new Map();
    const rankingSnapshots = [];
    let fetchedRankings = 0;
    let enrichedWorks = 0;
    let completedSteps = 0;

    try {
      for (const target of targets) {
        const currentTarget = `${target.floor}/${target.period}/${target.category} 快照`;
        repository.updateSyncRun(runId, {
          status: "running",
          fetchedRankings,
          enrichedWorks,
          progress: {
            current: currentTarget,
            completedTargets: completedSteps,
            totalTargets: totalSteps,
          },
        });

        const rankingItems = await fetchRankingItems({ ...target, minDelayMs });
        await warmImageCache(rankingItems, "work");
        fetchedRankings += rankingItems.length;
        rankingSnapshots.push({ target, items: rankingItems });

        repository.saveSyncedProducts({
          syncRunId: runId,
          capturedAt,
          entries: rankingItems,
          evaluateAlerts: false,
        });

        completedSteps += 1;
        repository.updateSyncRun(runId, {
          status: "running",
          fetchedRankings,
          enrichedWorks,
          progress: {
            current: currentTarget,
            completedTargets: completedSteps,
            totalTargets: totalSteps,
          },
        });
      }

      for (const { target, items } of rankingSnapshots) {
        const currentTarget = `${target.floor}/${target.period}/${target.category} 详情`;
        repository.updateSyncRun(runId, {
          status: "running",
          fetchedRankings,
          enrichedWorks,
          progress: {
            current: currentTarget,
            completedTargets: completedSteps,
            totalTargets: totalSteps,
          },
        });

        const enrichedItems = await enrichRankingItems(items, { detailCache, minDelayMs });
        await warmImageCache(enrichedItems, "work");
        enrichedWorks += enrichedItems.length;

        repository.saveSyncedProducts({
          syncRunId: runId,
          capturedAt,
          entries: enrichedItems,
        });

        completedSteps += 1;
        repository.updateSyncRun(runId, {
          status: "running",
          fetchedRankings,
          enrichedWorks,
          progress: {
            current: currentTarget,
            completedTargets: completedSteps,
            totalTargets: totalSteps,
          },
        });
      }

      repository.updateSyncRun(runId, {
        status: "completed",
        fetchedRankings,
        enrichedWorks,
        progress: {
          current: "",
          completedTargets: totalSteps,
          totalTargets: totalSteps,
        },
        error: "",
      });
    } catch (error) {
      repository.updateSyncRun(runId, {
        status: "failed",
        fetchedRankings,
        enrichedWorks,
        progress: {
          current: "",
          completedTargets: completedSteps,
          totalTargets: totalSteps,
        },
        error: error.message,
      });
      throw error;
    }
  }

  function startSync({ reason = "manual", priority = null } = {}) {
    if (activePromise && activeRunId) {
      return {
        alreadyRunning: true,
        run: serializeRun(repository.getSyncRun(activeRunId)),
      };
    }

    const targets = syncTargets(priority);
    const run = repository.createSyncRun({
      scope: { reason, floors, periods, categories: [...new Set(targets.map((target) => target.category))] },
      totalTargets: targets.length * 2,
    });
    activeRunId = run.id;
    activePromise = performSync(run.id, targets)
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        activeRunId = null;
        activePromise = null;
      });

    return {
      alreadyRunning: false,
      run: serializeRun(run),
    };
  }

  async function performActivitySync(runId) {
    try {
      repository.updateActivitySyncRun(runId, {
        status: "running",
        sourceCount: 0,
        activityCount: 0,
        error: "",
      });

      const capturedAt = isoNow();
      const payload = await fetchActivities({ minDelayMs, includeDetails: true });
      await warmImageCache(payload.items, "activity");
      repository.saveActivities({
        capturedAt,
        entries: payload.items,
      });
      repository.updateActivitySyncRun(runId, {
        status: "completed",
        sourceCount: payload.sources?.length ?? 0,
        activityCount: payload.items?.length ?? 0,
        error: payload.errors?.length ? payload.errors.map((entry) => entry.error).join("; ") : "",
      });
    } catch (error) {
      repository.updateActivitySyncRun(runId, {
        status: "failed",
        error: error.message,
      });
      throw error;
    }
  }

  function startActivitySync({ reason = "manual" } = {}) {
    if (activeActivityPromise && activeActivityRunId) {
      return {
        alreadyRunning: true,
        run: serializeRun(repository.getActivitySyncRun(activeActivityRunId)),
      };
    }

    const run = repository.createActivitySyncRun({
      scope: { reason, source: "dlsite-activities" },
    });
    activeActivityRunId = run.id;
    activeActivityPromise = performActivitySync(run.id)
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        activeActivityRunId = null;
        activeActivityPromise = null;
      });

    return {
      alreadyRunning: false,
      run: serializeRun(run),
    };
  }

  async function performPersonSubscriptionCheck(subscription, { reason = "manual" } = {}) {
    const checkedAt = isoNow();
    const aliases = normalizeSubscriptionAliases(subscription);
    if (!subscription?.personId || !subscription?.personName || aliases.length === 0) {
      const error = new Error("Person subscription is incomplete.");
      error.statusCode = 400;
      throw error;
    }

    repository.updatePersonSubscriptionCheck(subscription.personId, {
      status: "running",
      checkedAt,
      error: "",
      resultCount: subscription.lastResultCount ?? 0,
      newItemCount: subscription.lastNewItemCount ?? 0,
    });

    try {
      const options = subscriptionSearchOptions(subscription);
      const knownProductIds = new Set(searchHistoryRepository?.getKnownPersonProductIds?.(subscription.personId) ?? []);
      const aliasResults = [];

      for (const alias of aliases) {
        try {
          aliasResults.push(
            await searchAliasProgressive(alias, {
              maxPages: options.maxPagesPerAlias,
              perPage: options.perPage,
              order: options.order,
              scope: options.scope,
              minDelayMs,
            })
          );
        } catch (error) {
          aliasResults.push({
            alias,
            error: error.message,
            count: 0,
            availableCount: 0,
            pagesFetched: 0,
            truncated: false,
            floors: [],
            items: [],
          });
        }
      }

      const aggregated = aggregateDlsiteResults(aliasResults, { order: options.order });
      if (options.verifyDetails) {
        await verifySearchItems(aggregated.items, aliases, { minDelayMs });
        aggregated.ageGroups = summarizeAgeGroups(aggregated.items);
      }

      const newItems = aggregated.items.filter((item) => !knownProductIds.has(item.productId));
      let newAlertCount = 0;

      for (const item of newItems) {
        repository.saveImportedWork({
          productId: item.productId,
          title: item.title,
          url: item.url,
          imageUrl: item.imageUrl || item.image || "",
          circle: item.circle,
          circleId: (item.circleUrl || "").match(/maker_id\/([^/.]+)/)?.[1] ?? "",
          floor: item.floor || "home",
          ageCategory: item.ageCategory || "",
          workType: item.workType || item.type || "",
          categoryLabel: item.categoryLabel || item.category || "",
          genres: item.genres ?? [],
          priceJpy: item.priceJpy,
          officialPriceJpy: item.priceJpy,
          sales: item.sales,
          ratingCount: item.ratingCount,
          raw: {
            source: "person_subscription_check",
            personId: subscription.personId,
            personName: subscription.personName,
            reason,
            matchedAliases: item.matchedAliases ?? [],
            verification: item.verification ?? {},
          },
        });

        const inserted = repository.createPossibleNewWorkAlert({
          personId: subscription.personId,
          personName: subscription.personName,
          productId: item.productId,
          message: possibleNewWorkMessage(subscription, item),
          fingerprint: `possible_new_work:${subscription.personId}:${item.productId}`,
          createdAt: checkedAt,
          metadata: {
            confidence: isDefinitiveNewWork(item) ? "matched" : "possible",
            matchedAliases: item.verification?.matchedAliases ?? item.matchedAliases ?? [],
            verificationStatus: item.verification?.status ?? "unknown",
            verificationFields: item.verification?.fields ?? [],
          },
        });
        if (inserted) newAlertCount += 1;
      }

      const searchSessionId = randomUUID();
      searchHistoryRepository?.saveSearchSnapshot?.(
        {
          keyword: subscription.keyword || subscription.personName,
          person: {
            id: subscription.personId,
            name: subscription.personName,
            image: subscription.personImage || "",
            sourceUrl: subscription.sourceUrl || "",
            aliases: aliases.map((alias) => ({ value: alias, sources: ["subscription"], sourceKeys: ["subscription"] })),
          },
          searchedAliases: aliases,
          options: {
            ...options,
            subscriptionCheck: true,
          },
          timing: { totalMs: 0 },
          progress: {
            jobId: searchSessionId,
            status: "completed",
            error: "",
            isComplete: true,
            completedAliases: aliases.length,
            totalAliases: aliases.length,
            pagesFetched: aggregated.aliasSummaries.reduce(
              (total, summary) => total + (summary.pagesFetched ?? 0),
              0
            ),
            totalPageBudget: aliases.length * 2 * options.maxPagesPerAlias,
            updatedAt: Date.parse(checkedAt),
          },
          ...aggregated,
        },
        {
          id: searchSessionId,
          createdAt: checkedAt,
          updatedAt: checkedAt,
        }
      );

      const updatedSubscription = repository.updatePersonSubscriptionCheck(subscription.personId, {
        status: "completed",
        checkedAt,
        error: aggregated.errors?.length ? aggregated.errors.map((entry) => entry.error).join("; ") : "",
        resultCount: aggregated.items.length,
        newItemCount: newAlertCount,
      });

      return {
        personId: subscription.personId,
        generatedAt: checkedAt,
        newAlertCount,
        resultCount: aggregated.items.length,
        newItems: newItems.map((item) => ({
          productId: item.productId,
          title: item.title,
          url: item.url,
          imageUrl: item.imageUrl || item.image || "",
          verification: item.verification ?? {},
        })),
        searchSessionId,
        subscription: updatedSubscription,
      };
    } catch (error) {
      repository.updatePersonSubscriptionCheck(subscription.personId, {
        status: "failed",
        checkedAt,
        error: error.message,
        resultCount: 0,
        newItemCount: 0,
      });
      throw error;
    }
  }

  function ensureSubscriptionCheck(subscription, { reason = "manual" } = {}) {
    const key = Number(subscription.personId);
    if (activeSubscriptionChecks.has(key)) return activeSubscriptionChecks.get(key);

    const promise = performPersonSubscriptionCheck(subscription, { reason }).finally(() => {
      activeSubscriptionChecks.delete(key);
    });
    activeSubscriptionChecks.set(key, promise);
    return promise;
  }

  async function checkPersonSubscription(personId, { reason = "manual" } = {}) {
    const subscription = repository.getPersonSubscription(personId);
    if (!subscription) {
      const error = new Error("Subscription not found.");
      error.statusCode = 404;
      throw error;
    }
    return ensureSubscriptionCheck(subscription, { reason });
  }

  function subscriptionsAreDue() {
    return (repository.listDuePersonSubscriptions({ intervalMs: subscriptionCheckIntervalMs, limit: 1 }) ?? []).length > 0;
  }

  function runDueSubscriptionChecks({ reason = "scheduled", limit = 3 } = {}) {
    if (subscriptionSweepPromise) return subscriptionSweepPromise;

    subscriptionSweepPromise = (async () => {
      const dueSubscriptions = repository.listDuePersonSubscriptions({
        intervalMs: subscriptionCheckIntervalMs,
        limit,
      });
      const results = [];
      for (const subscription of dueSubscriptions) {
        try {
          results.push(await ensureSubscriptionCheck(subscription, { reason }));
        } catch (error) {
          results.push({
            personId: subscription.personId,
            error: error.message,
          });
        }
      }
      return {
        generatedAt: isoNow(),
        results,
      };
    })().finally(() => {
      subscriptionSweepPromise = null;
    });

    return subscriptionSweepPromise;
  }

  function nextScheduledAt() {
    const latest = getLatestRecoveringInterruptedRun();
    if (!latest) return isoNow();
    return addMs(latest.startedAt, DAILY_SYNC_MS);
  }

  function nextActivityScheduledAt() {
    const latest = getLatestRecoveringInterruptedActivityRun();
    if (!latest) return isoNow();
    return addMs(latest.startedAt, activitySyncIntervalMs);
  }

  function isDue() {
    const latest = getLatestRecoveringInterruptedRun();
    if (!latest) return true;
    if (latest.status === "running") return false;
    return Date.now() - new Date(latest.startedAt).getTime() >= DAILY_SYNC_MS;
  }

  function activityIsDue() {
    const latest = getLatestRecoveringInterruptedActivityRun();
    if (!latest) return true;
    if (latest.status === "running") return false;
    return Date.now() - new Date(latest.startedAt).getTime() >= activitySyncIntervalMs;
  }

  function startDailyScheduler() {
    if (!scheduler && process.env.DLSITE_MONITOR_AUTO_SYNC !== "0") {
      const check = () => {
        if (!activePromise && isDue()) startSync({ reason: "scheduled" });
      };
      scheduler = setInterval(check, 60 * 60 * 1000);
      setTimeout(check, 3_000);
    }

    if (!activityScheduler && process.env.DLSITE_ACTIVITY_AUTO_SYNC !== "0") {
      const checkActivities = () => {
        if (!activeActivityPromise && activityIsDue()) startActivitySync({ reason: "scheduled" });
      };
      activityScheduler = setInterval(checkActivities, 60 * 60 * 1000);
      setTimeout(checkActivities, 5_000);
    }

    if (!subscriptionScheduler && process.env.DLSITE_PERSON_SUBSCRIPTION_AUTO_SYNC !== "0") {
      const checkSubscriptions = () => {
        if (!subscriptionSweepPromise && subscriptionsAreDue()) void runDueSubscriptionChecks({ reason: "scheduled" });
      };
      subscriptionScheduler = setInterval(checkSubscriptions, 60 * 60 * 1000);
      setTimeout(checkSubscriptions, 7_000);
    }
  }

  function stopDailyScheduler() {
    clearInterval(scheduler);
    scheduler = null;
    clearInterval(activityScheduler);
    activityScheduler = null;
    clearInterval(subscriptionScheduler);
    subscriptionScheduler = null;
  }

  function getStatus() {
    const latestRun = activeRunId
      ? repository.getSyncRun(activeRunId)
      : getLatestRecoveringInterruptedRun();
    return {
      running: Boolean(activePromise),
      activeRunId,
      latestRun: serializeRun(latestRun),
      nextScheduledAt: nextScheduledAt(),
    };
  }

  function getActivityStatus() {
    const latestRun = activeActivityRunId
      ? repository.getActivitySyncRun(activeActivityRunId)
      : getLatestRecoveringInterruptedActivityRun();
    return {
      running: Boolean(activeActivityPromise),
      activeRunId: activeActivityRunId,
      latestRun: serializeRun(latestRun),
      nextScheduledAt: nextActivityScheduledAt(),
      intervalMs: activitySyncIntervalMs,
    };
  }

  function snapshotCleanupIsBlocked() {
    const latestRun = activeRunId ? repository.getSyncRun(activeRunId) : repository.getLatestSyncRun?.();
    const latestActivityRun = activeActivityRunId
      ? repository.getActivitySyncRun(activeActivityRunId)
      : repository.getLatestActivitySyncRun?.();
    return Boolean(
      activePromise ||
        activeActivityPromise ||
        latestRun?.status === "running" ||
        latestActivityRun?.status === "running"
    );
  }

  function runSnapshotCleanup(options = {}) {
    const dryRun = options.dryRun !== false;
    if (!dryRun && snapshotCleanupIsBlocked()) {
      const error = new Error("Snapshot cleanup is blocked while a sync is running.");
      error.statusCode = 409;
      throw error;
    }
    return repository.runSnapshotCleanup({ ...options, dryRun });
  }

  async function runImageCacheCleanup(options = {}) {
    const dryRun = options.dryRun !== false;
    if (!dryRun && snapshotCleanupIsBlocked()) {
      const error = new Error("Image cache cleanup is blocked while a sync is running.");
      error.statusCode = 409;
      throw error;
    }
    return imageCache.runImageCacheCleanup({
      ...options,
      dryRun,
      referencedUrls: repository.getImageCacheReferences?.() ?? {},
    });
  }

  return {
    repository,
    startSync,
    startActivitySync,
    startDailyScheduler,
    stopDailyScheduler,
    getStatus,
    getActivityStatus,
    getDashboardSummary: () => attachCachedWorkCollectionPayload(repository.getDashboardSummary(), ["notableDrops"]),
    getActivityAlertSummary: (query) => ({
      ...repository.getActivityAlertSummary(query),
      syncStatus: getActivityStatus(),
    }),
    getActivities: (query) =>
      attachCachedActivityPayload({
        ...repository.getActivities(query),
        syncStatus: getActivityStatus(),
        account: repository.getAccountProfile(),
      }),
    getRankings: (query) => attachCachedWorkCollectionPayload(repository.getRankings(query)),
    getWorkHistory: (productId) => attachCachedWorkHistory(repository.getWorkHistory(productId)),
    addWatchlist: (payload) => attachCachedImage(repository.addWatchlist(payload), "work"),
    importWorkToWatchlist: (payload) => attachCachedImage(repository.importWorkToWatchlist(payload), "work"),
    deleteWatchlist: (productId) => repository.deleteWatchlist(productId),
    getWatchlist: () => attachCachedWorkImages(repository.getWatchlist()),
    getWorkAnnotation: (productId) => repository.getWorkAnnotation(productId),
    saveWorkAnnotation: (payload) => repository.saveWorkAnnotation(payload),
    deleteWorkAnnotation: (productId) => repository.deleteWorkAnnotation(productId),
    getPersonSubscription: (personId) => repository.getPersonSubscription(personId),
    savePersonSubscription: (payload) => repository.savePersonSubscription(payload),
    deletePersonSubscription: (personId) => repository.deletePersonSubscription(personId),
    checkPersonSubscription,
    runDueSubscriptionChecks,
    getAlerts: (query) => attachCachedWorkImages(repository.getAlerts(query)),
    markAlertRead: (id) => repository.markAlertRead(id),
    markActivityAlertRead: (id) => repository.markActivityAlertRead(id),
    getAccountProfile: (options) => repository.getAccountProfile(options),
    saveAccountSession: ({ cookieHeader, ...rest }) =>
      repository.saveAccountSession({
        cookieHeader: normalizeDlsiteCookieHeader(cookieHeader),
        ...rest,
      }),
    clearAccountSession: () => repository.clearAccountSession(),
    getAccountSyncState: () => repository.getAccountSyncState(),
    syncAccount: (options) => syncDlsiteAccount(repository, options),
    importAccountPages: (payload) => importDlsiteAccountPages(repository, payload),
    getAffordableRecommendations: (query) =>
      attachCachedWorkCollectionPayload(repository.getAffordableRecommendations(query)),
    getBundleRecommendations: (query) => attachCachedBundlePayload(repository.getBundleRecommendations(query)),
    runSnapshotCleanup,
    runImageCacheCleanup,
    close: () => {
      stopDailyScheduler();
      repository.close();
    },
  };
}

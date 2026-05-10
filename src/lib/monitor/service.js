import {
  MONITOR_CATEGORIES,
  MONITOR_FLOORS,
  MONITOR_PERIODS,
  enrichRankingItems,
  fetchRankingItems,
} from "./dlsiteRanking.js";
import {
  importDlsiteAccountPages,
  normalizeDlsiteCookieHeader,
  syncDlsiteAccount,
} from "../dlsiteAccount.js";
import { createMonitorRepository } from "./repository.js";

const DAILY_SYNC_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MONITOR_DELAY_MS = 1_500;

function isoNow() {
  return new Date().toISOString();
}

function addMs(isoValue, ms) {
  const time = isoValue ? new Date(isoValue).getTime() : Date.now();
  return new Date(time + ms).toISOString();
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
  floors = MONITOR_FLOORS,
  periods = MONITOR_PERIODS,
  category,
  categories,
  minDelayMs = Number(process.env.DLSITE_MONITOR_DELAY_MS) || DEFAULT_MONITOR_DELAY_MS,
} = {}) {
  let activeRunId = null;
  let activePromise = null;
  let scheduler = null;

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

  function nextScheduledAt() {
    const latest = getLatestRecoveringInterruptedRun();
    if (!latest) return isoNow();
    return addMs(latest.startedAt, DAILY_SYNC_MS);
  }

  function isDue() {
    const latest = getLatestRecoveringInterruptedRun();
    if (!latest) return true;
    if (latest.status === "running") return false;
    return Date.now() - new Date(latest.startedAt).getTime() >= DAILY_SYNC_MS;
  }

  function startDailyScheduler() {
    if (scheduler || process.env.DLSITE_MONITOR_AUTO_SYNC === "0") return;

    const check = () => {
      if (!activePromise && isDue()) startSync({ reason: "scheduled" });
    };
    scheduler = setInterval(check, 60 * 60 * 1000);
    setTimeout(check, 3_000);
  }

  function stopDailyScheduler() {
    clearInterval(scheduler);
    scheduler = null;
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

  return {
    repository,
    startSync,
    startDailyScheduler,
    stopDailyScheduler,
    getStatus,
    getDashboardSummary: () => repository.getDashboardSummary(),
    getRankings: (query) => repository.getRankings(query),
    getWorkHistory: (productId) => repository.getWorkHistory(productId),
    addWatchlist: (payload) => repository.addWatchlist(payload),
    importWorkToWatchlist: (payload) => repository.importWorkToWatchlist(payload),
    deleteWatchlist: (productId) => repository.deleteWatchlist(productId),
    getWatchlist: () => repository.getWatchlist(),
    getAlerts: (query) => repository.getAlerts(query),
    markAlertRead: (id) => repository.markAlertRead(id),
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
    getAffordableRecommendations: (query) => repository.getAffordableRecommendations(query),
    close: () => {
      stopDailyScheduler();
      repository.close();
    },
  };
}

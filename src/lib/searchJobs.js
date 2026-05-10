import { randomUUID } from "node:crypto";
import {
  aggregateDlsiteResults,
  searchDlsiteAliasProgressive,
  searchOrderLabel,
  summarizeAgeGroups,
  verifyDlsiteItems,
} from "./dlsite.js";

const DEFAULT_JOB_TTL_MS = 1000 * 60 * 30;
const DEFAULT_SEARCH_CONCURRENCY = 3;
const DEFAULT_MIN_DELAY_MS = 900;

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function searchFloorCount(scope) {
  return scope === "all" ? 2 : 1;
}

function createPendingAliasResult(alias, order) {
  return {
    alias,
    count: 0,
    order,
    orderLabel: searchOrderLabel(order),
    availableCount: 0,
    pagesFetched: 0,
    truncated: false,
    floors: [],
    items: [],
  };
}

function cloneAliasResult(result) {
  return {
    ...result,
    floors: (result.floors ?? []).map((floor) => ({ ...floor })),
    items: (result.items ?? []).map((item) => ({ ...item })),
  };
}

function progressStatusIsComplete(status) {
  return status === "completed" || status === "failed";
}

export function createSearchJobStore({
  ttlMs = DEFAULT_JOB_TTL_MS,
  concurrency = DEFAULT_SEARCH_CONCURRENCY,
  minDelayMs = DEFAULT_MIN_DELAY_MS,
} = {}) {
  const jobs = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (now - job.updatedAt > ttlMs) jobs.delete(id);
    }
  }

  function serialize(job) {
    const aggregated = job.verifiedAggregated ?? aggregateDlsiteResults(job.aliasResults, {
      order: job.options.order,
    });
    const pagesFetched = aggregated.aliasSummaries.reduce(
      (total, summary) =>
        total + (summary.floors ?? []).reduce((floorTotal, floor) => floorTotal + floor.fetchedPages, 0),
      0
    );

    return {
      keyword: job.keyword,
      person: job.person,
      searchedAliases: job.selectedAliasValues,
      options: job.options,
      timing: {
        totalMs: (job.completedAt ?? Date.now()) - job.startedAt,
      },
      progress: {
        jobId: job.id,
        status: job.status,
        error: job.error ?? "",
        isComplete: progressStatusIsComplete(job.status),
        completedAliases: job.completedAliases,
        totalAliases: job.selectedAliasValues.length,
        pagesFetched,
        totalPageBudget: job.totalPageBudget,
        updatedAt: job.updatedAt,
      },
      ...aggregated,
    };
  }

  function start(job) {
    void (async () => {
      try {
        await mapWithConcurrency(job.selectedAliasValues, concurrency, async (alias, index) => {
          try {
            const result = await searchDlsiteAliasProgressive(
              alias,
              {
                maxPages: job.options.maxPagesPerAlias,
                perPage: job.options.perPage,
                order: job.options.order,
                scope: job.options.scope,
                minDelayMs,
              },
              ({ result: partialResult }) => {
                job.aliasResults[index] = cloneAliasResult(partialResult);
                job.updatedAt = Date.now();
              }
            );
            job.aliasResults[index] = result;
          } catch (error) {
            job.aliasResults[index] = {
              alias,
              error: error.message,
            };
          } finally {
            job.completedAliases += 1;
            job.updatedAt = Date.now();
          }
        });

        if (job.options.verifyDetails) {
          job.status = "verifying";
          job.updatedAt = Date.now();
          const aggregated = aggregateDlsiteResults(job.aliasResults, { order: job.options.order });
          await verifyDlsiteItems(aggregated.items, job.selectedAliasValues, { minDelayMs });
          aggregated.ageGroups = summarizeAgeGroups(aggregated.items);
          job.verifiedAggregated = aggregated;
        }

        job.status = "completed";
        job.completedAt = Date.now();
        job.updatedAt = job.completedAt;
      } catch (error) {
        job.status = "failed";
        job.error = error.message;
        job.completedAt = Date.now();
        job.updatedAt = job.completedAt;
        console.error(error);
      }
    })();
  }

  function create({ keyword, person, selectedAliasValues, options }) {
    cleanup();

    const now = Date.now();
    const id = randomUUID();
    const job = {
      id,
      status: "running",
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      keyword,
      person,
      selectedAliasValues,
      options,
      completedAliases: 0,
      totalPageBudget: selectedAliasValues.length * searchFloorCount(options.scope) * options.maxPagesPerAlias,
      aliasResults: selectedAliasValues.map((alias) => createPendingAliasResult(alias, options.order)),
      verifiedAggregated: null,
      error: "",
    };

    jobs.set(id, job);
    start(job);
    return serialize(job);
  }

  function get(id) {
    cleanup();
    const job = jobs.get(id);
    return job ? serialize(job) : null;
  }

  return {
    create,
    get,
    cleanup,
  };
}

import {
  DEFAULT_MAX_PAGES_PER_ALIAS,
  MAX_PAGES_PER_ALIAS,
  normalizeSearchOrder,
} from "../lib/dlsite.js";
import { normalizeSpace } from "../lib/cache.js";

export function readRequestedAliases(value) {
  return Array.isArray(value) ? value.map(normalizeSpace).filter(Boolean) : [];
}

export function readScope(value) {
  const allowedScopes = new Set(["all", "adult", "nonAdult", "allR18"]);
  return allowedScopes.has(value) ? value : "all";
}

export function readPerPage(value) {
  return Math.min(Math.max(Number(value) || 100, 10), 100);
}

export function readSearchPageLimit(value) {
  return Math.min(Math.max(Number(value) || DEFAULT_MAX_PAGES_PER_ALIAS, 1), MAX_PAGES_PER_ALIAS);
}

export function readRankingFloor(value) {
  return ["home", "maniax"].includes(value) ? value : "home";
}

export function readRankingPeriod(value) {
  return ["day", "week", "month"].includes(value) ? value : "week";
}

export function readRankingCategory(value) {
  return ["all", "voice", "game", "manga"].includes(value) ? value : "all";
}

export function readAlertStatus(value) {
  return value === "all" ? "all" : "unread";
}

export function readAlertLimit(value) {
  return Math.min(Math.max(Number(value) || 50, 1), 100);
}

export function readActivityStatus(value) {
  return ["active", "all", "endingSoon", "unread"].includes(value) ? value : "active";
}

export function readActivityBenefit(value) {
  const allowedBenefits = new Set(["all", "point", "coupon", "discount", "free", "bonus", "info"]);
  return allowedBenefits.has(value) ? value : "all";
}

export function readActivityLimit(value) {
  return Math.min(Math.max(Number(value) || 50, 1), 100);
}

export function readDashboardActivityLimit(value) {
  return Math.min(Math.max(Number(value) || 3, 1), 100);
}

export function readActivitySearch(value) {
  return normalizeSpace(value).slice(0, 120);
}

export function readBooleanQuery(value) {
  return value === "1" || value === "true" || value === "yes";
}

export function readAccountMaxPages(value) {
  return Math.min(Math.max(Number(value) || 3, 1), 10);
}

export function readAccountSyncMode(value) {
  return value === "quick" ? "quick" : "full";
}

export function readRecommendationLimit(value) {
  return Math.min(Math.max(Number(value) || 10, 1), 30);
}

export function readMaintenanceRetentionDays(value) {
  if (value === null || value === undefined || value === "") return 365;
  return Math.trunc(Number(value));
}

export function readMaintenanceDryRun(value) {
  return value !== false && value !== "false" && value !== "0";
}

export function readActivityAlertSummaryLimit(value) {
  return Math.min(Math.max(Number(value) || 3, 1), 10);
}

export function readSearchHistoryLimit(value) {
  return Math.min(Math.max(Number(value) || 20, 1), 100);
}

export function readSearchHistoryAliases(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item ?? "").split(","))
    .map(normalizeSpace)
    .filter(Boolean);
}

export function readOptionalSearchOrder(value) {
  return value ? normalizeSearchOrder(value) : "";
}

export function readOptionalScope(value) {
  return value ? readScope(value) : "";
}

export function readPersonWorkSort(value) {
  return value === "latest" ? "latest" : "hot";
}

export function readPersonWorkType(value) {
  const allowedTypes = new Set(["all", "voice", "game", "manga", "cg", "video", "other"]);
  return allowedTypes.has(value) ? value : "all";
}

export function readPersonWorkAge(value) {
  const allowedAges = new Set(["all", "r18", "general", "r15", "unknown"]);
  return allowedAges.has(value) ? value : "all";
}

export function readPersonWorkLimit(value) {
  return Math.min(Math.max(Number(value) || 100, 1), 300);
}

export function readDashboardStateQuery(query = {}) {
  return {
    floor: readRankingFloor(query.floor),
    period: readRankingPeriod(query.period),
    category: readRankingCategory(query.category),
    alertsStatus: readAlertStatus(query.alertsStatus ?? query.status),
    activityLimit: readDashboardActivityLimit(query.activityLimit),
    alertLimit: readAlertLimit(query.alertLimit ?? query.limit),
    retentionDays: readMaintenanceRetentionDays(query.retentionDays),
  };
}

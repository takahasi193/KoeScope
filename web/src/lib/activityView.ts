import { buildQuery } from "@/lib/api";
import { arrayOf, compactText, formatNumber } from "@/lib/format";

export type ActivityFilters = {
  status: string;
  benefit: string;
  search: string;
  relatedOnly: boolean;
  limit?: number;
};

export function activityQuery(filters: ActivityFilters) {
  return `/api/activities${buildQuery({
    status: filters.status || "active",
    benefit: filters.benefit || "all",
    search: filters.search,
    related: filters.relatedOnly ? 1 : undefined,
    limit: filters.limit ?? 100
  })}`;
}

export function accountLine(payload: Record<string, any>) {
  const account = payload.account ?? payload.personalSummary?.account ?? {};
  if (!account.hasSession) return "未连接 DLsite 账号；当前只显示公开活动和本地关注匹配。";
  const points = Number(account.pointsJpy);
  const pointText = Number.isFinite(points) ? `${formatNumber(points)} pt` : "点数未读取";
  return `本地账号快照：${pointText}${account.isStale ? "，可能需要重新同步。" : "，同步状态正常。"}`;
}

export function personalSummaryLine(payload: Record<string, any>) {
  const related = payload.personalSummary?.relatedWorks ?? payload.activityMatches ?? {};
  const message = compactText(related.message);
  if (message) return message;
  const total = Number(related.totalMatches ?? payload.activityMatches?.totalMatches ?? 0);
  return total > 0 ? `发现 ${formatNumber(total)} 个可能相关的活动/作品匹配。` : "暂未发现与本地关注或账号快照相关的活动。";
}

export function activityStats(payload: Record<string, any>) {
  const items = arrayOf(payload.items);
  const matches = Number(payload.activityMatches?.totalMatches ?? payload.personalSummary?.relatedWorks?.totalMatches ?? 0);
  const pointCount = items.filter((item) => item?.benefitType === "point").length;
  return {
    resultCount: items.length,
    unreadCount: Number(payload.unreadCount ?? 0),
    matchCount: Number.isFinite(matches) ? matches : 0,
    pointCount
  };
}

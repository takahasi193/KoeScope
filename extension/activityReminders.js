function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function firstText(...values) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function normalizeTypeCounts(value = {}) {
  return {
    newActivity: toCount(value.newActivity ?? value.new_activity),
    endingSoon: toCount(value.endingSoon ?? value.ending_soon),
  };
}

function normalizeReminderItem(item) {
  return {
    id: item?.id ?? "",
    activityId: item?.activityId ?? "",
    type: firstText(item?.type),
    message: firstText(item?.message, item?.activityTitle, item?.title, "活动提醒"),
    activityTitle: firstText(item?.activityTitle, item?.title),
    activityUrl: firstText(item?.activityUrl, item?.url),
    benefitLabel: firstText(item?.benefitLabel),
    endsAt: firstText(item?.endsAt),
    createdAt: firstText(item?.createdAt),
  };
}

export function unavailableActivityReminderSummary(reason = "unavailable", message = "") {
  return {
    available: false,
    reason,
    message,
    generatedAt: "",
    unreadCount: 0,
    activeActivities: 0,
    endingSoonActivities: 0,
    newActivityAlerts: 0,
    endingSoonAlerts: 0,
    hasUnread: false,
    items: [],
  };
}

export function normalizeActivityReminderSummary(payload, { maxItems = 3 } = {}) {
  if (!payload || typeof payload !== "object") return unavailableActivityReminderSummary("empty");

  const typeCounts = normalizeTypeCounts(payload.typeCounts);
  const items = Array.isArray(payload.items)
    ? payload.items.slice(0, Math.max(0, maxItems)).map(normalizeReminderItem)
    : [];
  const unreadCount = toCount(payload.unreadCount ?? payload.unreadActivityAlerts ?? items.length);

  return {
    available: true,
    generatedAt: firstText(payload.generatedAt),
    unreadCount,
    activeActivities: toCount(payload.activeActivities),
    endingSoonActivities: toCount(payload.endingSoonActivities),
    newActivityAlerts: typeCounts.newActivity,
    endingSoonAlerts: typeCounts.endingSoon,
    hasUnread: unreadCount > 0,
    items,
  };
}

export function activityReminderCopy(summary) {
  if (!summary?.available) {
    return {
      status: "离线",
      title: "活动提醒暂不可用",
      body: "本地后端不可用时，扩展会继续保留搜索和账号同步入口。",
      tone: "muted",
      actionLabel: "打开仪表盘",
    };
  }

  if (summary.hasUnread) {
    const parts = [];
    if (summary.newActivityAlerts > 0) parts.push(`新活动 ${summary.newActivityAlerts}`);
    if (summary.endingSoonAlerts > 0) parts.push(`即将结束 ${summary.endingSoonAlerts}`);
    const leadingItem = summary.items[0]?.message;

    return {
      status: `${summary.unreadCount} 条未读`,
      title: "有新的 DLsite 活动提醒",
      body: leadingItem || parts.join(" · ") || "有未读活动提醒。",
      tone: "alert",
      actionLabel: "查看活动提醒",
    };
  }

  if (summary.activeActivities > 0) {
    const endingSoon = summary.endingSoonActivities > 0 ? `，${summary.endingSoonActivities} 个即将结束` : "";
    return {
      status: "已同步",
      title: "暂无未读活动提醒",
      body: `当前有 ${summary.activeActivities} 个公开活动${endingSoon}。`,
      tone: "default",
      actionLabel: "查看活动",
    };
  }

  return {
    status: "无未读",
    title: "暂无活动快照",
    body: "打开仪表盘刷新活动后，扩展会显示公开活动提醒。",
    tone: "muted",
    actionLabel: "打开仪表盘",
  };
}

export function activityReminderBadgeText(summary) {
  if (!summary?.available || !summary.hasUnread) return "";
  return summary.unreadCount > 99 ? "99+" : String(summary.unreadCount);
}

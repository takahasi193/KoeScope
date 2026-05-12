import { normalizeActivityReminderSummary } from "./activityReminders.js";

export const DEFAULT_BACKEND_BASE = "http://localhost:5178";

function cleanText(value, fallback = "") {
  return String(value ?? "").trim() || fallback;
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function normalizeBackendBase(value, fallback = DEFAULT_BACKEND_BASE) {
  const raw = cleanText(value).replace(/\/+$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) return raw;
  return fallback;
}

function priceAlertKind(item) {
  if (item?.type === "possible_new_work") return "work";
  if (item?.type === "target_price") return "price";
  if (item?.type === "price_drop") return "price";
  return "alert";
}

function priceAlertTitle(item) {
  const kind = priceAlertKind(item);
  if (kind === "work") return "KoeScope possible new work";
  if (kind === "price") return "KoeScope price reminder";
  return "KoeScope reminder";
}

function priceAlertKey(item) {
  const id = cleanText(item?.id);
  if (id) return `price:${id}`;
  return `price:${cleanText(item?.type, "alert")}:${cleanText(item?.productId)}:${cleanText(item?.createdAt)}`;
}

export function normalizePriceAlertNotification(item) {
  if (!item || typeof item !== "object") return null;
  const key = priceAlertKey(item);
  if (!key || key === "price:alert::") return null;
  return {
    key,
    kind: priceAlertKind(item),
    source: "price",
    title: priceAlertTitle(item),
    message: cleanText(item.message, cleanText(item.title, cleanText(item.productId, "Unread KoeScope alert"))),
    context: cleanText(item.title || item.productId),
    url: cleanText(item.url),
    createdAt: cleanText(item.createdAt),
  };
}

function normalizeActivityNotification(item) {
  const id = cleanText(item?.id);
  const activityId = cleanText(item?.activityId);
  if (!id && !activityId) return null;
  return {
    key: `activity:${id || activityId}:${cleanText(item?.type, "activity")}`,
    kind: "activity",
    source: "activity",
    title: "KoeScope DLsite activity",
    message: cleanText(item?.message, cleanText(item?.activityTitle, "Unread DLsite activity reminder")),
    context: cleanText(item?.benefitLabel || item?.activityTitle),
    url: cleanText(item?.activityUrl),
    createdAt: cleanText(item?.createdAt),
  };
}

export function buildNotificationItems({ alertsPayload = {}, activitySummary = {}, maxPriceItems = 8, maxActivityItems = 8 } = {}) {
  const priceItems = (Array.isArray(alertsPayload?.items) ? alertsPayload.items : [])
    .slice(0, Math.max(0, maxPriceItems))
    .map(normalizePriceAlertNotification)
    .filter(Boolean);
  const normalizedActivity = normalizeActivityReminderSummary(activitySummary, { maxItems: maxActivityItems });
  const activityItems = normalizedActivity.hasUnread
    ? normalizedActivity.items.map(normalizeActivityNotification).filter(Boolean)
    : [];

  return [...priceItems, ...activityItems];
}

export function selectNewNotificationItems(
  items,
  state = {},
  { maxNotifications = 4, maxStoredKeys = 200, nowIso = new Date().toISOString() } = {}
) {
  const currentItems = Array.isArray(items) ? items.filter((item) => item?.key) : [];
  const knownKeys = new Set(Array.isArray(state.notifiedKeys) ? state.notifiedKeys.map(String) : []);
  const currentKeys = currentItems.map((item) => item.key);
  const newItems = currentItems.filter((item) => !knownKeys.has(item.key)).slice(0, Math.max(0, maxNotifications));
  const nextKeys = [...new Set([...knownKeys, ...currentKeys])].slice(-Math.max(1, maxStoredKeys));

  return {
    newItems,
    nextState: {
      ...state,
      notifiedKeys: nextKeys,
      lastCheckedAt: nowIso,
      lastUnreadCount: toCount(currentItems.length),
      lastError: "",
    },
  };
}

export function notificationIdFor(item) {
  return `koescope-${cleanText(item?.key, "notification")}`.replace(/[^\w.-]+/g, "-").slice(0, 120);
}

export function formatNumber(value: unknown, fallback = "0") {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ja-JP") : fallback;
}

export function formatPrice(value: unknown, fallback = "価格不明") {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${number.toLocaleString("ja-JP")}円` : fallback;
}

export function formatPercent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${Math.round(number)}%OFF` : "";
}

export function formatDateTime(value: unknown, fallback = "未记录") {
  const text = String(value ?? "");
  if (!text) return fallback;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return fallback;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function compactText(value: unknown, fallback = "") {
  return String(value ?? "").trim() || fallback;
}

export function arrayOf<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function imageOf(item: Record<string, any>) {
  return compactText(item.cachedImageUrl || item.imageUrl || item.image);
}

export function workTitle(item: Record<string, any>) {
  return compactText(item.title, compactText(item.productId, "未命名作品"));
}

export function claimsText(value: unknown) {
  return value === true ? "已声明适用" : "仅可能相关";
}

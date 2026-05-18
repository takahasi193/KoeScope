export function toIsoTime(value, fallback = null) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback ?? new Date().toISOString();
}

export function toTimeMs(value) {
  const iso = toIsoTime(value, "");
  return iso ? Date.parse(iso) : NaN;
}

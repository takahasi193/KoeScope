export class TTLCache {
  constructor(defaultTtlMs = 1000 * 60 * 30) {
    this.defaultTtlMs = defaultTtlMs;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear() {
    this.entries.clear();
  }
}

export function normalizeSpace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

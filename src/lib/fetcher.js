import { sleep } from "./cache.js";

const DEFAULT_USER_AGENT =
  process.env.APP_USER_AGENT ||
  "DLVoiceSearch/0.1 (local personal research tool; set APP_USER_AGENT for contact info)";

const lastRequestAtByHost = new Map();
const hostQueues = new Map();

async function waitForHostSlot(url, minDelayMs) {
  const host = new URL(url).hostname;
  const previous = hostQueues.get(host) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const lastRequestAt = lastRequestAtByHost.get(host) ?? 0;
    const waitMs = Math.max(0, lastRequestAt + minDelayMs - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAtByHost.set(host, Date.now());
  });

  hostQueues.set(host, current);
  try {
    await current;
  } finally {
    if (hostQueues.get(host) === current) hostQueues.delete(host);
  }
}

export async function politeFetch(url, options = {}) {
  const {
    headers = {},
    minDelayMs = 650,
    retries = 2,
    retryDelayMs = 900,
    ...fetchOptions
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;

    try {
      await waitForHostSlot(url, minDelayMs);
      response = await fetch(url, {
        ...fetchOptions,
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja,en;q=0.8,zh-CN;q=0.7",
          ...headers,
        },
      });
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(retryDelayMs * (attempt + 1));
      continue;
    }

    if (response.ok) return response;

    const canRetry = response.status === 429 || response.status >= 500;
    lastError = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    if (!canRetry || attempt === retries) {
      throw lastError;
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw lastError;
}

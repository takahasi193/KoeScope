import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PUBLIC_ROOT = path.join(__dirname, "..", "..", "public");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

function normalizeRemoteImageUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function cacheTypeDir(type) {
  if (type === "activity") return "activities";
  if (type === "work") return "works";
  return "images";
}

function extensionFromUrl(urlValue) {
  try {
    const ext = path.extname(new URL(urlValue).pathname).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return ".jpg";
    return ext === ".jpeg" ? ".jpg" : ext;
  } catch {
    return ".jpg";
  }
}

export function publicCachePathForUrl(remoteUrl, { type = "work" } = {}) {
  const normalized = normalizeRemoteImageUrl(remoteUrl);
  if (!normalized) return "";
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `/cache/${cacheTypeDir(type)}/${hash}${extensionFromUrl(normalized)}`;
}

function filePathForPublicUrl(publicRoot, publicUrl) {
  return path.join(publicRoot, publicUrl.replace(/^\/+/, ""));
}

function isImageResponse(response) {
  const contentType = response.headers?.get?.("content-type") ?? "";
  return !contentType || contentType.toLowerCase().startsWith("image/");
}

function responseSize(response) {
  const size = Number(response.headers?.get?.("content-length"));
  return Number.isFinite(size) ? size : null;
}

export function createImageCache({
  publicRoot = DEFAULT_PUBLIC_ROOT,
  fetchImpl = globalThis.fetch,
  maxBytes = 5 * 1024 * 1024,
  timeoutMs = 4500,
  logger = console,
} = {}) {
  function resolveCachedImageUrl(remoteUrl, { type = "work" } = {}) {
    const publicUrl = publicCachePathForUrl(remoteUrl, { type });
    if (!publicUrl) return "";
    return fs.existsSync(filePathForPublicUrl(publicRoot, publicUrl)) ? publicUrl : "";
  }

  async function cacheImageUrl(remoteUrl, { type = "work" } = {}) {
    const normalized = normalizeRemoteImageUrl(remoteUrl);
    if (!normalized || typeof fetchImpl !== "function") return "";

    const publicUrl = publicCachePathForUrl(normalized, { type });
    const filePath = filePathForPublicUrl(publicRoot, publicUrl);
    if (fs.existsSync(filePath)) return publicUrl;

    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const signal =
        typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      const response = await fetchImpl(normalized, { signal });
      if (!response.ok || !isImageResponse(response)) return "";

      const declaredSize = responseSize(response);
      if (declaredSize !== null && declaredSize > maxBytes) return "";

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) return "";

      const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
      await fsp.writeFile(tempPath, bytes);
      await fsp.rename(tempPath, filePath).catch(async (error) => {
        await fsp.rm(tempPath, { force: true });
        if (error.code !== "EEXIST") throw error;
      });
      return publicUrl;
    } catch (error) {
      logger?.debug?.(`Image cache skipped ${normalized}: ${error.message}`);
      return "";
    }
  }

  return {
    cacheImageUrl,
    resolveCachedImageUrl,
    publicCachePathForUrl: (remoteUrl, options) => publicCachePathForUrl(remoteUrl, options),
  };
}

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PUBLIC_ROOT = path.join(__dirname, "..", "..", "public");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const DEFAULT_IMAGE_CACHE_RETENTION_DAYS = 30;
const DEFAULT_IMAGE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function publicUrlForFile(publicRoot, filePath) {
  return `/${path.relative(publicRoot, filePath).split(path.sep).join("/")}`;
}

function normalizeCleanupDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    const error = new Error("now must be a valid date.");
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizePositiveInteger(value, fallback, name) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < 1) {
    const error = new Error(`${name} must be a positive integer.`);
    error.statusCode = 400;
    throw error;
  }
  return number;
}

function normalizeImageCacheCleanupOptions(options = {}) {
  const retentionDays = normalizePositiveInteger(
    options.retentionDays,
    DEFAULT_IMAGE_CACHE_RETENTION_DAYS,
    "retentionDays"
  );
  const maxBytes = normalizePositiveInteger(options.maxBytes, DEFAULT_IMAGE_CACHE_MAX_BYTES, "maxBytes");
  const now = normalizeCleanupDate(options.now);
  const cutoffAt = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  return {
    dryRun: options.dryRun !== false,
    retentionDays,
    maxBytes,
    cutoffAt,
    cutoffTime: new Date(cutoffAt).getTime(),
  };
}

function referencedCacheUrls(referencedUrls = {}) {
  const normalized = referencedUrls && typeof referencedUrls === "object" ? referencedUrls : {};
  const references = new Set();
  const typedUrls = [
    ["work", normalized.work],
    ["activity", normalized.activity],
    ["image", normalized.image],
  ];

  for (const [type, urls] of typedUrls) {
    for (const url of Array.isArray(urls) ? urls : []) {
      const publicUrl = publicCachePathForUrl(url, { type });
      if (publicUrl) references.add(publicUrl);
    }
  }

  return references;
}

async function listImageCacheFiles(publicRoot) {
  const cacheRoot = path.join(publicRoot, "cache");
  const files = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      const stat = await fsp.stat(filePath);
      files.push({
        filePath,
        publicUrl: publicUrlForFile(publicRoot, filePath),
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  await visit(cacheRoot);
  return files;
}

function planImageCacheCleanup(files, references, options) {
  const annotated = files.map((file) => ({
    ...file,
    protected: references.has(file.publicUrl),
    olderThanCutoff: file.mtimeMs < options.cutoffTime,
  }));
  const totalBytes = annotated.reduce((sum, file) => sum + file.bytes, 0);
  const planned = new Map();

  for (const file of annotated) {
    if (!file.protected && file.olderThanCutoff) planned.set(file.filePath, file);
  }

  let projectedBytes = totalBytes - [...planned.values()].reduce((sum, file) => sum + file.bytes, 0);
  if (projectedBytes > options.maxBytes) {
    const overflowCandidates = annotated
      .filter((file) => !file.protected && !planned.has(file.filePath))
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.publicUrl.localeCompare(b.publicUrl));
    for (const file of overflowCandidates) {
      planned.set(file.filePath, file);
      projectedBytes -= file.bytes;
      if (projectedBytes <= options.maxBytes) break;
    }
  }

  return {
    annotated,
    deletable: [...planned.values()].sort((a, b) => a.mtimeMs - b.mtimeMs || a.publicUrl.localeCompare(b.publicUrl)),
    totalBytes,
  };
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

  async function runImageCacheCleanup(rawOptions = {}) {
    const options = normalizeImageCacheCleanupOptions(rawOptions);
    const references = referencedCacheUrls(rawOptions.referencedUrls);
    const files = await listImageCacheFiles(publicRoot);
    const plan = planImageCacheCleanup(files, references, options);
    let deletedFiles = 0;
    let deletedBytes = 0;

    if (!options.dryRun) {
      for (const file of plan.deletable) {
        await fsp.rm(file.filePath, { force: true });
        deletedFiles += 1;
        deletedBytes += file.bytes;
      }
    }

    const protectedFiles = plan.annotated.filter((file) => file.protected);
    const unreferencedFiles = plan.annotated.filter((file) => !file.protected);
    const oldUnreferencedFiles = unreferencedFiles.filter((file) => file.olderThanCutoff);
    const deletableBytes = plan.deletable.reduce((sum, file) => sum + file.bytes, 0);

    return {
      dryRun: options.dryRun,
      retentionDays: options.retentionDays,
      cutoffAt: options.cutoffAt,
      maxBytes: options.maxBytes,
      totalFiles: plan.annotated.length,
      totalBytes: plan.totalBytes,
      protectedFiles: protectedFiles.length,
      protectedBytes: protectedFiles.reduce((sum, file) => sum + file.bytes, 0),
      unreferencedFiles: unreferencedFiles.length,
      oldUnreferencedFiles: oldUnreferencedFiles.length,
      deletableFiles: plan.deletable.length,
      deletableBytes,
      deletedFiles,
      deletedBytes,
      files: plan.deletable.map((file) => ({
        publicUrl: file.publicUrl,
        bytes: file.bytes,
        modifiedAt: file.modifiedAt,
        reason: file.olderThanCutoff ? "older_than_retention" : "cache_over_max_bytes",
      })),
    };
  }

  return {
    cacheImageUrl,
    runImageCacheCleanup,
    resolveCachedImageUrl,
    publicCachePathForUrl: (remoteUrl, options) => publicCachePathForUrl(remoteUrl, options),
  };
}

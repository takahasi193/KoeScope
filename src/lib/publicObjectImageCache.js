import crypto from "node:crypto";
import path from "node:path";

const DEFAULT_OBJECT_IMAGE_PREFIX = "koescope/public-images";
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

function normalizePublicBaseUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "";
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeObjectPrefix(value) {
  const text = String(value ?? DEFAULT_OBJECT_IMAGE_PREFIX).trim() || DEFAULT_OBJECT_IMAGE_PREFIX;
  return text
    .split("/")
    .map((part) => part.replace(/[^A-Za-z0-9._-]/g, "-"))
    .filter(Boolean)
    .join("/");
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

export function publicObjectImageKey(remoteUrl, { type = "work", prefix = DEFAULT_OBJECT_IMAGE_PREFIX } = {}) {
  const normalized = normalizeRemoteImageUrl(remoteUrl);
  if (!normalized) return "";
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `${normalizeObjectPrefix(prefix)}/${cacheTypeDir(type)}/${hash}${extensionFromUrl(normalized)}`;
}

export function resolvePublicObjectImage(remoteUrl, options = {}) {
  const normalized = normalizeRemoteImageUrl(remoteUrl);
  if (!normalized) {
    return {
      source: "none",
      remoteImageUrl: "",
      objectImageUrl: "",
      displayImageUrl: "",
      objectKey: "",
    };
  }

  const objectKey = publicObjectImageKey(normalized, options);
  const baseUrl = normalizePublicBaseUrl(options.publicBaseUrl);
  const objectImageUrl = baseUrl && objectKey ? `${baseUrl}/${objectKey}` : "";

  return {
    source: objectImageUrl ? "object-cache" : "remote",
    remoteImageUrl: normalized,
    objectImageUrl,
    displayImageUrl: objectImageUrl || normalized,
    objectKey,
  };
}

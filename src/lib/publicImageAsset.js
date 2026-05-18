import crypto from "node:crypto";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

export function normalizeRemoteImageUrl(value) {
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

export function publicImageTypeDir(type) {
  if (type === "activity") return "activities";
  if (type === "work") return "works";
  return "images";
}

export function publicImageExtensionFromUrl(urlValue) {
  try {
    const ext = path.extname(new URL(urlValue).pathname).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return ".jpg";
    return ext === ".jpeg" ? ".jpg" : ext;
  } catch {
    return ".jpg";
  }
}

export function publicImageFileName(remoteUrl) {
  const normalized = normalizeRemoteImageUrl(remoteUrl);
  if (!normalized) return "";
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `${hash}${publicImageExtensionFromUrl(normalized)}`;
}

export function publicImagePathSegment(remoteUrl, { type = "work" } = {}) {
  const fileName = publicImageFileName(remoteUrl);
  return fileName ? `${publicImageTypeDir(type)}/${fileName}` : "";
}

import { normalizeRemoteImageUrl, publicImagePathSegment } from "./publicImageAsset.js";

const DEFAULT_OBJECT_IMAGE_PREFIX = "koescope/public-images";

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

export function publicObjectImageKey(remoteUrl, { type = "work", prefix = DEFAULT_OBJECT_IMAGE_PREFIX } = {}) {
  const normalized = normalizeRemoteImageUrl(remoteUrl);
  if (!normalized) return "";
  return `${normalizeObjectPrefix(prefix)}/${publicImagePathSegment(normalized, { type })}`;
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

import {
  planPublicSearchRefresh,
  readEnvPublicSearchRefreshEntries,
} from "../src/lib/publicSearchRefreshPlanner.js";

function setHeaders(response, headers) {
  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value);
  }
}

function sendJson(request, response, statusCode, payload) {
  response.statusCode = statusCode;
  setHeaders(response, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : `${JSON.stringify(payload)}\n`);
}

export default async function handler(request, response) {
  if (!["GET", "HEAD"].includes(request.method || "GET")) {
    response.setHeader("allow", "GET, HEAD");
    return sendJson(request, response, 405, { error: "Public search refresh cron is read-only." });
  }

  const entries = readEnvPublicSearchRefreshEntries();
  if (!entries) {
    return sendJson(request, response, 503, { error: "Public search refresh entries are not configured." });
  }

  return sendJson(
    request,
    response,
    200,
    planPublicSearchRefresh(entries, {
      maxBatch: Number(process.env.KOESCOPE_PUBLIC_SEARCH_REFRESH_CRON_BATCH) || 5,
    })
  );
}

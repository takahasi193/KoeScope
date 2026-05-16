import {
  createEnvPublicSearchCacheRepository,
  handlePublicSearchCacheRequest,
} from "../src/lib/publicSearchCacheReadApi.js";

function createRequestUrl(request) {
  return new URL(request.url || "/", `https://${request.headers.host || "localhost"}`).toString();
}

function createRequestHeaders(headers = {}) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return result;
}

function setResponseHeaders(target, headers) {
  for (const [key, value] of headers.entries()) {
    target.setHeader(key, value);
  }
}

export default async function handler(request, response) {
  const publicCacheResponse = await handlePublicSearchCacheRequest(
    new Request(createRequestUrl(request), {
      method: request.method || "GET",
      headers: createRequestHeaders(request.headers),
    }),
    {
      repository: createEnvPublicSearchCacheRepository(),
    }
  );

  response.statusCode = publicCacheResponse.status;
  setResponseHeaders(response, publicCacheResponse.headers);
  response.end(request.method === "HEAD" ? undefined : await publicCacheResponse.text());
}

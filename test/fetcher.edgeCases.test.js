import assert from "node:assert/strict";
import test from "node:test";
import { politeFetch } from "../src/lib/fetcher.js";

function response(status, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => "",
    json: async () => ({}),
  };
}

test("politeFetch does not retry non-retriable HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(404, "Not Found");
  };

  try {
    await assert.rejects(
      () =>
        politeFetch("https://non-retry.example.test/missing", {
          minDelayMs: 0,
          retryDelayMs: 0,
          retries: 3,
        }),
      /HTTP 404 Not Found/
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("politeFetch retries transient HTTP errors and returns the later success", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls < 3 ? response(500, "Server Error") : response(200);
  };

  try {
    const result = await politeFetch("https://retry.example.test/ranking", {
      minDelayMs: 0,
      retryDelayMs: 0,
      retries: 3,
    });
    assert.equal(result.ok, true);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

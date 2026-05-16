import assert from "node:assert/strict";
import test from "node:test";
import { searchPersons } from "../src/lib/bangumi.js";

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  };
}

test("Bangumi person search includes non-voice-actor careers by default and classifies candidates", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;

  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({
      total: 2,
      data: [
        {
          id: 501,
          name: "Example Illustrator",
          career: ["illustrator", "artist"],
          images: { medium: "https://img.example/illustrator.jpg" },
          infobox: [],
        },
        {
          id: 502,
          name: "Example Voice",
          career: ["seiyu"],
          images: {},
          infobox: [],
        },
      ],
    });
  };

  try {
    const result = await searchPersons("Example Illustrator", 10);

    assert.equal(requestBody.keyword, "Example Illustrator");
    assert.equal(requestBody.filter?.career, undefined);
    assert.equal(result.persons[0].id, 501);
    assert.equal(result.persons[0].personCategory, "illustration");
    assert.equal(result.persons[0].personCategoryLabel, "画师/插画");
    assert.equal(result.categories.illustration, 1);
    assert.equal(result.categories.voice_actor, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bangumi person search can filter by a local person category", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;

  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({
      total: 1,
      data: [
        {
          id: 601,
          name: "Example Actor",
          career: ["actor"],
          images: {},
          infobox: [],
        },
      ],
    });
  };

  try {
    const result = await searchPersons("Example Actor", 10, { personCategory: "performer" });

    assert.deepEqual(requestBody.filter?.career, ["actor"]);
    assert.equal(result.persons[0].personCategory, "performer");
    assert.equal(result.persons[0].personCategoryLabel, "演员/表演");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bangumi person search fans out multi-career local categories because Bangumi combines careers with AND", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];

  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    requestBodies.push(body);
    const career = body.filter?.career?.[0];
    return jsonResponse({
      total: 1,
      data: [
        {
          id: career === "illustrator" ? 701 : 702,
          name: career === "illustrator" ? "Example Illustrator" : "Example Artist",
          career: [career],
          images: {},
          infobox: [],
        },
      ],
    });
  };

  try {
    const result = await searchPersons("Example Art", 10, { personCategory: "illustration" });

    assert.deepEqual(
      requestBodies.map((body) => body.filter?.career),
      [["illustrator"], ["artist"]]
    );
    assert.deepEqual(
      result.persons.map((person) => person.personCategory),
      ["illustration", "illustration"]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

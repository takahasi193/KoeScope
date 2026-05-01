import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPerson, searchPersons } from "./lib/bangumi.js";
import {
  aggregateDlsiteResults,
  searchDlsiteAlias,
  summarizeAgeGroups,
  verifyDlsiteItems,
} from "./lib/dlsite.js";
import { normalizeSpace } from "./lib/cache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT) || 5178;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post(
  "/api/persons",
  asyncHandler(async (req, res) => {
    const keyword = normalizeSpace(req.body.keyword);
    if (!keyword) return res.status(400).json({ error: "请输入声优名。" });

    const result = await searchPersons(keyword, Number(req.body.limit) || 10);
    res.json(result);
  })
);

app.post(
  "/api/search",
  asyncHandler(async (req, res) => {
    const keyword = normalizeSpace(req.body.keyword);
    const personId = Number(req.body.personId);
    const maxAliases = Math.min(Math.max(Number(req.body.maxAliases) || 12, 1), 80);
    const maxPages = Math.min(Math.max(Number(req.body.maxPagesPerAlias) || 1, 1), 10);
    const perPage = Math.min(Math.max(Number(req.body.perPage) || 30, 10), 100);
    const allowedScopes = new Set(["all", "adult", "nonAdult", "allR18"]);
    const scope = allowedScopes.has(req.body.scope) ? req.body.scope : "all";
    const verifyDetails = Boolean(req.body.verifyDetails);
    const requestedAliases = Array.isArray(req.body.aliases)
      ? req.body.aliases.map(normalizeSpace).filter(Boolean)
      : [];

    if (!keyword && !personId) return res.status(400).json({ error: "请输入声优名。" });

    let person;
    if (personId) {
      person = await getPerson(personId, keyword);
    } else {
      const persons = await searchPersons(keyword, 10);
      person = persons.persons[0];
      if (!person) return res.status(404).json({ error: "Bangumi 没有找到候选人物。" });
    }

    const allAliases = person.aliases ?? [];
    const selectedAliasValues = [
      ...new Set(
        requestedAliases.length
          ? requestedAliases
          : allAliases.map((alias) => alias.value).slice(0, maxAliases)
      ),
    ].slice(0, 80);

    const aliasResults = [];
    for (const alias of selectedAliasValues) {
      try {
        aliasResults.push(
          await searchDlsiteAlias(alias, {
            maxPages,
            perPage,
            scope,
            minDelayMs: 900,
          })
        );
      } catch (error) {
        aliasResults.push({
          alias,
          error: error.message,
        });
      }
    }

    const aggregated = aggregateDlsiteResults(aliasResults);
    if (verifyDetails) {
      await verifyDlsiteItems(aggregated.items, selectedAliasValues, {
        minDelayMs: 900,
      });
      aggregated.ageGroups = summarizeAgeGroups(aggregated.items);
    }

    res.json({
      keyword,
      person,
      searchedAliases: selectedAliasValues,
      options: {
        scope,
        verifyDetails,
        maxAliases,
        maxPagesPerAlias: maxPages,
        perPage,
      },
      ...aggregated,
    });
  })
);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: error.message || "服务器内部错误。",
  });
});

app.listen(port, () => {
  console.log(`DL Voice Search is running at http://localhost:${port}`);
});

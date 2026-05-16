import { TTLCache, normalizeSpace } from "./cache.js";
import { politeFetch } from "./fetcher.js";

const API_BASE = "https://api.bgm.tv/v0";
const cache = new TTLCache(1000 * 60 * 60 * 12);

function personCacheKey(personId, keyword = "") {
  return `person:${personId}:${normalizeSpace(keyword)}`;
}

const SPLIT_ALIAS_PATTERN = /[=＝、,，;；/／|｜]+/u;
const WRAPPED_PART_PATTERN = /[（(]([^()（）]{2,40})[）)]/gu;
const TRIM_ALIAS_PATTERN = /^[：:＝=、,，;；/／|｜\s]+|[：:＝=、,，;；/／|｜\s]+$/gu;

const NAME_FIELD_PATTERN =
  /^(name|姓名|中文名|简体中文名|繁体中文名|第二中文名|日文名|英文名|罗马字|羅馬字|纯假名|純假名|本名|本名纯假名|本名純假名|本名罗马字|本名羅馬字|别名|別名|昵称|暱稱|别称|別称|其他名义|其他名義|名义|名義|艺名|藝名|旧艺名|旧藝名|舊藝名|旧名|旧名义|旧名義)$/u;
const PEN_NAME_FIELD_PATTERN =
  /^(别名|別名|别称|別称|其他名义|其他名義|名义|名義|艺名|藝名|旧艺名|旧藝名|舊藝名|旧名|旧名义|旧名義)$/u;

export const PERSON_CATEGORY_OPTIONS = [
  { key: "all", label: "全部人物", careers: [] },
  { key: "voice_actor", label: "声优", careers: ["seiyu"] },
  { key: "illustration", label: "画师/插画", careers: ["illustrator", "artist"] },
  { key: "manga", label: "漫画家", careers: ["mangaka"] },
  { key: "writing", label: "脚本/作者", careers: ["writer"] },
  { key: "performer", label: "演员/表演", careers: ["actor"] },
  { key: "production", label: "制作/企划", careers: ["producer"] },
  { key: "company", label: "公司/机构", careers: [] },
  { key: "group", label: "组合/团体", careers: [] },
  { key: "other", label: "其他人物", careers: [] },
];

const PERSON_CATEGORY_BY_KEY = new Map(PERSON_CATEGORY_OPTIONS.map((category) => [category.key, category]));
const PERSON_CATEGORY_PRIORITY = PERSON_CATEGORY_OPTIONS.filter((category) => category.key !== "all");

function compareKey(value) {
  return normalizeSpace(value)
    .normalize("NFKC")
    .replace(/[\s・･·.。_-]+/g, "")
    .toLocaleLowerCase("ja-JP");
}

function cleanAlias(value) {
  return normalizeSpace(value).replace(TRIM_ALIAS_PATTERN, "");
}

function normalizeCareer(value) {
  return normalizeSpace(value).toLocaleLowerCase("en-US");
}

function normalizeCareerList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeCareer).filter(Boolean))];
}

export function normalizePersonCategory(value) {
  const key = normalizeSpace(value).toLocaleLowerCase("en-US");
  return PERSON_CATEGORY_BY_KEY.has(key) ? key : "all";
}

export function careersForPersonCategory(value) {
  const category = PERSON_CATEGORY_BY_KEY.get(normalizePersonCategory(value));
  return category?.careers ?? [];
}

export function classifyPersonCategory(person = {}) {
  const careers = new Set(normalizeCareerList(person.career));
  const matched = PERSON_CATEGORY_PRIORITY.find(
    (category) => category.careers.length && category.careers.some((career) => careers.has(career))
  );
  if (matched) return matched;

  if (Number(person.type) === 2) return PERSON_CATEGORY_BY_KEY.get("company");
  if (Number(person.type) === 3) return PERSON_CATEGORY_BY_KEY.get("group");
  return PERSON_CATEGORY_BY_KEY.get("other");
}

function isNameField(key) {
  return NAME_FIELD_PATTERN.test(normalizeSpace(key));
}

function isUsefulAlias(value) {
  if (!value) return false;
  if (value.length < 2 || value.length > 60) return false;
  if (/https?:\/\//i.test(value) || /www\./i.test(value)) return false;
  if (/^@/.test(value)) return false;
  if (/^\d{3,}$/.test(value)) return false;
  if (/^\d{4}[-/年]\d{1,2}/u.test(value)) return false;
  if (/^\d+(\.\d+)?\s*(cm|kg|㎝|歳|才)$/iu.test(value)) return false;
  if (/^[ABO]{1,2}型$/iu.test(value)) return false;
  if (/^(Wikipedia|Wikidata)$/iu.test(value)) return false;
  if (/[<>]/u.test(value)) return false;
  return true;
}

function addAlias(map, rawValue, source, sourceKey = "") {
  const candidates = [];
  const value = cleanAlias(rawValue);
  if (!isUsefulAlias(value)) return;

  candidates.push(value);

  const withoutWrapped = cleanAlias(value.replace(/[（(][^()（）]+[）)]/gu, ""));
  if (withoutWrapped && withoutWrapped !== value) candidates.push(withoutWrapped);

  for (const match of value.matchAll(WRAPPED_PART_PATTERN)) {
    candidates.push(cleanAlias(match[1]));
  }

  for (const candidate of candidates) {
    if (!isUsefulAlias(candidate)) continue;
    const key = compareKey(candidate);
    const existing = map.get(key);
    if (existing) {
      existing.sources.add(source);
      if (sourceKey) existing.sourceKeys.add(sourceKey);
      continue;
    }

    map.set(key, {
      value: candidate,
      sources: new Set([source]),
      sourceKeys: new Set(sourceKey ? [sourceKey] : []),
    });
  }
}

function addAliasOrSplit(map, rawValue, source, sourceKey = "") {
  const value = cleanAlias(rawValue);
  if (!value) return;

  const parts = value
    .split(SPLIT_ALIAS_PATTERN)
    .map(cleanAlias)
    .filter(Boolean);

  if (parts.length > 1) {
    for (const part of parts) addAlias(map, part, source, sourceKey);
    return;
  }

  addAlias(map, value, source, sourceKey);
}

function markInputAlias(map, seedKeyword = "") {
  const key = compareKey(seedKeyword);
  if (!key || !map.has(key)) return;

  const existing = map.get(key);
  existing.sources.add("input");
  existing.sourceKeys.add("input");
}

function readInfoboxAliases(map, person) {
  for (const item of person.infobox ?? []) {
    const key = normalizeSpace(item.key);
    const value = item.value;

    if (typeof value === "string") {
      if (isNameField(key)) addAliasOrSplit(map, value, `infobox:${key}`, key);
      continue;
    }

    if (!Array.isArray(value)) continue;

    for (const aliasItem of value) {
      if (typeof aliasItem === "string") {
        if (isNameField(key)) addAliasOrSplit(map, aliasItem, `infobox:${key}`, key);
        continue;
      }

      const aliasKey = normalizeSpace(aliasItem?.k ?? key);
      const aliasValue = aliasItem?.v;
      if (aliasValue && isNameField(aliasKey)) {
        addAliasOrSplit(map, aliasValue, `infobox:${key}`, aliasKey);
      }
    }
  }
}

export function extractPersonAliases(person, seedKeyword = "") {
  const map = new Map();

  addAlias(map, person?.name, "person:name", "name");
  readInfoboxAliases(map, person ?? {});
  markInputAlias(map, seedKeyword);

  return [...map.values()]
    .map((alias) => {
      const sources = [...alias.sources];
      const sourceKeys = [...alias.sourceKeys];
      return {
        value: alias.value,
        sources,
        sourceKeys,
        isPenName: sourceKeys.some((key) => PEN_NAME_FIELD_PATTERN.test(key)),
      };
    })
    .sort((a, b) => {
      const rank = (alias) => {
        if (alias.sources.includes("input")) return 0;
        if (alias.isPenName) return 1;
        if (alias.sources.includes("person:name")) return 2;
        return 3;
      };
      return rank(a) - rank(b) || a.value.localeCompare(b.value, "ja-JP");
    });
}

function scorePerson(person, keyword, options = {}) {
  const needle = compareKey(keyword);
  const aliases = extractPersonAliases(person, keyword);
  const keys = aliases.map((alias) => compareKey(alias.value));
  const category = classifyPersonCategory(person);
  let score = 0;

  if (compareKey(person.name) === needle) score += 120;
  if (keys.some((key) => key === needle)) score += 100;
  if (keys.some((key) => key.includes(needle) || needle.includes(key))) score += 35;
  if (options.personCategory && category.key === options.personCategory) score += 20;
  score += Math.min(aliases.length, 30) / 10;

  return score;
}

function compactPerson(person, keyword = "", options = {}) {
  const aliases = extractPersonAliases(person, keyword);
  const category = classifyPersonCategory(person);
  return {
    id: person.id,
    name: person.name,
    image: person.images?.medium ?? person.images?.small ?? person.img ?? "",
    career: normalizeCareerList(person.career),
    type: person.type ?? null,
    personCategory: category.key,
    personCategoryLabel: category.label,
    gender: person.gender ?? "",
    summary: person.summary ?? "",
    sourceUrl: `https://bgm.tv/person/${person.id}`,
    score: scorePerson(person, keyword, options),
    aliases,
  };
}

function normalizeSearchOptions(options = {}) {
  const category = normalizePersonCategory(options.personCategory ?? options.category);
  const careers = normalizeCareerList(options.careers ?? options.career);
  return {
    personCategory: category,
    careers: careers.length ? careers : careersForPersonCategory(category),
  };
}

function summarizeCategories(persons) {
  return persons.reduce((counts, person) => {
    const key = person.personCategory || "other";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function careerFiltersForSearch(searchOptions) {
  if (!searchOptions.careers.length) return [[]];
  if (searchOptions.personCategory !== "all" && searchOptions.careers.length > 1) {
    return searchOptions.careers.map((career) => [career]);
  }
  return [searchOptions.careers];
}

async function fetchPersonSearchPayload(normalizedKeyword, limit, careers = []) {
  const body = {
    keyword: normalizedKeyword,
  };
  if (careers.length) {
    body.filter = {
      career: careers,
    };
  }

  const response = await politeFetch(`${API_BASE}/search/persons?limit=${limit}`, {
    method: "POST",
    minDelayMs: 500,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  return response.json();
}

function mergedPayloadPersons(payloads) {
  const persons = new Map();
  for (const payload of payloads) {
    for (const person of payload.data ?? []) {
      const key = person.id ?? person.name;
      if (!persons.has(key)) persons.set(key, person);
    }
  }
  return [...persons.values()];
}

function matchesRequestedPersonCategory(person, searchOptions) {
  return searchOptions.personCategory === "all" || person.personCategory === searchOptions.personCategory;
}

export async function searchPersons(keyword, limit = 10, options = {}) {
  const normalizedKeyword = normalizeSpace(keyword);
  if (!normalizedKeyword) throw new Error("keyword is required");
  const searchOptions = normalizeSearchOptions(options);

  const cacheKey = `persons:${normalizedKeyword}:${limit}:${searchOptions.personCategory}:${searchOptions.careers.join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const payloads = [];
  for (const careers of careerFiltersForSearch(searchOptions)) {
    payloads.push(await fetchPersonSearchPayload(normalizedKeyword, limit, careers));
  }

  const persons = mergedPayloadPersons(payloads)
    .map((person) => compactPerson(person, normalizedKeyword, searchOptions))
    .filter((person) => matchesRequestedPersonCategory(person, searchOptions))
    .sort((a, b) => b.score - a.score);

  for (const person of persons) {
    cache.set(personCacheKey(person.id, normalizedKeyword), person);
  }

  const result = {
    keyword: normalizedKeyword,
    personCategory: searchOptions.personCategory,
    categoryOptions: PERSON_CATEGORY_OPTIONS,
    categories: summarizeCategories(persons),
    total: payloads.length === 1 && searchOptions.personCategory === "all" ? payloads[0].total ?? persons.length : persons.length,
    persons,
  };
  cache.set(cacheKey, result);
  return result;
}

export async function getPerson(personId, keyword = "") {
  const id = Number(personId);
  if (!Number.isFinite(id)) throw new Error("personId must be a number");

  const cacheKey = personCacheKey(id, keyword);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const response = await politeFetch(`${API_BASE}/persons/${id}`, {
    minDelayMs: 500,
    headers: {
      Accept: "application/json",
    },
  });

  const person = compactPerson(await response.json(), keyword);
  cache.set(cacheKey, person);
  return person;
}

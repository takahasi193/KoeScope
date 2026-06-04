import * as cheerio from "cheerio";
import { normalizeSpace, TTLCache } from "./cache.js";
import { politeFetch } from "./fetcher.js";

const MOEGIRL_BASE = "https://zh.moegirl.org.cn";
const SOURCE_NAME = "萌娘百科";
const cache = new TTLCache(1000 * 60 * 60 * 12);

function emptyProfile(status, patch = {}) {
  return {
    status,
    sourceName: SOURCE_NAME,
    title: "",
    sourceUrl: "",
    summary: "",
    representativeText: "",
    notableWorks: [],
    matchedBy: "",
    fetchedAt: new Date().toISOString(),
    ...patch,
  };
}

function normalizeTitle(value) {
  return normalizeSpace(value).replace(/_/g, " ");
}

function uniqueValues(values, limit = 10) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = normalizeSpace(value);
    const key = text.normalize("NFKC").toLocaleLowerCase("zh-CN");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function pageUrl(title) {
  const params = new URLSearchParams({
    title,
    variant: "zh-cn",
  });
  return `${MOEGIRL_BASE}/index.php?${params.toString()}`;
}

function searchUrl(keyword) {
  const params = new URLSearchParams({
    search: keyword,
    title: "Special:搜索",
    fulltext: "1",
    variant: "zh-cn",
  });
  return `${MOEGIRL_BASE}/index.php?${params.toString()}`;
}

function sourceUrlForTitle(title) {
  if (!title) return "";
  return `${MOEGIRL_BASE}/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
}

function parseRlconf(html) {
  const match = String(html).match(/RLCONF=(\{.*?\});RLSTATE=/s);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function pageTitle($, rlconf) {
  const title = normalizeTitle(rlconf.wgTitle || rlconf.wgPageName || "");
  if (title && title !== "搜索") return title;
  return normalizeTitle($("title").text().replace(/\s*-\s*萌娘百科.*$/u, ""));
}

function cleanText(value) {
  return normalizeSpace(value).replace(/\[[^\]]{1,4}\]/g, "");
}

function usefulSummary(text) {
  if (!text || text.length < 8) return false;
  if (/萌娘百科欢迎您参与完善|此页面中存在|编辑前请阅读|欢迎正在阅读/u.test(text)) return false;
  if (/^\d{4}年$/u.test(text)) return false;
  return true;
}

function firstSummary($) {
  const paragraphs = $("#mw-content-text .mw-parser-output > p")
    .map((_index, element) => cleanText($(element).text()))
    .get();
  return paragraphs.find(usefulSummary) || "";
}

function representativeText($) {
  let result = "";
  $("#mw-content-text table.infobox tr, #mw-content-text table.moe-infobox tr").each((_index, row) => {
    if (result) return;
    const cells = $(row)
      .children("th,td")
      .map((__index, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean);
    if (cells.length < 2) return;
    const key = cells[0];
    if (/代表(角色|作品)/u.test(key)) result = cells.slice(1).join(" ");
  });
  return result;
}

function cleanRole(value) {
  return cleanText(value)
    .replace(/^[\s、，,；;。·・/|]+/u, "")
    .replace(/^(与|及|和|并|、)+/u, "")
    .replace(/[\s、，,；;。·・/|]+$/u, "");
}

export function parseRepresentativeWorks(text, limit = 12) {
  const works = [];
  const source = cleanText(text);
  const pattern = /([^《》]{1,80})《([^《》]{1,80})》/gu;
  for (const match of source.matchAll(pattern)) {
    const role = cleanRole(match[1]);
    const title = cleanText(match[2]);
    if (!role || !title) continue;
    works.push({ title, role });
    if (works.length >= limit) break;
  }
  return works;
}

function isMissingPage($, rlconf, summary, representative) {
  if (rlconf.wgIsArticle === false) return true;
  if (Number(rlconf.wgArticleId) === 0) return true;
  const title = $("title").text();
  if (/页面不存在|没有这个页面|编辑/u.test(title) && !summary && !representative) return true;
  return !summary && !representative;
}

export function parseMoegirlPersonPage(html, requestedTitle = "", options = {}) {
  const $ = cheerio.load(html);
  const rlconf = parseRlconf(html);
  const summary = firstSummary($);
  const representative = representativeText($);
  if (isMissingPage($, rlconf, summary, representative)) {
    return emptyProfile("not_found", {
      title: normalizeTitle(requestedTitle),
      fetchedAt: options.fetchedAt,
    });
  }

  const title = pageTitle($, rlconf) || normalizeTitle(requestedTitle);
  return emptyProfile("found", {
    title,
    sourceUrl: options.url || sourceUrlForTitle(title),
    summary,
    representativeText: representative,
    notableWorks: parseRepresentativeWorks(representative),
    fetchedAt: options.fetchedAt,
  });
}

function resultScore(result, keyword) {
  const text = `${result.title} ${result.snippet}`;
  let score = 0;
  if (/声优|聲優|配音/u.test(text)) score += 80;
  if (/女性声优|男性声优|日本的.*声优/u.test(text)) score += 35;
  if (/角色条目|歌曲|章节/u.test(text)) score -= 20;
  const key = normalizeTitle(keyword).normalize("NFKC").toLocaleLowerCase("zh-CN");
  const titleKey = normalizeTitle(result.title).normalize("NFKC").toLocaleLowerCase("zh-CN");
  if (key && titleKey === key) score += 50;
  if (key && titleKey.includes(key)) score += 20;
  return score;
}

export function parseMoegirlSearchPage(html, keyword = "") {
  const $ = cheerio.load(html);
  const results = [];
  $(".mw-search-result, .searchresults li").each((_index, element) => {
    const link = $(element).find(".mw-search-result-heading a, a").first();
    const title = normalizeTitle(link.text());
    const href = normalizeSpace(link.attr("href"));
    if (!title || !href) return;
    const snippet = cleanText($(element).text());
    results.push({
      title,
      href,
      snippet,
      score: resultScore({ title, snippet }, keyword),
    });
  });
  return results.sort((a, b) => b.score - a.score)[0] ?? null;
}

async function defaultFetchText(url) {
  const response = await politeFetch(url, {
    minDelayMs: 900,
    headers: {
      Accept: "text/html,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.7,en;q=0.6",
    },
  });
  return {
    html: await response.text(),
    url: response.url || url,
  };
}

function readAliasValue(alias) {
  return normalizeSpace(alias?.value ?? alias?.name ?? alias);
}

function candidateNames({ person = {}, aliases = [] } = {}) {
  const penNames = aliases.filter((alias) => alias?.isPenName).map(readAliasValue);
  const otherAliases = aliases.filter((alias) => !alias?.isPenName).map(readAliasValue);
  return uniqueValues([person.name, ...penNames, ...otherAliases], 12);
}

function cacheKeyForCandidates(candidates) {
  return `moegirl:${candidates.map((item) => item.normalize("NFKC").toLocaleLowerCase("zh-CN")).join("|")}`;
}

function absoluteMoegirlUrl(href) {
  return new URL(href, MOEGIRL_BASE).toString();
}

async function fetchParsedPage(titleOrUrl, matchedBy, fetchText, now) {
  const url = /^https?:\/\//i.test(titleOrUrl) ? titleOrUrl : pageUrl(titleOrUrl);
  const { html, url: finalUrl } = await fetchText(url);
  const parsed = parseMoegirlPersonPage(html, titleOrUrl, {
    url: finalUrl,
    fetchedAt: now().toISOString(),
  });
  return parsed.status === "found" ? { ...parsed, matchedBy } : parsed;
}

export async function findMoegirlPersonProfile(input = {}, options = {}) {
  const fetchText = options.fetchText ?? defaultFetchText;
  const now = options.now ?? (() => new Date());
  const candidates = candidateNames(input);
  const useDefaultCache = !options.fetchText && options.cache !== false;
  const key = cacheKeyForCandidates(candidates);
  if (useDefaultCache) {
    const cached = cache.get(key);
    if (cached) return cached;
  }

  if (candidates.length === 0) {
    return emptyProfile("not_found", { fetchedAt: now().toISOString() });
  }

  try {
    for (const candidate of candidates) {
      const direct = await fetchParsedPage(candidate, "direct", fetchText, now);
      if (direct.status === "found") {
        if (useDefaultCache) cache.set(key, direct);
        return direct;
      }
    }

    for (const candidate of candidates) {
      const { html } = await fetchText(searchUrl(candidate));
      const result = parseMoegirlSearchPage(html, candidate);
      if (!result) continue;
      const profile = await fetchParsedPage(absoluteMoegirlUrl(result.href), "search", fetchText, now);
      if (profile.status === "found") {
        if (useDefaultCache) cache.set(key, profile);
        return profile;
      }
    }

    const notFound = emptyProfile("not_found", { fetchedAt: now().toISOString() });
    if (useDefaultCache) cache.set(key, notFound);
    return notFound;
  } catch (error) {
    return emptyProfile("unavailable", {
      error: error.message || "萌娘百科资料暂时无法读取。",
      fetchedAt: now().toISOString(),
    });
  }
}

export function createMoegirlProfileService() {
  return {
    findPersonProfile: findMoegirlPersonProfile,
  };
}

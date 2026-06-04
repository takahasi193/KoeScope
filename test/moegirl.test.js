import assert from "node:assert/strict";
import test from "node:test";
import {
  findMoegirlPersonProfile,
  parseMoegirlPersonPage,
  parseMoegirlSearchPage,
} from "../src/lib/moegirl.js";

const PERSON_HTML = `
<!doctype html>
<html>
  <head>
    <title>青山由香里 - 萌娘百科 万物皆可萌的百科全书</title>
    <script>RLCONF={"wgPageName":"青山由香里","wgIsArticle":true,"wgIsRedirect":false};RLSTATE={};</script>
  </head>
  <body>
    <div id="mw-content-text">
      <div class="mw-parser-output">
        <table class="moe-infobox infobox">
          <tr><th colspan="2">青山由香里</th></tr>
          <tr><th>姓名</th><td>青山ゆかり</td></tr>
          <tr><th>代表角色</th><td>宝生圣佳《花与少女的祝福》与神桔世《从晴朗的朝色泛起之际开始》风见一姬《灰色系列》</td></tr>
        </table>
        <p><b>青山由香里</b>（日语：青山ゆかり）是日本的女性声优，主要从事成人游戏的配音工作。</p>
        <h2>出演作品</h2>
      </div>
    </div>
  </body>
</html>
`;

const SEARCH_HTML = `
<!doctype html>
<html>
  <body>
    <ul class="mw-search-results">
      <li class="mw-search-result">
        <div class="mw-search-result-heading"><a href="/%E9%9D%92%E5%B1%B1Blue_Mountain">青山Blue Mountain</a></div>
        <div class="searchresult">作品角色条目。</div>
      </li>
      <li class="mw-search-result">
        <div class="mw-search-result-heading"><a href="/%E9%9D%92%E5%B1%B1%E7%94%B1%E9%A6%99%E9%87%8C">青山由香里</a></div>
        <div class="searchresult">青山由香里（日语：青山ゆかり）是日本的女性声优，主要从事成人游戏的配音工作。</div>
      </li>
    </ul>
  </body>
</html>
`;

test("Moegirl person parser extracts summary and representative works", () => {
  const profile = parseMoegirlPersonPage(PERSON_HTML, "青山ゆかり");

  assert.equal(profile.status, "found");
  assert.equal(profile.title, "青山由香里");
  assert.match(profile.summary, /日本的女性声优/);
  assert.equal(
    profile.representativeText,
    "宝生圣佳《花与少女的祝福》与神桔世《从晴朗的朝色泛起之际开始》风见一姬《灰色系列》"
  );
  assert.deepEqual(profile.notableWorks, [
    { title: "花与少女的祝福", role: "宝生圣佳" },
    { title: "从晴朗的朝色泛起之际开始", role: "神桔世" },
    { title: "灰色系列", role: "风见一姬" },
  ]);
});

test("Moegirl search parser prefers voice actor results", () => {
  const result = parseMoegirlSearchPage(SEARCH_HTML, "青山ゆかり");

  assert.equal(result.title, "青山由香里");
  assert.equal(result.href, "/%E9%9D%92%E5%B1%B1%E7%94%B1%E9%A6%99%E9%87%8C");
});

test("Moegirl lookup can resolve a Japanese pen name through a redirected page", async () => {
  const requestedUrls = [];
  const profile = await findMoegirlPersonProfile(
    {
      person: { name: "青山ゆかり" },
      aliases: [{ value: "青山ゆかり", isPenName: true }],
    },
    {
      fetchText: async (url) => {
        requestedUrls.push(url);
        return {
          html: PERSON_HTML,
          url: "https://zh.moegirl.org.cn/%E9%9D%92%E5%B1%B1%E7%94%B1%E9%A6%99%E9%87%8C",
        };
      },
      now: () => new Date("2026-06-03T00:00:00.000Z"),
    }
  );

  assert.equal(profile.status, "found");
  assert.equal(profile.matchedBy, "direct");
  assert.equal(profile.title, "青山由香里");
  assert.equal(profile.fetchedAt, "2026-06-03T00:00:00.000Z");
  assert.match(requestedUrls[0], /title=%E9%9D%92%E5%B1%B1%E3%82%86%E3%81%8B%E3%82%8A/);
});

test("Moegirl lookup falls back to search page and degrades on remote failure", async () => {
  const searchProfile = await findMoegirlPersonProfile(
    {
      person: { name: "Unknown Alias" },
      aliases: [{ value: "青山ゆかり" }],
    },
    {
      fetchText: async (url) => {
        if (url.includes("index.php?title=")) return { html: "<html><title>页面不存在</title></html>", url };
        if (url.includes("search=")) return { html: SEARCH_HTML, url };
        return { html: PERSON_HTML, url };
      },
    }
  );

  assert.equal(searchProfile.status, "found");
  assert.equal(searchProfile.matchedBy, "search");
  assert.equal(searchProfile.title, "青山由香里");

  const unavailable = await findMoegirlPersonProfile(
    { person: { name: "青山ゆかり" }, aliases: [] },
    {
      fetchText: async () => {
        throw new Error("network down");
      },
    }
  );

  assert.equal(unavailable.status, "unavailable");
  assert.match(unavailable.error, /network down/);
});

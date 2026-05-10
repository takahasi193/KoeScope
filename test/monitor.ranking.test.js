import assert from "node:assert/strict";
import test from "node:test";
import { buildRankingUrl, parseRankingHtml } from "../src/lib/monitor/dlsiteRanking.js";
import { enrichRankingItems } from "../src/lib/monitor/dlsiteRanking.js";

const RANKING_FIXTURE = `
  <table id="ranking_table" class="ranking_worklist">
    <tbody>
      <tr>
        <td class="ranking_count">
          <div class="rank_no type_1">1</div>
          <div class="dl_count"><span class="dl_count_label">販売数</span>1,370</div>
        </td>
        <td class="work_1col_thumb">
          <div class="work_thumb_box">
            <thumb-with-ng-filter
              :thumb-candidates="['//img.dlsite.jp/resize/images2/work/doujin/RJ01613000/RJ01612637_img_main_240x240.webp']">
              <input type="hidden" class="__product_attributes" id="_RJ01612637" value="RG36837,male,SOU,ASMR" />
            </thumb-with-ng-filter>
            <div class="work_category type_SOU">ボイス・ASMR</div>
          </div>
        </td>
        <td>
          <dl class="work_1col">
            <dt class="work_name">
              <span class="period_date">2026年06月01日 23時59分 割引終了</span>
              <a href="https://www.dlsite.com/home/work/=/product_id/RJ01612637.html">少女と過ごす、純愛あやかし生活</a>
            </dt>
            <dd class="maker_name">
              <a href="https://www.dlsite.com/home/circle/profile/=/maker_id/RG36837.html">アールグレイ</a>
            </dd>
            <dd class="work_price_wrap">
              <span class="work_price discount">1,617<i>円</i></span>
              <span class="strike">2,310<i>円</i></span>
              <span class="icon_campaign type_sale">30%OFF</span>
            </dd>
            <dd class="search_tag">
              <a>ASMR</a><a>癒し</a>
            </dd>
          </dl>
        </td>
        <td>
          <ul class="work_info_box">
            <li class="work_dl"><span class="_dl_count_RJ01612637">1,374</span></li>
            <li class="work_rating"><div class="star_rating star_50">(45)</div></li>
          </ul>
        </td>
      </tr>
    </tbody>
  </table>
`;

test("parseRankingHtml extracts ranking metadata", () => {
  const items = parseRankingHtml(RANKING_FIXTURE, {
    floor: "home",
    period: "week",
    category: "voice",
    sourceUrl: "https://example.test/ranking",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].productId, "RJ01612637");
  assert.equal(items[0].rank, 1);
  assert.equal(items[0].title, "少女と過ごす、純愛あやかし生活");
  assert.equal(items[0].priceJpy, 1617);
  assert.equal(items[0].officialPriceJpy, 2310);
  assert.equal(items[0].discountRate, 30);
  assert.equal(items[0].sales, 1374);
  assert.equal(items[0].workType, "SOU");
  assert.deepEqual(items[0].genres, ["ASMR", "癒し"]);
});

test("parseRankingHtml extracts grouped top ranking pages", () => {
  const fixture = `
    <ul class="ranking_top_worklist">
      <li class="ranking_top_worklist_item">
        <div class="rank">1</div>
        <div class="work_thumb">
          <input type="hidden" class="__product_attributes" id="_RJ100001" value="RG1,SOU,ASMR" />
          <div class="work_category type_SOU">Voice</div>
        </div>
        <dl class="work_2col">
          <dt class="work_name"><a href="https://www.dlsite.com/home/work/=/product_id/RJ100001.html">All one</a></dt>
          <dd class="maker_name"><a href="https://www.dlsite.com/home/circle/profile/=/maker_id/RG1.html">Circle A</a></dd>
          <dd class="work_price_wrap"><span class="work_price">1,100 yen</span></dd>
        </dl>
      </li>
      <li class="ranking_top_worklist_item">
        <div class="rank">1</div>
        <div class="work_thumb">
          <input type="hidden" class="__product_attributes" id="_RJ200001" value="RG2,MNG" />
          <div class="work_category type_MNG">Manga</div>
        </div>
        <dl class="work_2col">
          <dt class="work_name"><a href="https://www.dlsite.com/home/work/=/product_id/RJ200001.html">Manga one</a></dt>
          <dd class="maker_name"><a href="https://www.dlsite.com/home/circle/profile/=/maker_id/RG2.html">Circle B</a></dd>
          <dd class="work_price_wrap"><span class="work_price">770 yen</span></dd>
        </dl>
      </li>
      <li class="ranking_top_worklist_item">
        <div class="rank">1</div>
        <div class="work_thumb">
          <input type="hidden" class="__product_attributes" id="_RJ300001" value="RG3,ADV" />
          <div class="work_category type_ADV">Game</div>
        </div>
        <dl class="work_2col">
          <dt class="work_name"><a href="https://www.dlsite.com/home/work/=/product_id/RJ300001.html">Game one</a></dt>
          <dd class="maker_name"><a href="https://www.dlsite.com/home/circle/profile/=/maker_id/RG3.html">Circle C</a></dd>
          <dd class="work_price_wrap"><span class="work_price">2,200 yen</span><span class="strike">3,300 yen</span><span class="icon_campaign">30%OFF</span></dd>
        </dl>
      </li>
      <li class="ranking_top_worklist_item">
        <div class="rank">1</div>
        <div class="work_thumb">
          <input type="hidden" class="__product_attributes" id="_RJ400001" value="RG4,SOU,ASMR" />
          <div class="work_category type_SOU">Voice</div>
        </div>
        <dl class="work_2col">
          <dt class="work_name"><a href="https://www.dlsite.com/home/work/=/product_id/RJ400001.html">Voice one</a></dt>
          <dd class="maker_name"><a href="https://www.dlsite.com/home/circle/profile/=/maker_id/RG4.html">Circle D</a></dd>
          <dd class="work_price_wrap"><span class="work_price">990 yen</span></dd>
        </dl>
      </li>
    </ul>
  `;

  const gameItems = parseRankingHtml(fixture, {
    floor: "home",
    period: "day",
    category: "game",
    sourceUrl: "https://example.test/ranking",
  });
  const voiceItems = parseRankingHtml(fixture, {
    floor: "home",
    period: "day",
    category: "voice",
    sourceUrl: "https://example.test/ranking",
  });

  assert.equal(gameItems.length, 1);
  assert.equal(gameItems[0].productId, "RJ300001");
  assert.equal(gameItems[0].rank, 1);
  assert.equal(gameItems[0].workType, "ADV");
  assert.equal(gameItems[0].priceJpy, 2200);
  assert.equal(gameItems[0].officialPriceJpy, 3300);
  assert.equal(gameItems[0].discountRate, 30);
  assert.equal(voiceItems[0].productId, "RJ400001");
});

test("buildRankingUrl targets voice ASMR ranking filters", () => {
  assert.equal(
    buildRankingUrl({ floor: "home", period: "day", category: "all" }),
    "https://www.dlsite.com/home/ranking"
  );
  assert.equal(
    buildRankingUrl({ floor: "home", period: "day", category: "manga" }),
    "https://www.dlsite.com/home/ranking?category=comic"
  );
  assert.equal(
    buildRankingUrl({ floor: "maniax", period: "month", category: "voice" }),
    "https://www.dlsite.com/maniax/ranking/month?category=voice&sub=SOU"
  );
  assert.equal(
    buildRankingUrl({ floor: "home", period: "week", category: "game" }),
    "https://www.dlsite.com/home/ranking/week?category=game"
  );
  assert.equal(
    buildRankingUrl({ floor: "home", period: "week", category: "manga" }),
    "https://www.dlsite.com/home/ranking/week?category=comic"
  );
});

test("enrichRankingItems skips product info ajax when ranking HTML already has key fields", async () => {
  let calls = 0;
  const items = [
    {
      productId: "RJ100001",
      title: "Complete",
      url: "https://www.dlsite.com/home/work/=/product_id/RJ100001.html",
      imageUrl: "https://img.example/RJ100001.jpg",
      circle: "Circle",
      floor: "home",
      period: "week",
      category: "game",
      rank: 1,
      workType: "ADV",
      priceJpy: 1100,
    },
  ];

  const enriched = await enrichRankingItems(items, {
    fetchProductInfo: async () => {
      calls += 1;
      return {};
    },
    minDelayMs: 0,
  });

  assert.equal(calls, 0);
  assert.equal(enriched[0].productId, "RJ100001");
});

test("enrichRankingItems fetches product info only for incomplete ranking rows", async () => {
  const requestedIds = [];
  const items = [
    {
      productId: "RJ100001",
      imageUrl: "",
      circle: "",
      floor: "home",
      period: "week",
      category: "game",
      rank: 1,
      workType: "",
      priceJpy: null,
    },
    {
      productId: "RJ100002",
      imageUrl: "https://img.example/RJ100002.jpg",
      circle: "Circle",
      floor: "home",
      period: "week",
      category: "game",
      rank: 2,
      workType: "ADV",
      priceJpy: 1200,
    },
  ];

  const enriched = await enrichRankingItems(items, {
    fetchProductInfo: async ({ ids }) => {
      requestedIds.push(...ids);
      return {
        RJ100001: {
          work_name: "Fetched",
          work_image: "//img.example/RJ100001.jpg",
          maker_name: "Fetched Circle",
          site_id: "home",
          work_type: "ADV",
          price: 1000,
        },
      };
    },
    minDelayMs: 0,
  });

  assert.deepEqual(requestedIds, ["RJ100001"]);
  assert.equal(enriched[0].title, "Fetched");
  assert.equal(enriched[0].priceJpy, 1000);
  assert.equal(enriched[1].productId, "RJ100002");
});

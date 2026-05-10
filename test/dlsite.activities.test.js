import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  absoluteUrl,
  classifyActivityBenefit,
  fetchDlsiteActivities,
  parseActivityDetailHtml,
  parseActivityBannerPayload,
  parseLegacyActivityBannerPayload,
} from "../src/lib/monitor/dlsiteActivities.js";

test("parses official DLsite campaign banner payloads", () => {
  const items = parseActivityBannerPayload(
    {
      banners: [
        {
          banner_id: 7303,
          priority: 1,
          path: "images/dlsite/jajp/maniax/banner.jpg",
          link: "/maniax/campaign/bulkbuy/=/key/example",
          alt: "[maniax]初夏の3本60%OFFセット割",
          title: "[maniax]初夏の3本60%OFFセット割",
          start_datetime: "2026-05-08 14:00:00",
          end_datetime: "2026-05-13 13:59:59",
        },
      ],
    },
    {
      sourceKey: "campaign",
      sourceUrl: "https://media.vivion-bcs.com/data.json",
      slot: "main",
    }
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].activityId, "dlsite:7303");
  assert.equal(items[0].benefitType, "discount");
  assert.equal(items[0].imageUrl, "https://media.vivion-bcs.com/images/dlsite/jajp/maniax/banner.jpg");
  assert.equal(items[0].url, "https://www.dlsite.com/maniax/campaign/bulkbuy/=/key/example");
  assert.equal(items[0].startsAt, "2026-05-08T05:00:00.000Z");
  assert.equal(items[0].endsAt, "2026-05-13T04:59:59.000Z");
});

test("parses legacy BCS activity payloads", () => {
  const items = parseLegacyActivityBannerPayload({
    data: {
      "dlsite-doujin_maniax_center2-allcampaign": {
        banners: [
          {
            banner_id: "76733",
            ssl_path: "//media.dlsite.com/bcs/banner.jpg",
            link: "https://www.dlsite.com/maniax/fsr/=/custom_genres%5B0%5D/20260501coupon2030",
            title: "1作品で20％OFF、2作品以上で30％OFFクーポン配布中",
          },
        ],
      },
    },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].activityId, "dlsite:76733");
  assert.equal(items[0].benefitType, "coupon");
  assert.equal(items[0].imageUrl, "https://media.dlsite.com/bcs/banner.jpg");
});

test("parses DLsite activity detail HTML fixture", () => {
  const html = fs.readFileSync(new URL("./fixtures/dlsite-activity-detail.html", import.meta.url), "utf8");
  const detail = parseActivityDetailHtml(html, {
    title: "30%OFFクーポンキャンペーン",
    url: "https://www.dlsite.com/maniax/campaign/example",
  });

  assert.equal(detail.status, "parsed");
  assert.match(detail.summary, /クーポン配布/);
  assert.match(detail.claimCondition, /ログイン後/);
  assert.match(detail.applicableScope, /音声・ASMR/);
  assert.equal(detail.endsAt, "2026-05-31T14:59:59.000Z");
  assert.equal(detail.requiresLogin, true);
  assert.equal(detail.isLimited, true);
});

test("fetchDlsiteActivities falls back to legacy data when official sources fail", async () => {
  const calls = [];
  const payload = await fetchDlsiteActivities({
    sources: [{ key: "campaign", slot: "main", url: "https://official.example/data.json" }],
    fetcher: async (url) => {
      calls.push(url);
      if (url.includes("official")) throw new Error("offline");
      return {
        data: {
          "dlsite-doujin_maniax_center2-allcampaign": {
            banners: [
              {
                banner_id: "900",
                path: "//media.dlsite.com/bcs/fallback.jpg",
                link: "https://www.dlsite.com/maniax/campaign/discount?key=fallback",
                title: "fallback sale",
              },
            ],
          },
        },
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].activityId, "dlsite:900");
  assert.equal(payload.errors[0].source, "campaign");
});

test("fetchDlsiteActivities keeps activities when detail fetching fails or is skipped", async () => {
  const detailCalls = [];
  const payload = await fetchDlsiteActivities({
    includeDetails: true,
    sources: [{ key: "campaign", slot: "main", url: "https://official.example/data.json" }],
    fetcher: async () => ({
      banners: [
        {
          banner_id: "campaign",
          title: "Campaign detail",
          link: "https://www.dlsite.com/maniax/campaign/example",
        },
        {
          banner_id: "discount",
          title: "Discount detail",
          link: "https://www.dlsite.com/home/discount/example",
        },
        {
          banner_id: "bulkbuy",
          title: "Bulkbuy detail",
          link: "https://www.dlsite.com/maniax/bulkbuy/example",
        },
        {
          banner_id: "fsr",
          title: "FSR detail",
          link: "https://www.dlsite.com/maniax/fsr/=/example",
        },
        {
          banner_id: "external",
          title: "External feature",
          link: "https://special.example/campaign",
        },
      ],
    }),
    detailFetcher: async (url) => {
      detailCalls.push(url);
      throw new Error("detail offline");
    },
  });

  assert.equal(payload.items.length, 5);
  assert.equal(detailCalls.length, 3);
  assert.equal(payload.items.find((item) => item.activityId === "dlsite:campaign").details.status, "failed");
  assert.equal(payload.items.find((item) => item.activityId === "dlsite:fsr").details.status, "fallback");
  assert.equal(payload.items.find((item) => item.activityId === "dlsite:external").details.status, "external");
  assert.match(payload.items.find((item) => item.activityId === "dlsite:campaign").details.summary, /仍可正常显示/);
});

test("classifies benefit types and normalizes absolute URLs", () => {
  assert.equal(classifyActivityBenefit({ title: "ポイント10%還元" }), "point");
  assert.equal(classifyActivityBenefit({ title: "30%OFFクーポン" }), "coupon");
  assert.equal(classifyActivityBenefit({ title: "期間限定 無料" }), "free");
  assert.equal(classifyActivityBenefit({ title: "プレゼント抽選" }), "bonus");
  assert.equal(classifyActivityBenefit({ title: "ジャンルセール" }), "discount");
  assert.equal(classifyActivityBenefit({ title: "新作ピックアップ" }), "info");
  assert.equal(absoluteUrl("//img.example/banner.jpg"), "https://img.example/banner.jpg");
});

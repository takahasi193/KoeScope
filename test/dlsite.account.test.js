import assert from "node:assert/strict";
import test from "node:test";
import {
  importDlsiteAccountPages,
  normalizeDlsiteCookieHeader,
  parseAccountPointsHtml,
  parseAccountWorksHtml,
} from "../src/lib/dlsiteAccount.js";

test("normalizes DLsite cookie headers", () => {
  assert.equal(
    normalizeDlsiteCookieHeader("Cookie: __DLsite_SID=abc;\n login=1; ignored"),
    "__DLsite_SID=abc; login=1"
  );
  assert.throws(() => normalizeDlsiteCookieHeader("not a cookie"), /扩展同步/);
});

test("parses account points from localized point pages", () => {
  const html = `
    <main>
      <section class="point_balance">
        <h1>保有ポイント</h1>
        <strong>1,234 pt</strong>
      </section>
    </main>
  `;
  assert.equal(parseAccountPointsHtml(html), 1234);
});

test("parses account work list snippets", () => {
  const html = `
    <ul>
      <li class="worklist_item" data-product_id="RJ500001">
        <a class="work_name" href="/home/work/=/product_id/RJ500001.html" title="Account Work">Account Work</a>
        <a class="maker_name" href="/home/circle/profile/=/maker_id/RG500.html">Circle</a>
        <span class="work_price">770円</span>
        <span class="strike">1,100円</span>
        <span class="icon_campaign">30%OFF</span>
        <img src="//img.example/RJ500001.jpg" />
      </li>
    </ul>
  `;
  const items = parseAccountWorksHtml(html, {
    type: "wishlist",
    floor: "home",
    url: "https://www.dlsite.com/home/mypage/wishlist",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].productId, "RJ500001");
  assert.equal(items[0].title, "Account Work");
  assert.equal(items[0].circle, "Circle");
  assert.equal(items[0].priceJpy, 770);
  assert.equal(items[0].officialPriceJpy, 1100);
  assert.equal(items[0].discountRate, 30);
});

test("imports account pages fetched by the browser extension", () => {
  const calls = [];
  const repository = {
    saveAccountSyncResult(payload) {
      calls.push(payload);
      return {
        hasSession: true,
        displayName: payload.displayName,
        pointsJpy: payload.pointsJpy,
        loginState: payload.loginState,
        lists: {
          wishlist: { count: payload.lists.find((list) => list.type === "wishlist")?.items.length ?? 0 },
        },
      };
    },
  };

  const payload = importDlsiteAccountPages(repository, {
    pages: [
      {
        type: "point",
        sourceUrl: "https://www.dlsite.com/home/mypage",
        finalUrl: "https://www.dlsite.com/home/mypage",
        html: "<main><div>保有ポイント 2,345 pt</div><strong>tester 様</strong></main>",
      },
      {
        type: "wishlist",
        sourceUrl: "https://www.dlsite.com/home/mypage/wishlist",
        finalUrl: "https://www.dlsite.com/home/mypage/wishlist",
        html: `
          <li class="worklist_item" data-product_id="RJ600001">
            <a class="work_name" href="/home/work/=/product_id/RJ600001.html">Wish Work</a>
            <span class="work_price">990円</span>
          </li>
        `,
      },
    ],
  });

  assert.equal(payload.profile.hasSession, true);
  assert.equal(payload.profile.pointsJpy, 2345);
  assert.equal(calls[0].loginState, "active");
  assert.equal(calls[0].syncMode, "full");
  assert.equal(calls[0].lists[0].fullSync, true);
  assert.equal(calls[0].lists[0].items[0].productId, "RJ600001");
});

test("imports all captured purchase pages for one account source", () => {
  const calls = [];
  const repository = {
    saveAccountSyncResult(payload) {
      calls.push(payload);
      return {
        hasSession: true,
        pointsJpy: payload.pointsJpy,
        loginState: payload.loginState,
        lists: {},
      };
    },
  };

  const allPurchasesUrl = "https://www.dlsite.com/maniax/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/1";
  importDlsiteAccountPages(repository, {
    pages: [
      {
        type: "point",
        sourceUrl: "https://www.dlsite.com/home/mypage",
        finalUrl: "https://www.dlsite.com/home/mypage",
        html: "<main><div>保有ポイント 10 pt</div></main>",
      },
      {
        type: "collection",
        floor: "maniax",
        sourceUrl: allPurchasesUrl,
        finalUrl: allPurchasesUrl,
        html: `
          <li class="worklist_item" data-product_id="RJ700001">
            <a class="work_name" href="/maniax/work/=/product_id/RJ700001.html">Owned One</a>
          </li>
        `,
      },
      {
        type: "collection",
        floor: "maniax",
        sourceUrl: allPurchasesUrl,
        finalUrl: "https://www.dlsite.com/maniax/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/2",
        html: `
          <li class="worklist_item" data-product_id="RJ700002">
            <a class="work_name" href="/maniax/work/=/product_id/RJ700002.html">Owned Two</a>
          </li>
        `,
      },
    ],
  });

  const collection = calls[0].lists.find((list) => list.type === "collection" && list.floor === "maniax");
  assert.equal(collection.fetchedPages, 2);
  assert.equal(collection.fullSync, true);
  assert.deepEqual(
    collection.items.map((item) => item.productId),
    ["RJ700001", "RJ700002"]
  );
});

test("marks quick account imports as partial when the extension stops at an incremental boundary", () => {
  const calls = [];
  const repository = {
    saveAccountSyncResult(payload) {
      calls.push(payload);
      return {
        hasSession: true,
        pointsJpy: payload.pointsJpy,
        loginState: payload.loginState,
        lists: {},
      };
    },
  };

  const payload = importDlsiteAccountPages(repository, {
    syncMode: "quick",
    pages: [
      {
        type: "point",
        sourceUrl: "https://www.dlsite.com/home/mypage",
        finalUrl: "https://www.dlsite.com/home/mypage",
        html: "<main><div>保有ポイント 10 pt</div></main>",
      },
      {
        type: "wishlist",
        floor: "maniax",
        sourceUrl: "https://www.dlsite.com/maniax/mypage/wishlist",
        finalUrl: "https://www.dlsite.com/maniax/mypage/wishlist",
        fullSync: false,
        incrementalBoundary: true,
        html: `
          <li class="worklist_item" data-product_id="RJ800001">
            <a class="work_name" href="/maniax/work/=/product_id/RJ800001.html">Known Wish</a>
          </li>
        `,
      },
    ],
  });

  const wishlist = calls[0].lists.find((list) => list.type === "wishlist" && list.floor === "maniax");
  assert.equal(calls[0].syncMode, "quick");
  assert.equal(calls[0].raw.syncMode, "quick");
  assert.equal(wishlist.fullSync, false);
  assert.equal(payload.lists.find((list) => list.type === "wishlist" && list.floor === "maniax").fullSync, false);
});

test("rejects imported login pages without clearing cached account data", () => {
  let saved = false;
  const repository = {
    saveAccountSyncResult() {
      saved = true;
    },
  };

  assert.throws(
    () =>
      importDlsiteAccountPages(repository, {
        pages: [
          {
            type: "point",
            sourceUrl: "https://www.dlsite.com/home/mypage",
            finalUrl: "https://www.dlsite.com/home/regist/user",
            html: '<form class="login_form"><input name="login_id" /></form>',
          },
        ],
      }),
    /Chrome/
  );
  assert.equal(saved, false);
});

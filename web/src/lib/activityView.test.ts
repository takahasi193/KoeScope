import assert from "node:assert/strict";
import test from "node:test";
import { accountLine, activityQuery, activityStats, personalSummaryLine } from "./activityView";

test("activity query preserves existing API filters without changing field names", () => {
  assert.equal(
    activityQuery({ status: "unread", benefit: "coupon", search: "ASMR", relatedOnly: true, limit: 40 }),
    "/api/activities?status=unread&benefit=coupon&search=ASMR&related=1&limit=40"
  );
});

test("activity summary wording stays conservative about account eligibility", () => {
  const payload = {
    account: { hasSession: true, pointsJpy: 1200, isStale: false },
    personalSummary: {
      relatedWorks: { totalMatches: 2, claimsEntitlement: false }
    },
    items: [{ benefitType: "point" }, { benefitType: "coupon" }],
    unreadCount: 1
  };

  assert.match(accountLine(payload), /1,200 pt/);
  assert.match(personalSummaryLine(payload), /可能相关/);
  assert.deepEqual(activityStats(payload), {
    resultCount: 2,
    unreadCount: 1,
    matchCount: 2,
    pointCount: 1
  });
});

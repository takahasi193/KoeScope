import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNotificationItems,
  normalizeBackendBase,
  notificationIdFor,
  selectNewNotificationItems,
} from "../extension/notificationPolling.js";

test("extension notification polling combines price and activity reminders", () => {
  const items = buildNotificationItems({
    alertsPayload: {
      items: [
        {
          id: 91,
          type: "target_price",
          productId: "RJ100001",
          title: "Rain ASMR",
          message: "Rain ASMR reached target price.",
          createdAt: "2026-05-12T00:00:00.000Z",
        },
      ],
    },
    activitySummary: {
      unreadCount: 1,
      items: [
        {
          id: 7,
          activityId: "dlsite:campaign",
          type: "ending_soon",
          message: "Campaign ends soon.",
          activityTitle: "Campaign",
        },
      ],
    },
  });

  assert.deepEqual(
    items.map((item) => item.key),
    ["price:91", "activity:7:ending_soon"]
  );
  assert.equal(items[0].title, "KoeScope price reminder");
  assert.equal(items[1].source, "activity");
  assert.match(notificationIdFor(items[1]), /^koescope-activity-7-ending_soon/);
});

test("extension notification polling dedupes unread alerts and tracks backend state", () => {
  const first = selectNewNotificationItems(
    [{ key: "price:1" }, { key: "activity:2:new_activity" }],
    {},
    { nowIso: "2026-05-12T00:00:00.000Z" }
  );

  assert.equal(first.newItems.length, 2);
  assert.deepEqual(first.nextState.notifiedKeys, ["price:1", "activity:2:new_activity"]);
  assert.equal(first.nextState.lastUnreadCount, 2);

  const second = selectNewNotificationItems(
    [{ key: "price:1" }, { key: "activity:2:new_activity" }, { key: "price:3" }],
    first.nextState,
    { nowIso: "2026-05-12T00:05:00.000Z" }
  );

  assert.deepEqual(
    second.newItems.map((item) => item.key),
    ["price:3"]
  );
  assert.equal(second.nextState.lastCheckedAt, "2026-05-12T00:05:00.000Z");
});

test("extension notification polling accepts only local backend URLs", () => {
  assert.equal(normalizeBackendBase("http://127.0.0.1:5178/"), "http://127.0.0.1:5178");
  assert.equal(normalizeBackendBase("https://example.com"), "http://localhost:5178");
});

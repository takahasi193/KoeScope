import assert from "node:assert/strict";
import test from "node:test";
import {
  activityReminderBadgeText,
  activityReminderCopy,
  normalizeActivityReminderSummary,
  unavailableActivityReminderSummary,
} from "../extension/activityReminders.js";

test("extension activity reminder summary normalizes unread alert counts", () => {
  const summary = normalizeActivityReminderSummary({
    unreadCount: 12,
    activeActivities: 5,
    endingSoonActivities: 2,
    typeCounts: { new_activity: 7, ending_soon: 5 },
    items: [
      {
        id: 1,
        type: "new_activity",
        message: "新活动：Point Present",
        activityTitle: "Point Present",
        benefitLabel: "点数",
      },
      {
        id: 2,
        type: "ending_soon",
        message: "即将结束：Coupon",
      },
    ],
  });

  assert.equal(summary.available, true);
  assert.equal(summary.hasUnread, true);
  assert.equal(summary.unreadCount, 12);
  assert.equal(summary.newActivityAlerts, 7);
  assert.equal(summary.endingSoonAlerts, 5);
  assert.equal(summary.items[0].activityTitle, "Point Present");
  assert.equal(activityReminderBadgeText(summary), "12");

  const copy = activityReminderCopy(summary);
  assert.equal(copy.tone, "alert");
  assert.equal(copy.status, "12 条未读");
  assert.match(copy.body, /新活动/);
});

test("extension activity reminder badge caps large counts and clears empty counts", () => {
  assert.equal(activityReminderBadgeText(normalizeActivityReminderSummary({ unreadCount: 100 })), "99+");
  assert.equal(activityReminderBadgeText(normalizeActivityReminderSummary({ unreadCount: 0 })), "");
});

test("extension activity reminder summary degrades when backend is unavailable", () => {
  const summary = unavailableActivityReminderSummary("backend_unavailable", "fetch failed");
  const copy = activityReminderCopy(summary);

  assert.equal(summary.available, false);
  assert.equal(summary.hasUnread, false);
  assert.equal(activityReminderBadgeText(summary), "");
  assert.equal(copy.tone, "muted");
  assert.match(copy.body, /搜索和账号同步/);
});

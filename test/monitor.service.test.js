import assert from "node:assert/strict";
import test from "node:test";
import { createDlsiteMonitor, prioritizeTargets } from "../src/lib/monitor/service.js";

test("prioritizeTargets moves the visible dashboard target to the front", () => {
  const targets = [
    { floor: "home", period: "day", category: "all" },
    { floor: "home", period: "day", category: "voice" },
    { floor: "home", period: "week", category: "all" },
    { floor: "home", period: "week", category: "game" },
    { floor: "maniax", period: "week", category: "game" },
  ];

  const prioritized = prioritizeTargets(targets, {
    floor: "home",
    period: "week",
    category: "game",
  });

  assert.deepEqual(prioritized[0], { floor: "home", period: "week", category: "game" });
  assert.deepEqual(
    prioritized.map((target) => `${target.floor}/${target.period}/${target.category}`).sort(),
    targets.map((target) => `${target.floor}/${target.period}/${target.category}`).sort()
  );
});

test("monitor status recovers interrupted running sync rows", () => {
  let latestRun = {
    id: 3,
    status: "running",
    startedAt: "2026-05-09T00:00:00.000Z",
    progress: { completedTargets: 10, totalTargets: 24 },
    error: "",
  };
  const repository = {
    getLatestSyncRun: () => latestRun,
    getSyncRun: () => latestRun,
    updateSyncRun: (_id, patch) => {
      latestRun = {
        ...latestRun,
        ...patch,
        finishedAt: "2026-05-09T00:10:00.000Z",
      };
      return latestRun;
    },
    close: () => {},
  };

  const monitor = createDlsiteMonitor({ repository });
  const status = monitor.getStatus();

  assert.equal(status.running, false);
  assert.equal(status.latestRun.status, "failed");
  assert.equal(status.latestRun.error, "同步被中断或服务已重启。");
});

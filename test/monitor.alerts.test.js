import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePriceAlert } from "../src/lib/monitor/alerts.js";

test("evaluatePriceAlert creates a watched price drop alert at default threshold", () => {
  const alert = evaluatePriceAlert({
    productId: "RJ100001",
    title: "Quiet Voice",
    previousPriceJpy: 2000,
    currentPriceJpy: 1400,
  });

  assert.equal(alert.type, "price_drop");
  assert.equal(alert.previousPriceJpy, 2000);
  assert.equal(alert.currentPriceJpy, 1400);
});

test("evaluatePriceAlert ignores small price changes", () => {
  const alert = evaluatePriceAlert({
    productId: "RJ100001",
    previousPriceJpy: 2000,
    currentPriceJpy: 1800,
  });

  assert.equal(alert, null);
});

test("evaluatePriceAlert creates target price alert when crossing target", () => {
  const alert = evaluatePriceAlert({
    productId: "RJ100001",
    previousPriceJpy: 1800,
    currentPriceJpy: 1200,
    targetPriceJpy: 1300,
  });

  assert.equal(alert.type, "target_price");
  assert.equal(alert.targetPriceJpy, 1300);
});

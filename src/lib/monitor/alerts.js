export const PRICE_DROP_PERCENT_THRESHOLD = 20;
export const PRICE_DROP_AMOUNT_THRESHOLD = 500;

function toPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

export function evaluatePriceAlert({
  productId,
  title,
  previousPriceJpy,
  currentPriceJpy,
  targetPriceJpy,
}) {
  const previousPrice = toPrice(previousPriceJpy);
  const currentPrice = toPrice(currentPriceJpy);
  const targetPrice = toPrice(targetPriceJpy);

  if (!productId || currentPrice === null) return null;

  if (
    targetPrice !== null &&
    currentPrice <= targetPrice &&
    (previousPrice === null || previousPrice > targetPrice)
  ) {
    return {
      type: "target_price",
      previousPriceJpy: previousPrice,
      currentPriceJpy: currentPrice,
      targetPriceJpy: targetPrice,
      message: `${title || productId} reached target price ${targetPrice.toLocaleString("ja-JP")}円.`,
    };
  }

  if (previousPrice === null || previousPrice <= currentPrice) return null;

  const dropAmount = previousPrice - currentPrice;
  const dropPercent = previousPrice > 0 ? (dropAmount / previousPrice) * 100 : 0;
  if (dropAmount < PRICE_DROP_AMOUNT_THRESHOLD && dropPercent < PRICE_DROP_PERCENT_THRESHOLD) {
    return null;
  }

  return {
    type: "price_drop",
    previousPriceJpy: previousPrice,
    currentPriceJpy: currentPrice,
    targetPriceJpy: targetPrice,
    message: `${title || productId} dropped ${dropAmount.toLocaleString("ja-JP")}円 (${dropPercent.toFixed(0)}%).`,
  };
}

export function alertFingerprint(productId, alert) {
  return [
    productId,
    alert.type,
    alert.previousPriceJpy ?? "",
    alert.currentPriceJpy ?? "",
    alert.targetPriceJpy ?? "",
  ].join(":");
}

/**
 * Supertrend Indicator
 * Powerful trend-following indicator based on ATR and a multiplier.
 * Creates clear support/resistance bounds.
 */
export function computeSupertrend(candles, period = 10, multiplier = 3) {
  if (candles.length <= period) return null;

  const atrArray = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const tr1 = candles[i].high - candles[i].low;
    const tr2 = Math.abs(candles[i].high - candles[i-1].close);
    const tr3 = Math.abs(candles[i].low - candles[i-1].close);
    const tr = Math.max(tr1, tr2, tr3);
    
    if (i === 1) {
      atrArray[i] = tr;
    } else {
      atrArray[i] = ((atrArray[i-1] * (period - 1)) + tr) / period;
    }
  }

  let upperBand = 0;
  let lowerBand = 0;
  let supertrend = 0;
  let trend = 1; 

  let prevUpperBand = 0;
  let prevLowerBand = 0;
  let prevTrend = 1;

  for (let i = period; i < candles.length; i++) {
    const atr = atrArray[i];
    const hl2 = (candles[i].high + candles[i].low) / 2;
    upperBand = hl2 + (multiplier * atr);
    lowerBand = hl2 - (multiplier * atr);

    if (i === period) {
       prevUpperBand = upperBand;
       prevLowerBand = lowerBand;
       prevTrend = 1;
       continue;
    }

    if (candles[i-1].close <= prevUpperBand) upperBand = Math.min(upperBand, prevUpperBand);
    if (candles[i-1].close >= prevLowerBand) lowerBand = Math.max(lowerBand, prevLowerBand);

    if (prevTrend === 1 && candles[i].close < lowerBand) trend = -1;
    else if (prevTrend === -1 && candles[i].close > upperBand) trend = 1;
    else trend = prevTrend;

    supertrend = trend === 1 ? lowerBand : upperBand;

    prevUpperBand = upperBand;
    prevLowerBand = lowerBand;
    prevTrend = trend;
  }

  const currentCandle = candles[candles.length - 1];
  const distancePct = ((currentCandle.close - supertrend) / supertrend) * 100;
  
  return {
    value: supertrend,
    trend: trend === 1 ? "UP" : "DOWN",
    distancePct
  };
}

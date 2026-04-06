/**
 * Compute EMA for a series of values.
 */
export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;

  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/**
 * Compute full EMA series.
 */
export function emaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];

  const k = 2 / (period + 1);
  const result = [];

  // SMA for first value
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  result.push(prev);

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }

  return result;
}

/**
 * Detect EMA crossover signals.
 * Returns { signal, fastEma, slowEma }
 * signal: "GOLDEN_CROSS", "DEATH_CROSS", or "NONE"
 */
export function detectEmaCross(closes, fastPeriod = 9, slowPeriod = 21) {
  if (!Array.isArray(closes) || closes.length < slowPeriod + 2) {
    return { signal: "NONE", fastEma: null, slowEma: null };
  }

  const fastSeries = emaSeries(closes, fastPeriod);
  const slowSeries = emaSeries(closes, slowPeriod);

  if (fastSeries.length < 2 || slowSeries.length < 2) {
    return { signal: "NONE", fastEma: null, slowEma: null };
  }

  // Align both series to the same length
  const minLen = Math.min(fastSeries.length, slowSeries.length);
  const fastAligned = fastSeries.slice(fastSeries.length - minLen);
  const slowAligned = slowSeries.slice(slowSeries.length - minLen);

  const currentFast = fastAligned[fastAligned.length - 1];
  const currentSlow = slowAligned[slowAligned.length - 1];
  const prevFast = fastAligned[fastAligned.length - 2];
  const prevSlow = slowAligned[slowAligned.length - 2];

  let signal = "NONE";
  if (prevFast <= prevSlow && currentFast > currentSlow) signal = "GOLDEN_CROSS";
  if (prevFast >= prevSlow && currentFast < currentSlow) signal = "DEATH_CROSS";

  return { signal, fastEma: currentFast, slowEma: currentSlow, distance: currentFast - currentSlow };
}

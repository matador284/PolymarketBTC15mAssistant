import { sma } from "./rsi.js";

/**
 * Compute Bollinger Bands for a series of closes.
 * Returns { upper, middle, lower, bandwidth, percentB } for the last value.
 */
export function computeBollingerBands(closes, period = 20, stdDevMul = 2) {
  if (!Array.isArray(closes) || closes.length < period) return null;

  const slice = closes.slice(closes.length - period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;

  const variance = slice.reduce((acc, v) => acc + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDevMul * stdDev;
  const lower = middle - stdDevMul * stdDev;

  const lastClose = closes[closes.length - 1];
  const bandwidth = middle !== 0 ? (upper - lower) / middle : 0;
  const percentB = upper !== lower ? (lastClose - lower) / (upper - lower) : 0.5;

  return { upper, middle, lower, bandwidth, percentB, stdDev };
}

/**
 * Compute Bollinger Bands series for all candles (for squeeze detection, etc).
 */
export function computeBBSeries(closes, period = 20, stdDevMul = 2) {
  const series = [];
  for (let i = 0; i < closes.length; i++) {
    if (i + 1 < period) {
      series.push(null);
      continue;
    }
    series.push(computeBollingerBands(closes.slice(0, i + 1), period, stdDevMul));
  }
  return series;
}

/**
 * Detect Bollinger Band squeeze (low bandwidth → potential breakout)
 */
export function detectBBSqueeze(closes, period = 20, stdDevMul = 2, lookback = 20) {
  if (closes.length < period + lookback) return null;

  const recentBBs = [];
  for (let i = closes.length - lookback; i <= closes.length; i++) {
    const bb = computeBollingerBands(closes.slice(0, i), period, stdDevMul);
    if (bb) recentBBs.push(bb);
  }

  if (recentBBs.length < 5) return null;

  const bandwidths = recentBBs.map(b => b.bandwidth);
  const avgBw = bandwidths.reduce((a, b) => a + b, 0) / bandwidths.length;
  const currentBw = bandwidths[bandwidths.length - 1];

  const isSqueeze = currentBw < avgBw * 0.7;
  const isExpansion = currentBw > avgBw * 1.3;

  return { isSqueeze, isExpansion, currentBw, avgBw, ratio: currentBw / avgBw };
}

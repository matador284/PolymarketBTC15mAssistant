/**
 * Rate of Change (ROC) — momentum oscillator.
 */
export function computeRoc(closes, period = 5) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  if (past === 0) return null;
  return ((current - past) / past) * 100;
}

/**
 * Average True Range (ATR) — volatility measurement.
 */
export function computeAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  // Simple ATR: average of last `period` true ranges
  const slice = trueRanges.slice(trueRanges.length - period);
  const atr = slice.reduce((a, b) => a + b, 0) / period;

  // Normalized ATR as percentage of price
  const lastClose = candles[candles.length - 1].close;
  const atrPct = lastClose > 0 ? (atr / lastClose) * 100 : 0;

  return { atr, atrPct };
}

/**
 * Simple momentum: speed of delta over last N bars.
 */
export function computeMomentum(closes, period = 5) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  const recent = closes.slice(closes.length - period - 1);
  const momentum = recent[recent.length - 1] - recent[0];
  const acceleration = recent.length >= 3
    ? (recent[recent.length - 1] - recent[recent.length - 2]) - (recent[1] - recent[0])
    : null;
  return { momentum, acceleration };
}

/**
 * Volume spike detection: compares recent volume to average volume.
 */
export function detectVolumeSpike(candles, recentBars = 3, avgBars = 30) {
  if (!Array.isArray(candles) || candles.length < avgBars) return null;

  const recentVol = candles.slice(-recentBars).reduce((a, c) => a + c.volume, 0) / recentBars;
  const avgVol = candles.slice(-avgBars).reduce((a, c) => a + c.volume, 0) / avgBars;

  if (avgVol === 0) return { ratio: 0, isSpike: false };

  const ratio = recentVol / avgVol;
  return { ratio, isSpike: ratio > 1.8, recentVol, avgVol };
}

/**
 * Price velocity: rate of price change per bar.
 */
export function computeVelocity(closes, lookback = 5) {
  if (!Array.isArray(closes) || closes.length < lookback + 1) return null;
  const recent = closes.slice(-lookback - 1);
  const firstPrice = recent[0];
  const lastPrice = recent[recent.length - 1];
  if (firstPrice === 0) return null;
  return ((lastPrice - firstPrice) / firstPrice) * 100;
}

import { CONFIG } from "../config.js";

/**
 * Macro Analyzer
 * Analyzes Daily and Weekly trends to provide a long-term bias.
 */
export function analyzeMacroTrend(klines1d, klines1w) {
  if (!klines1d.length || !klines1w.length) return { bias: "NEUTRAL", weight: 0 };

  const last1d = klines1d[klines1d.length - 1];
  const last1w = klines1w[klines1w.length - 1];

  // 1D EMA check (Simple Trend)
  const ema20_1d = computeEma(klines1d.map(k => k.close), 20);
  const ema50_1d = computeEma(klines1d.map(k => k.close), 50);
  
  let dTrend = "NEUTRAL";
  if (last1d.close > ema20_1d && ema20_1d > ema50_1d) dTrend = "BULLISH";
  if (last1d.close < ema20_1d && ema20_1d < ema50_1d) dTrend = "BEARISH";

  // 1W RSI check
  const rsi1w = computeRsi(klines1w.map(k => k.close), 14);
  let wTrend = "NEUTRAL";
  if (rsi1w > 60) wTrend = "BULLISH";
  if (rsi1w < 40) wTrend = "BEARISH";

  // Combined Bias
  let bias = "NEUTRAL";
  let weight = 0;

  if (dTrend === "BULLISH" && wTrend === "BULLISH") {
    bias = "STRONG_BULLISH";
    weight = 0.05; // Add 5% to UP confidence
  } else if (dTrend === "BEARISH" && wTrend === "BEARISH") {
    bias = "STRONG_BEARISH";
    weight = -0.05; // Subtract 5% from UP confidence (add to DOWN)
  } else if (dTrend === "BULLISH") {
    bias = "BULLISH";
    weight = 0.02;
  } else if (dTrend === "BEARISH") {
    bias = "BEARISH";
    weight = -0.02;
  }

  return {
    bias,
    biasValue: weight,
    dTrend,
    wTrend,
    rsi1w: rsi1w?.toFixed(1),
    ema20_1d: ema20_1d?.toFixed(0)
  };
}

function computeEma(data, period) {
  if (data.length < period) return data[data.length-1];
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeRsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[closes.length - 1 - period + i] - closes[closes.length - 2 - period + i];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

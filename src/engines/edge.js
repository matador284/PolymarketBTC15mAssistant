import { clamp } from "../utils.js";

export function computeEdge({ modelUp, modelDown, marketYes, marketNo }) {
  if (marketYes === null || marketNo === null) {
    return { marketUp: null, marketDown: null, edgeUp: null, edgeDown: null };
  }

  const sum = marketYes + marketNo;
  const marketUp = sum > 0 ? marketYes / sum : null;
  const marketDown = sum > 0 ? marketNo / sum : null;

  const edgeUp = marketUp === null ? null : modelUp - marketUp;
  const edgeDown = marketDown === null ? null : modelDown - marketDown;

  return {
    marketUp: marketUp === null ? null : clamp(marketUp, 0, 1),
    marketDown: marketDown === null ? null : clamp(marketDown, 0, 1),
    edgeUp,
    edgeDown
  };
}

/**
 * Decision engine optimized for 5-minute markets.
 * More aggressive thresholds since 5m windows are faster-paced.
 */
export function decide({
  remainingMinutes,
  edgeUp,
  edgeDown,
  modelUp = null,
  modelDown = null,
  confidence = null,
  indicatorCount = 0,
  windowMinutes = 5,
  regime = null
}) {
  // Phase determination for 5min markets
  const timeRatio = remainingMinutes / windowMinutes;
  const phase = timeRatio > 0.6 ? "EARLY" : timeRatio > 0.2 ? "MID" : "LATE";

  // ──── THRESHOLDS adapted for 5m markets ────
  // Shorter window = accept lower edge but require higher confidence
  const edgeThreshold = phase === "EARLY" ? 0.04 : phase === "MID" ? 0.06 : 0.12;
  const minProb = phase === "EARLY" ? 0.55 : phase === "MID" ? 0.58 : 0.62;

  // Minimum active indicators to trust the signal
  const minIndicators = phase === "LATE" ? 4 : 3;

  if (edgeUp === null || edgeDown === null) {
    return { action: "NO_TRADE", side: null, phase, reason: "missing_market_data", strength: null, edge: null };
  }

  const bestSide = edgeUp > edgeDown ? "UP" : "DOWN";
  const bestEdge = bestSide === "UP" ? edgeUp : edgeDown;
  const bestModel = bestSide === "UP" ? modelUp : modelDown;

  // ──── TREND FILTER (Avoid counter-trading strong trends unless edge is very high) ────
  // Se o lucro esperado (edge) for > 15%, permitimos operar contra a tendência (Mean Reversion)
  if (bestSide === "DOWN" && regime === "TREND_UP" && bestEdge < 0.15) {
    return { action: "NO_TRADE", side: null, phase, reason: "anti_trend_up (edge_low)", strength: null, edge: bestEdge };
  }
  if (bestSide === "UP" && regime === "TREND_DOWN" && bestEdge < 0.15) {
    return { action: "NO_TRADE", side: null, phase, reason: "anti_trend_down (edge_low)", strength: null, edge: bestEdge };
  }
  
  if (regime === "CHOP" && bestEdge < 0.25) {
    return { action: "NO_TRADE", side: null, phase, reason: "chop_market_danger", strength: null, edge: bestEdge };
  }
  // SQUEEZE é diferente de CHOP — pode explodir. Permite entrada se edge >= 0.12
  if (regime === "SQUEEZE" && bestEdge < 0.12) {
    return { action: "NO_TRADE", side: null, phase, reason: "squeeze_low_edge", strength: null, edge: bestEdge };
  }

  // ──── FILTERS ────
  if (remainingMinutes < 0.3) {
    return { action: "NO_TRADE", side: null, phase, reason: "too_late", strength: null, edge: bestEdge };
  }

  if (indicatorCount > 0 && indicatorCount < minIndicators) {
    return { action: "NO_TRADE", side: null, phase, reason: `insufficient_indicators (${indicatorCount}/${minIndicators})`, strength: null, edge: bestEdge };
  }

  if (bestEdge < edgeThreshold) {
    return { action: "NO_TRADE", side: null, phase, reason: `edge_below_${edgeThreshold.toFixed(2)}`, strength: null, edge: bestEdge };
  }

  if (bestModel !== null && bestModel < minProb) {
    return { action: "NO_TRADE", side: null, phase, reason: `prob_below_${minProb.toFixed(2)}`, strength: null, edge: bestEdge };
  }

  // ──── STRENGTH CLASSIFICATION ────
  let strength;
  if (bestEdge >= 0.20) strength = "STRONG";
  else if (bestEdge >= 0.12) strength = "GOOD";
  else if (bestEdge >= 0.06) strength = "MODERATE";
  else strength = "WEAK";

  // Boost strength if confidence is high
  if (confidence !== null && confidence > 0.5 && strength === "MODERATE") {
    strength = "GOOD";
  }

  return {
    action: "ENTER",
    side: bestSide,
    phase,
    strength,
    edge: bestEdge,
    confidence,
    reason: `edge=${bestEdge.toFixed(3)} model=${bestModel?.toFixed(3) ?? "-"}`
  };
}

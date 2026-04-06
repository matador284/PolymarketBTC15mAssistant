import { clamp } from "../utils.js";

/**
 * Advanced scoring engine with weighted multi-indicator fusion.
 * Optimized for 5-minute windows: faster, more aggressive scoring.
 */
export function scoreDirection(inputs) {
  const {
    price,
    vwap,
    vwapSlope,
    rsi,
    rsiSlope,
    macd,
    heikenColor,
    heikenCount,
    failedVwapReclaim,
    // New indicators
    bbData,       // Bollinger Bands data
    emaCross,     // EMA crossover data
    roc,          // Rate of change
    momentum,     // Momentum + acceleration
    volumeSpike,  // Volume spike data
    atr,          // ATR data
    bbSqueeze,    // Bollinger squeeze detected
    velocity,     // Price velocity
    stochRsi,     // Stochastic RSI data
    supertrend    // Supertrend data
  } = inputs;

  let up = 0;
  let down = 0;

  // ──── 1. VWAP POSITION (weight: 3) ────
  if (price !== null && vwap !== null) {
    const dist = (price - vwap) / vwap;
    if (dist > 0.001) up += 3;
    else if (dist < -0.001) down += 3;
    else { up += 1; down += 1; } // neutral zone
  }

  // ──── 2. VWAP SLOPE (weight: 2) ────
  if (vwapSlope !== null) {
    if (vwapSlope > 0) up += 2;
    if (vwapSlope < 0) down += 2;
  }

  // ──── 3. RSI + RSI SLOPE (weight: 3) ────
  if (rsi !== null) {
    if (rsi >= 60) up += 2;
    else if (rsi >= 55 && rsiSlope > 0) up += 2;
    else if (rsi <= 40) down += 2;
    else if (rsi <= 45 && rsiSlope < 0) down += 2;

    // Overbought/oversold reversal signals
    if (rsi >= 75) down += 1; // potential reversal
    if (rsi <= 25) up += 1;   // potential reversal
  }
  if (rsiSlope !== null) {
    if (rsiSlope > 0.5) up += 1;
    if (rsiSlope < -0.5) down += 1;
  }

  // ──── 4. MACD (weight: 3) ────
  if (macd?.hist !== null && macd?.histDelta !== null) {
    const expandingBull = macd.hist > 0 && macd.histDelta > 0;
    const expandingBear = macd.hist < 0 && macd.histDelta < 0;
    const convergingBull = macd.hist < 0 && macd.histDelta > 0; // about to cross up
    const convergingBear = macd.hist > 0 && macd.histDelta < 0; // about to cross down

    if (expandingBull) up += 3;
    if (expandingBear) down += 3;
    if (convergingBull) up += 2;
    if (convergingBear) down += 2;

    if (macd.macd > 0) up += 1;
    if (macd.macd < 0) down += 1;
  }

  // ──── 5. HEIKEN ASHI (weight: 2) ────
  if (heikenColor) {
    if (heikenColor === "green") {
      up += Math.min(heikenCount, 3);
    }
    if (heikenColor === "red") {
      down += Math.min(heikenCount, 3);
    }
  }

  // ──── 6. FAILED VWAP RECLAIM (weight: 3) ────
  if (failedVwapReclaim === true) down += 3;

  // ──── 7. BOLLINGER BANDS (weight: 3) ────
  if (bbData) {
    const { percentB } = bbData;
    if (percentB > 0.9) {
      up += 2;   // near upper band, strong trend
      down += 1; // but also overbought risk
    }
    if (percentB < 0.1) {
      down += 2;
      up += 1;   // oversold bounce risk
    }
    if (percentB > 0.6 && percentB <= 0.9) up += 1;
    if (percentB < 0.4 && percentB >= 0.1) down += 1;
  }

  // ──── 8. BB SQUEEZE → BREAKOUT BOOST (weight: 2) ────
  if (bbSqueeze?.isSqueeze) {
    // Squeeze detected: amplify directional signal
    if (up > down) up += 2;
    else if (down > up) down += 2;
  }

  // ──── 9. EMA CROSSOVER (weight: 4 — very strong for 5m) ────
  if (emaCross) {
    if (emaCross.signal === "GOLDEN_CROSS") up += 4;
    if (emaCross.signal === "DEATH_CROSS") down += 4;

    // EMA distance as trend strength
    if (emaCross.distance !== undefined && emaCross.distance !== null) {
      if (emaCross.distance > 0) up += 1;
      if (emaCross.distance < 0) down += 1;
    }
  }

  // ──── 10. RATE OF CHANGE (weight: 2) ────
  if (roc !== null && Number.isFinite(roc)) {
    if (roc > 0.05) up += 2;
    else if (roc > 0.01) up += 1;
    if (roc < -0.05) down += 2;
    else if (roc < -0.01) down += 1;
  }

  // ──── 11. MOMENTUM + ACCELERATION (weight: 2) ────
  if (momentum) {
    if (momentum.momentum > 0) up += 1;
    if (momentum.momentum < 0) down += 1;

    // Acceleration: is the move getting faster?
    if (momentum.acceleration !== null) {
      if (momentum.acceleration > 0 && momentum.momentum > 0) up += 1;
      if (momentum.acceleration < 0 && momentum.momentum < 0) down += 1;
    }
  }

  // ──── 12. VOLUME SPIKE (weight: 2) ────
  if (volumeSpike?.isSpike) {
    // High volume validates the direction
    if (up > down) up += 2;
    else if (down > up) down += 2;
    else { up += 1; down += 1; }
  }

  // ──── 13. VELOCITY (weight: 2) ────
  if (velocity !== null && Number.isFinite(velocity)) {
    if (velocity > 0.02) up += 2;
    else if (velocity > 0.005) up += 1;
    if (velocity < -0.02) down += 2;
    else if (velocity < -0.005) down += 1;
  }

  // ──── 14. STOCHASTIC RSI (weight: 3) ────
  if (stochRsi) {
    if (stochRsi.signal === "BULLISH") up += 3;
    else if (stochRsi.signal === "BEARISH") down += 3;
    else if (stochRsi.signal === "OVERSOLD" || stochRsi.k < 15) { up += 2; down -= 5; } // Block shorts at bottom
    else if (stochRsi.signal === "OVERBOUGHT" || stochRsi.k > 85) { down += 2; up -= 5; } // Block longs at top
  }

  // ──── 15. SUPERTREND (weight: 4) ────
  if (supertrend) {
    if (supertrend.trend === "UP") up += 4;
    else if (supertrend.trend === "DOWN") down += 4;
    
    // Proximity to Supertrend line as strength
    if (supertrend.distancePct > 0.05) up += 1;
    if (supertrend.distancePct < -0.05) down += 1;
  }

  // ──── NORMALIZE E PREVINE VALORES NEGATIVOS ────
  up = Math.max(0, up);
  down = Math.max(0, down);
  
  const total = up + down;
  const rawUp = total > 0 ? up / total : 0.5;

  // Confidence: how far from 50/50
  const confidence = Math.abs(rawUp - 0.5) * 2;

  return {
    upScore: up,
    downScore: down,
    rawUp,
    confidence,
    indicatorCount: countActiveIndicators(inputs)
  };
}

function countActiveIndicators(inputs) {
  let count = 0;
  if (inputs.price !== null && inputs.vwap !== null) count++;
  if (inputs.vwapSlope !== null) count++;
  if (inputs.rsi !== null) count++;
  if (inputs.macd?.hist !== null) count++;
  if (inputs.heikenColor) count++;
  if (inputs.bbData) count++;
  if (inputs.emaCross?.signal) count++;
  if (inputs.roc !== null) count++;
  if (inputs.momentum) count++;
  if (inputs.volumeSpike) count++;
  if (inputs.velocity !== null) count++;
  return count;
}

/**
 * Apply time-awareness for 5min markets.
 * Adapted for shorter window: less aggressive decay early, sharper late.
 */
export function applyTimeAwareness(rawUp, remainingMinutes, windowMinutes) {
  // For 5m windows: more aggressive scoring throughout
  const normalizedTime = clamp(remainingMinutes / windowMinutes, 0, 1);

  // Non-linear time decay: strong signal early matters, very late it diminishes
  // Quadratic: keeps signal strong in the first ~3 minutes, then sharp decay
  const timeDecay = clamp(normalizedTime ** 0.7, 0.15, 1.0);

  const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
  return {
    timeDecay,
    adjustedUp,
    adjustedDown: 1 - adjustedUp,
    phase: normalizedTime > 0.6 ? "EARLY" : normalizedTime > 0.2 ? "MID" : "LATE"
  };
}

export function detectRegime({ price, vwap, vwapSlope, vwapCrossCount, volumeRecent, volumeAvg, atr, bbSqueeze }) {
  if (price === null || vwap === null || vwapSlope === null) return { regime: "CHOP", reason: "missing_inputs", volatility: "UNKNOWN" };

  const above = price > vwap;
  const distPct = Math.abs((price - vwap) / vwap);

  // Volatility assessment using ATR
  let volatility = "NORMAL";
  if (atr?.atrPct !== undefined) {
    if (atr.atrPct > 0.3) volatility = "HIGH";
    else if (atr.atrPct < 0.08) volatility = "LOW";
  }

  // BB Squeeze = compression = potential breakout
  if (bbSqueeze?.isSqueeze) {
    return { regime: "SQUEEZE", reason: "bb_compression", volatility };
  }

  // Low volume chop
  const lowVolume = volumeRecent !== null && volumeAvg !== null ? volumeRecent < 0.6 * volumeAvg : false;
  if (lowVolume && distPct < 0.001) {
    return { regime: "CHOP", reason: "low_volume_flat", volatility };
  }

  // Strong trend
  if (above && vwapSlope > 0 && distPct > 0.001) {
    return { regime: "TREND_UP", reason: "price_above_vwap_slope_up", volatility };
  }

  if (!above && vwapSlope < 0 && distPct > 0.001) {
    return { regime: "TREND_DOWN", reason: "price_below_vwap_slope_down", volatility };
  }

  // High volatility + expansion
  if (bbSqueeze?.isExpansion && volatility === "HIGH") {
    return { regime: above ? "BREAKOUT_UP" : "BREAKOUT_DOWN", reason: "bb_expansion_high_vol", volatility };
  }

  // Frequent crossovers = range
  if (vwapCrossCount !== null && vwapCrossCount >= 3) {
    return { regime: "RANGE", reason: "frequent_vwap_cross", volatility };
  }

  return { regime: "RANGE", reason: "default", volatility };
}

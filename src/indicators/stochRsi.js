/**
 * Computes Stochastic RSI to determine overbought/oversold conditions in fast markets.
 */
export function computeStochRsi(rsiValues, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
  if (rsiValues.length < stochPeriod + kPeriod + dPeriod) return null;

  const stochRsiRaw = [];
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const window = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const max = Math.max(...window);
    const min = Math.min(...window);
    const val = max === min ? 0 : ((rsiValues[i] - min) / (max - min)) * 100;
    stochRsiRaw.push(val);
  }

  function sma(arr, period) {
    const res = [];
    for (let i = period - 1; i < arr.length; i++) {
      res.push(arr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
    }
    return res;
  }

  const kValues = sma(stochRsiRaw, kPeriod);
  if (kValues.length < dPeriod) return null;
  
  const dValues = sma(kValues, dPeriod);
  const k = kValues[kValues.length - 1];
  const d = dValues[dValues.length - 1];

  let signal = "NEUTRAL";
  if (k > 80 && d > 80) signal = "OVERBOUGHT";
  else if (k < 20 && d < 20) signal = "OVERSOLD";
  else if (k > d && k < 80 && d < 80) signal = "BULLISH";
  else if (k < d && k > 20 && d > 20) signal = "BEARISH";

  return { k, d, signal };
}

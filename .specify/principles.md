# Principles - Polymarket BTC 5m Bot

## 1. Capital Protection First
- **Stop Loss:** No single trade should ever risk more than 10% of the allocated balance.
- **Exposure:** Maximum of 1 active trade at any given time.

## 2. Decision Integrity
- **Multiple Confirmations:** Never enter a trade based on a single indicator (requires at least 8).
- **Edge Trap Filter:** Avoid "too good to be true" signals (Edge > 0.5) to avoid false breakouts.

## 3. Market Awareness
- **Regime Filtering:** Adapt strategy when in 'Squeeze' or highly volatile regimes.
- **Timing:** Primary entry window: between 1 and 4.5 minutes of the 5m candle.

## 4. Code Robustness
- **Dry-Run Safety:** Mode defaults to simulation.
- **Reliable Networking:** Fallbacks for Chainlink prices to Polymarket WS / Binance.

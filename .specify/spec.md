# Spec - Polymarket BTC 5m Bot

## 1. Functional Specification
- **Symbol:** BTC/USD
- **Resolution:** 5 Minutes
- **Execution Engine:** Polymarket CLOB (via `@polymarket/clob-client`)
- **Mode:** Automated High-Frequency (HFT) Decision Making

## 2. Decision Logic
### Indicators (15+)
- **Trend:** Heiken Ashi (5m), VWAP, EMA Cross, Supertrend.
- **Oscillators:** StochRSI (14), RSI (9), MACD (12,26,9), ROC (12).
- **Volume/Volatility:** Volume Spike, ATR, Bollinger Bands, BB Squeeze.
- **Momentum:** Velocity, Price Delta (1m/3m).

### Entry Criteria
- **Signal Weight:** Weighted sum of indicators (Confidence score 0-1).
- **Thresholds:** Min Confidence 82% (Sniper) - 75% (Radical).
- **Filters:** Rejects signals with excessive Edge (> 0.5) to avoid traps.

## 3. Data Integration
- **Klines:** Fetching from Polymarket Gamma API (1m and 5m).
- **Live Price:** Real-time stream from Binance (primary spot) + Chainlink (reference).
- **Market Detection:** Automatic identification of the current live 5m market on Polymarket.

## 4. Operational Safety
- **Settlement Guard:** Stops active trading and displays 'WAITING' when the current 5m market ends and the next hasn't opened.
- **Onboarding:** (Manual) Configuration of CLOB API Key, Secret, and Passphrase in `.env`.
- **Logging:** All decisions and trades saved to `logs/signals.csv` and `logs/auto_trades.csv`.

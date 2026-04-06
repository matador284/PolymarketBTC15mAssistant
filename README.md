# Polymarket BTC 5m Assistant

A real-time console trading assistant for Polymarket **"Bitcoin Up or Down" 5-minute** markets.

## Features

### 📊 13 Technical Indicators
- **VWAP** — Volume Weighted Average Price + slope analysis
- **RSI** — Relative Strength Index with slope detection
- **MACD** — Moving Average Convergence Divergence with histogram expansion/convergence
- **Heiken Ashi** — Smoothed candlestick pattern recognition
- **Bollinger Bands** — Bandwidth, %B, and **squeeze detection** for breakout signals
- **EMA Crossover** — Fast/Slow EMA crossing (Golden Cross / Death Cross)
- **Rate of Change (ROC)** — Momentum oscillator
- **ATR** — Average True Range volatility measurement
- **Momentum + Acceleration** — Speed and acceleration of price moves
- **Volume Spike** — Detects unusual volume for signal validation
- **Price Velocity** — Rate of price change per bar
- **Delta 1m/3m** — Short-term price delta analysis
- **Failed VWAP Reclaim** — Bearish reversal pattern

### 🧠 Intelligent Decision Engine
- **Phase-Adaptive Thresholds** — Different confidence requirements for EARLY/MID/LATE phases
- **Weighted Multi-Indicator Fusion** — Each indicator contributes proportionally
- **Regime Detection** — TREND_UP/DOWN, BREAKOUT, SQUEEZE, RANGE, CHOP
- **Non-linear Time Decay** — Optimized for 5-minute windows
- **Confidence Scoring** — Visual confidence bar with percentage

### ⚡ Auto-Trade System
- **Configurable via Environment Variables** — Set your amount, confidence, edge thresholds
- **Dry-Run Mode** — Simulate trades without risking capital (default: ON)
- **Multi-Filter Pipeline** — Confidence, edge, time window, cooldown, per-market limits
- **CSV Trade Logging** — All trades logged to `./logs/auto_trades.csv`
- **Live Trading** — Placeholder for Polymarket CLOB API integration

### 📡 Data Sources
- Polymarket live WS (Chainlink BTC/USD price feed from Polymarket UI)
- On-chain Chainlink fallback (Polygon via HTTP/WSS RPC)
- Binance spot price for reference
- Polymarket CLOB order book + prices

## Requirements

- Node.js **18+** (https://nodejs.org/en)
- npm (comes with Node)

## Quick Start

```bash
git clone https://github.com/FrondEnt/PolymarketBTC15mAssistant.git
cd PolymarketBTC15mAssistant
npm install
npm start
```

## Configuration

All configuration is via environment variables.

### Polymarket

| Variable | Default | Description |
|---------|---------|-------------|
| `POLYMARKET_AUTO_SELECT_LATEST` | `true` | Auto-pick the latest 5m market |
| `POLYMARKET_SERIES_SLUG` | `btc-up-or-down-5m` | Series slug for 5m markets |
| `POLYMARKET_SERIES_ID` | _(empty)_ | Series ID (optional) |
| `POLYMARKET_SLUG` | _(empty)_ | Pin a specific market |
| `POLYMARKET_LIVE_WS_URL` | `wss://ws-live-data.polymarket.com` | Live data WebSocket |

### Auto-Trade Settings

| Variable | Default | Description |
|---------|---------|-------------|
| `AUTO_TRADE_ENABLED` | `false` | Enable auto-trade engine |
| `AUTO_TRADE_AMOUNT_USD` | `0` | Amount in USD per trade |
| `AUTO_TRADE_MIN_CONFIDENCE` | `0.62` | Minimum model confidence (0-1) |
| `AUTO_TRADE_MIN_EDGE` | `0.08` | Minimum edge over market |
| `AUTO_TRADE_MIN_TIME_LEFT` | `1.0` | Min time remaining (minutes) |
| `AUTO_TRADE_MAX_TIME_LEFT` | `4.5` | Max time remaining (minutes) |
| `AUTO_TRADE_MAX_PER_MARKET` | `1` | Max trades per market cycle |
| `AUTO_TRADE_COOLDOWN_MS` | `60000` | Cooldown between trades (ms) |
| `AUTO_TRADE_DRY_RUN` | `true` | Dry-run mode (simulate only) |

### Quick Auto-Trade Setup (PowerShell)

```powershell
# Enable auto-trade in DRY-RUN mode (recommended to test first)
$env:AUTO_TRADE_ENABLED = "true"
$env:AUTO_TRADE_AMOUNT_USD = "10"
$env:AUTO_TRADE_DRY_RUN = "true"
$env:AUTO_TRADE_MIN_CONFIDENCE = "0.62"
$env:AUTO_TRADE_MIN_EDGE = "0.08"
npm start
```

### Quick Auto-Trade Setup (CMD)

```cmd
set AUTO_TRADE_ENABLED=true
set AUTO_TRADE_AMOUNT_USD=10
set AUTO_TRADE_DRY_RUN=true
set AUTO_TRADE_MIN_CONFIDENCE=0.62
set AUTO_TRADE_MIN_EDGE=0.08
npm start
```

### Chainlink on Polygon (fallback)

| Variable | Default |
|---------|---------|
| `CHAINLINK_BTC_USD_AGGREGATOR` | `0xc907E116054Ad103354f2D350FD2514433D57F6f` |
| `POLYGON_RPC_URL` | `https://polygon-rpc.com` |
| `POLYGON_RPC_URLS` | _(empty, comma-separated)_ |
| `POLYGON_WSS_URL` | _(empty)_ |
| `POLYGON_WSS_URLS` | _(empty, comma-separated)_ |

### Proxy Support

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:8080"
# or
$env:ALL_PROXY = "socks5://127.0.0.1:1080"
```

## Run

```bash
npm start
```

### Stop

Press `Ctrl + C` in the terminal.

## Architecture

```
src/
├── config.js              # Configuration (env vars)
├── index.js               # Main loop + display
├── utils.js               # Utilities
├── data/
│   ├── binance.js         # Binance REST API
│   ├── binanceWs.js       # Binance WebSocket stream
│   ├── chainlink.js       # Chainlink HTTP RPC
│   ├── chainlinkWs.js     # Chainlink WSS stream
│   ├── polymarket.js      # Polymarket API (5m support)
│   └── polymarketLiveWs.js # Polymarket live WebSocket
├── indicators/
│   ├── bollingerBands.js  # Bollinger Bands + squeeze detection
│   ├── emaCross.js        # EMA crossover detection
│   ├── heikenAshi.js      # Heiken Ashi candles
│   ├── macd.js            # MACD indicator
│   ├── momentum.js        # ROC, ATR, Momentum, Volume Spike, Velocity
│   ├── rsi.js             # RSI + SMA + Slope
│   └── vwap.js            # VWAP + VWAP series
├── engines/
│   ├── autoTrade.js       # Auto-trade engine
│   ├── edge.js            # Edge computation + decision engine
│   ├── probability.js     # Multi-indicator scoring
│   └── regime.js          # Market regime detection
└── net/
    └── proxy.js           # Proxy support
```

## Safety

⚠️ This is not financial advice. Use at your own risk.

- Always test with `AUTO_TRADE_DRY_RUN=true` first
- Auto-trade is disabled by default
- Review all simulated trades before enabling live mode

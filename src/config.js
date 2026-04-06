export const CONFIG = {
  symbol: "BTCUSDT",
  binanceBaseUrl: "https://api.binance.com",
  gammaBaseUrl: "https://gamma-api.polymarket.com",
  clobBaseUrl: "https://clob.polymarket.com",

  pollIntervalMs: 1_000,
  candleWindowMinutes: 5,

  vwapSlopeLookbackMinutes: 3,
  rsiPeriod: 14,
  rsiMaPeriod: 14,

  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,

  // Bollinger Bands
  bbPeriod: 20,
  bbStdDev: 2,

  // EMA crossover
  emaFast: 9,
  emaSlow: 21,

  // Momentum / ROC
  rocPeriod: 5,

  // ATR
  atrPeriod: 14,
  
  // Stochastic RSI
  stochRsiPeriod: 14,
  stochRsiK: 3,
  stochRsiD: 3,

  // Supertrend
  supertrendPeriod: 10,
  supertrendMultiplier: 3,

  polymarket: {
    marketSlug: process.env.POLYMARKET_SLUG || "",
    seriesId: process.env.POLYMARKET_SERIES_ID || "",
    seriesSlug: process.env.POLYMARKET_SERIES_SLUG || "btc-up-or-down-5m",
    autoSelectLatest: (process.env.POLYMARKET_AUTO_SELECT_LATEST || "true").toLowerCase() === "true",
    liveDataWsUrl: process.env.POLYMARKET_LIVE_WS_URL || "wss://ws-live-data.polymarket.com",
    upOutcomeLabel: process.env.POLYMARKET_UP_LABEL || "Up",
    downOutcomeLabel: process.env.POLYMARKET_DOWN_LABEL || "Down"
  },

  chainlink: {
    polygonRpcUrls: (process.env.POLYGON_RPC_URLS || "").split(",").map((s) => s.trim()).filter(Boolean),
    polygonRpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    polygonWssUrls: (process.env.POLYGON_WSS_URLS || "").split(",").map((s) => s.trim()).filter(Boolean),
    polygonWssUrl: process.env.POLYGON_WSS_URL || "",
    btcUsdAggregator: process.env.CHAINLINK_BTC_USD_AGGREGATOR || "0xc907E116054Ad103354f2D350FD2514433D57F6f"
  },

  // ──── AUTO-TRADE SETTINGS ────
  autoTrade: {
    enabled: (process.env.AUTO_TRADE_ENABLED || "false").toLowerCase() === "true",
    // Valor em USD para cada entrada automática
    tradeAmountUsd: Number(process.env.AUTO_TRADE_AMOUNT_USD || "0"),
    // Confiança mínima do modelo para entrar (0-1), ex: 0.62 = 62%
    minConfidence: Number(process.env.AUTO_TRADE_MIN_CONFIDENCE || "0.62"),
    // Edge mínimo sobre o mercado para entrar
    minEdge: Number(process.env.AUTO_TRADE_MIN_EDGE || "0.08"),
    // Edge máximo para evitar armadilhas em wicks de 5m
    maxEdge: Number(process.env.AUTO_TRADE_MAX_EDGE || "0.30"),
    // Tempo mínimo restante (minutos) para aceitar entrada
    minTimeLeftMin: Number(process.env.AUTO_TRADE_MIN_TIME_LEFT || "1.0"),
    // Tempo máximo restante: não entra se falta mais que X minutos (evitar early demais)
    maxTimeLeftMin: Number(process.env.AUTO_TRADE_MAX_TIME_LEFT || "4.5"),
    // Maximum número de trades simultâneos por mercado
    maxTradesPerMarket: Number(process.env.AUTO_TRADE_MAX_PER_MARKET || "1"),
    // Cooldown em ms entre trades
    cooldownMs: Number(process.env.AUTO_TRADE_COOLDOWN_MS || "60000"),
    // Modo dry-run: simula mas não executa
    dryRun: (process.env.AUTO_TRADE_DRY_RUN || "true").toLowerCase() === "true",
    // Wallet private key (necessário para trades reais)
    privateKey: process.env.AUTO_TRADE_PRIVATE_KEY || "",
    // CLOB API Keys
    apiKey: process.env.AUTO_TRADE_API_KEY || "",
    apiSecret: process.env.AUTO_TRADE_API_SECRET || "",
    apiPassphrase: process.env.AUTO_TRADE_API_PASSPHRASE || "",
  }
};

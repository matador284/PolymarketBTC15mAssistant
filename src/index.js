import { CONFIG } from "./config.js";
import { fetchKlines, fetchLastPrice } from "./data/binance.js";
import { fetchChainlinkBtcUsd } from "./data/chainlink.js";
import { startChainlinkPriceStream } from "./data/chainlinkWs.js";
import { startPolymarketChainlinkPriceStream } from "./data/polymarketLiveWs.js";
import {
  fetchMarketBySlug,
  fetchLiveEventsBySeriesId,
  flattenEventMarkets,
  pickLatestLiveMarket,
  fetchClobPrice,
  fetchOrderBook,
  summarizeOrderBook
} from "./data/polymarket.js";
import { computeSessionVwap, computeVwapSeries } from "./indicators/vwap.js";
import { computeRsi, sma, slopeLast } from "./indicators/rsi.js";
import { computeMacd } from "./indicators/macd.js";
import { computeHeikenAshi, countConsecutive } from "./indicators/heikenAshi.js";
import { computeBollingerBands, detectBBSqueeze } from "./indicators/bollingerBands.js";
import { detectEmaCross } from "./indicators/emaCross.js";
import { computeRoc, computeAtr, computeMomentum, detectVolumeSpike, computeVelocity } from "./indicators/momentum.js";
import { computeStochRsi } from "./indicators/stochRsi.js";
import { computeSupertrend } from "./indicators/supertrend.js";
import { detectRegime } from "./engines/regime.js";
import { scoreDirection, applyTimeAwareness } from "./engines/probability.js";
import { computeEdge, decide } from "./engines/edge.js";
import { shouldAutoTrade, executeTrade, getAutoTradeStatus, resetMarketState, updateSessionPnL } from "./engines/autoTrade.js";
import { getAIBriefing } from "./engines/aiBriefing.js";
import { getWhaleSentiment } from "./engines/whaleSpy.js";
import { getSelfLearningBias } from "./engines/optimizer.js";
import { analyzeMacroTrend } from "./engines/macro.js";
import { appendCsvRow, formatNumber, formatPct, formatSignedPct, getCandleWindowTiming, sleep } from "./utils.js";
import { startBinanceTradeStream } from "./data/binanceWs.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { applyGlobalProxyFromEnv } from "./net/proxy.js";

function countVwapCrosses(closes, vwapSeries, lookback) {
  if (closes.length < lookback || vwapSeries.length < lookback) return null;
  let crosses = 0;
  for (let i = closes.length - lookback + 1; i < closes.length; i += 1) {
    const prev = closes[i - 1] - vwapSeries[i - 1];
    const cur = closes[i] - vwapSeries[i];
    if (prev === 0) continue;
    if ((prev > 0 && cur < 0) || (prev < 0 && cur > 0)) crosses += 1;
  }
  return crosses;
}

applyGlobalProxyFromEnv();

function fmtTimeLeft(mins) {
  const totalSeconds = Math.max(0, Math.floor(mins * 60));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  lightRed: "\x1b[91m",
  lightGreen: "\x1b[92m",
  lightYellow: "\x1b[93m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  dim: "\x1b[2m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
};

function screenWidth() {
  const w = Number(process.stdout?.columns);
  return Number.isFinite(w) && w >= 40 ? w : 100;
}

function sepLine(ch = "─") {
  const w = screenWidth();
  return `${ANSI.gray}${ch.repeat(w)}${ANSI.reset}`;
}

function sepDoubleLine() {
  const w = screenWidth();
  return `${ANSI.white}${"═".repeat(w)}${ANSI.reset}`;
}

function renderScreen(text) {
  try {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  } catch {
    // ignore
  }
  process.stdout.write(text);
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

function padLabel(label, width) {
  const visible = stripAnsi(label).length;
  if (visible >= width) return label;
  return label + " ".repeat(width - visible);
}

function centerText(text, width) {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  const left = Math.floor((width - visible) / 2);
  const right = width - visible - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

function rightAlign(text, width) {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  return " ".repeat(width - visible) + text;
}

const LABEL_W = 18;
function kv(label, value) {
  const l = padLabel(String(label), LABEL_W);
  return `  ${l}${value}`;
}

function section(title) {
  return `${ANSI.bold}${ANSI.cyan} ◆ ${title}${ANSI.reset}`;
}

function colorPriceLine({ label, price, prevPrice, decimals = 0, prefix = "" }) {
  if (price === null || price === undefined) {
    return `${label}: ${ANSI.gray}-${ANSI.reset}`;
  }

  const p = Number(price);
  const prev = prevPrice === null || prevPrice === undefined ? null : Number(prevPrice);

  let color = ANSI.reset;
  let arrow = "";
  if (prev !== null && Number.isFinite(prev) && Number.isFinite(p) && p !== prev) {
    if (p > prev) {
      color = ANSI.green;
      arrow = " ▲";
    } else {
      color = ANSI.red;
      arrow = " ▼";
    }
  }

  const formatted = `${prefix}${formatNumber(p, decimals)}`;
  return `${label}: ${color}${formatted}${arrow}${ANSI.reset}`;
}

function formatSignedDelta(delta, base) {
  if (delta === null || base === null || base === 0) return `${ANSI.gray}-${ANSI.reset}`;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const pct = (Math.abs(delta) / Math.abs(base)) * 100;
  return `${sign}$${Math.abs(delta).toFixed(2)}, ${sign}${pct.toFixed(2)}%`;
}

function colorByNarrative(text, narrative) {
  if (narrative === "LONG") return `${ANSI.green}${text}${ANSI.reset}`;
  if (narrative === "SHORT") return `${ANSI.red}${text}${ANSI.reset}`;
  return `${ANSI.gray}${text}${ANSI.reset}`;
}

function formatNarrativeValue(label, value, narrative) {
  return `${label}: ${colorByNarrative(value, narrative)}`;
}

function narrativeFromSign(x) {
  if (x === null || x === undefined || !Number.isFinite(Number(x)) || Number(x) === 0) return "NEUTRAL";
  return Number(x) > 0 ? "LONG" : "SHORT";
}

function narrativeFromSlope(slope) {
  if (slope === null || slope === undefined || !Number.isFinite(Number(slope)) || Number(slope) === 0) return "NEUTRAL";
  return Number(slope) > 0 ? "LONG" : "SHORT";
}

function formatProbPct(p, digits = 0) {
  if (p === null || p === undefined || !Number.isFinite(Number(p))) return "-";
  return `${(Number(p) * 100).toFixed(digits)}%`;
}

function fmtEtTime(now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now);
  } catch {
    return "-";
  }
}

function getBtcSession(now = new Date()) {
  const h = now.getUTCHours();
  const inAsia = h >= 0 && h < 8;
  const inEurope = h >= 7 && h < 16;
  const inUs = h >= 13 && h < 22;

  if (inEurope && inUs) return "EU/US Overlap";
  if (inAsia && inEurope) return "Asia/EU Overlap";
  if (inAsia) return "Asia";
  if (inEurope) return "Europe";
  if (inUs) return "US";
  return "Off-hours";
}

function parsePriceToBeat(market) {
  const text = String(market?.question ?? market?.title ?? "");
  if (!text) return null;
  const m = text.match(/price\s*to\s*beat[^\d$]*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const raw = m[1].replace(/,/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const dumpedMarkets = new Set();

function safeFileSlug(x) {
  return String(x ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

function extractNumericFromMarket(market) {
  const directKeys = [
    "priceToBeat", "price_to_beat", "strikePrice", "strike_price",
    "strike", "threshold", "thresholdPrice", "threshold_price",
    "targetPrice", "target_price", "referencePrice", "reference_price"
  ];

  for (const k of directKeys) {
    const v = market?.[k];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return n;
  }

  const seen = new Set();
  const stack = [{ obj: market, depth: 0 }];

  while (stack.length) {
    const { obj, depth } = stack.pop();
    if (!obj || typeof obj !== "object") continue;
    if (seen.has(obj) || depth > 6) continue;
    seen.add(obj);

    const entries = Array.isArray(obj) ? obj.entries() : Object.entries(obj);
    for (const [key, value] of entries) {
      const k = String(key).toLowerCase();
      if (value && typeof value === "object") {
        stack.push({ obj: value, depth: depth + 1 });
        continue;
      }

      if (!/(price|strike|threshold|target|beat)/i.test(k)) continue;

      const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
      if (!Number.isFinite(n)) continue;

      if (n > 1000 && n < 2_000_000) return n;
    }
  }

  return null;
}

function priceToBeatFromPolymarketMarket(market) {
  const n = extractNumericFromMarket(market);
  if (n !== null) return n;
  return parsePriceToBeat(market);
}

const marketCache = {
  market: null,
  fetchedAtMs: 0
};

async function resolveCurrentBtc5mMarket() {
  if (CONFIG.polymarket.marketSlug) {
    return await fetchMarketBySlug(CONFIG.polymarket.marketSlug);
  }

  if (!CONFIG.polymarket.autoSelectLatest) return null;

  const now = Date.now();
  if (marketCache.market && now - marketCache.fetchedAtMs < CONFIG.pollIntervalMs) {
    return marketCache.market;
  }

  let events;
  if (CONFIG.polymarket.seriesId) {
    events = await fetchLiveEventsBySeriesId({ seriesId: CONFIG.polymarket.seriesId, limit: 25 });
  } else {
    events = await fetchLiveEventsBySeriesId({ seriesId: null, limit: 25 });
  }

  const markets = flattenEventMarkets(events);
  const picked = pickLatestLiveMarket(markets);

  marketCache.market = picked;
  marketCache.fetchedAtMs = now;
  return picked;
}

async function fetchPolymarketSnapshot() {
  const market = await resolveCurrentBtc5mMarket();

  if (!market) return { ok: false, reason: "market_not_found" };
  
  // Safeguard: Check if the market is actually closed or past its end date
  const nowMs = Date.now();
  const endMs = market.endDate ? new Date(market.endDate).getTime() : null;
  if (market.closed || market.resolved || (endMs && nowMs >= endMs)) {
    return { ok: false, reason: "market_closed", market };
  }

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : (typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : []);
  const outcomePrices = Array.isArray(market.outcomePrices)
    ? market.outcomePrices
    : (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : []);

  const clobTokenIds = Array.isArray(market.clobTokenIds)
    ? market.clobTokenIds
    : (typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : []);

  let upTokenId = null;
  let downTokenId = null;
  for (let i = 0; i < outcomes.length; i += 1) {
    const label = String(outcomes[i]);
    const tokenId = clobTokenIds[i] ? String(clobTokenIds[i]) : null;
    if (!tokenId) continue;

    if (label.toLowerCase() === CONFIG.polymarket.upOutcomeLabel.toLowerCase()) upTokenId = tokenId;
    if (label.toLowerCase() === CONFIG.polymarket.downOutcomeLabel.toLowerCase()) downTokenId = tokenId;
  }

  const upIndex = outcomes.findIndex((x) => String(x).toLowerCase() === CONFIG.polymarket.upOutcomeLabel.toLowerCase());
  const downIndex = outcomes.findIndex((x) => String(x).toLowerCase() === CONFIG.polymarket.downOutcomeLabel.toLowerCase());

  const gammaYes = upIndex >= 0 ? Number(outcomePrices[upIndex]) : null;
  const gammaNo = downIndex >= 0 ? Number(outcomePrices[downIndex]) : null;

  if (!upTokenId || !downTokenId) {
    return {
      ok: false,
      reason: "missing_token_ids",
      market,
      outcomes,
      clobTokenIds,
      outcomePrices
    };
  }

  let upBuy = null;
  let downBuy = null;
  let upBookSummary = { bestBid: null, bestAsk: null, spread: null, bidLiquidity: null, askLiquidity: null };
  let downBookSummary = { bestBid: null, bestAsk: null, spread: null, bidLiquidity: null, askLiquidity: null };

  try {
    const [yesBuy, noBuy, upBook, downBook] = await Promise.all([
      fetchClobPrice({ tokenId: upTokenId, side: "buy" }),
      fetchClobPrice({ tokenId: downTokenId, side: "buy" }),
      fetchOrderBook({ tokenId: upTokenId }),
      fetchOrderBook({ tokenId: downTokenId })
    ]);

    upBuy = yesBuy;
    downBuy = noBuy;
    upBookSummary = summarizeOrderBook(upBook);
    downBookSummary = summarizeOrderBook(downBook);
  } catch {
    upBuy = null;
    downBuy = null;
    upBookSummary = {
      bestBid: Number(market.bestBid) || null,
      bestAsk: Number(market.bestAsk) || null,
      spread: Number(market.spread) || null,
      bidLiquidity: null,
      askLiquidity: null
    };
    downBookSummary = {
      bestBid: null,
      bestAsk: null,
      spread: Number(market.spread) || null,
      bidLiquidity: null,
      askLiquidity: null
    };
  }

  return {
    ok: true,
    market,
    tokens: { upTokenId, downTokenId },
    prices: {
      up: upBuy ?? gammaYes,
      down: downBuy ?? gammaNo
    },
    orderbook: {
      up: upBookSummary,
      down: downBookSummary
    }
  };
}

// ──── CONFIDENCE BAR ────
function confidenceBar(confidence, width = 20) {
  const filled = Math.round(confidence * width);
  const empty = width - filled;
  const color = confidence > 0.6 ? ANSI.green : confidence > 0.4 ? ANSI.yellow : ANSI.red;
  return `${color}${"█".repeat(filled)}${ANSI.gray}${"░".repeat(empty)}${ANSI.reset}`;
}

// ──── STRENGTH BADGE ────
function strengthBadge(strength) {
  const badges = {
    STRONG: `${ANSI.bgGreen}${ANSI.bold} STRONG ${ANSI.reset}`,
    GOOD: `${ANSI.bgBlue}${ANSI.bold} GOOD ${ANSI.reset}`,
    MODERATE: `${ANSI.bgYellow}${ANSI.bold} MODERATE ${ANSI.reset}`,
    WEAK: `${ANSI.gray}${ANSI.dim} WEAK ${ANSI.reset}`,
  };
  return badges[strength] || `${ANSI.gray}${strength || "-"}${ANSI.reset}`;
}

// ──── REGIME BADGE ────
function regimeBadge(regime) {
  const badges = {
    TREND_UP: `${ANSI.green}▲ TREND UP${ANSI.reset}`,
    TREND_DOWN: `${ANSI.red}▼ TREND DOWN${ANSI.reset}`,
    BREAKOUT_UP: `${ANSI.lightGreen}⚡ BREAKOUT UP${ANSI.reset}`,
    BREAKOUT_DOWN: `${ANSI.lightRed}⚡ BREAKOUT DOWN${ANSI.reset}`,
    SQUEEZE: `${ANSI.magenta}◉ SQUEEZE${ANSI.reset}`,
    RANGE: `${ANSI.yellow}↔ RANGE${ANSI.reset}`,
    CHOP: `${ANSI.gray}≈ CHOP${ANSI.reset}`,
  };
  return badges[regime] || `${ANSI.gray}${regime}${ANSI.reset}`;
}

async function main() {
  const binanceStream = startBinanceTradeStream({ symbol: CONFIG.symbol });
  const polymarketLiveStream = startPolymarketChainlinkPriceStream({});
  const chainlinkStream = startChainlinkPriceStream({});

  let prevSpotPrice = null;
  let prevCurrentPrice = null;
  let priceToBeatState = { slug: null, value: null, setAtMs: null };
  let lastAutoTradeResult = null;

  const header = [
    "timestamp", "entry_minute", "time_left_min", "regime", "signal",
    "model_up", "model_down", "mkt_up", "mkt_down",
    "edge_up", "edge_down", "recommendation", "confidence",
    "macro_bias", "macro_value", "learning_streak", "learning_bias",
    "bb_percentB", "ema_signal", "roc", "velocity", "atr_pct"
  ];

  console.clear();
  console.log(`\n  ${ANSI.bold}${ANSI.cyan}╔══════════════════════════════════════════════╗${ANSI.reset}`);
  console.log(`  ${ANSI.bold}${ANSI.cyan}║   Polymarket BTC 5m Assistant - Starting...  ║${ANSI.reset}`);
  console.log(`  ${ANSI.bold}${ANSI.cyan}╚══════════════════════════════════════════════╝${ANSI.reset}\n`);
  console.log(`  ${ANSI.gray}Window: ${CONFIG.candleWindowMinutes}min | Poll: ${CONFIG.pollIntervalMs}ms${ANSI.reset}`);
  console.log(`  ${ANSI.gray}Series: ${CONFIG.polymarket.seriesSlug}${ANSI.reset}`);
  if (CONFIG.autoTrade.enabled) {
    console.log(`  ${ANSI.yellow}⚡ AUTO-TRADE: ${CONFIG.autoTrade.dryRun ? "DRY-RUN" : "LIVE"} | Amount: $${CONFIG.autoTrade.tradeAmountUsd}${ANSI.reset}`);
  }
  console.log(`  ${ANSI.gray}Connecting to data feeds...${ANSI.reset}\n`);

  await sleep(2000);

  while (true) {
    const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
    await updateSessionPnL();

    const wsTick = binanceStream.getLast();
    const wsPrice = wsTick?.price ?? null;

    const polymarketWsTick = polymarketLiveStream.getLast();
    const polymarketWsPrice = polymarketWsTick?.price ?? null;

    const chainlinkWsTick = chainlinkStream.getLast();
    const chainlinkWsPrice = chainlinkWsTick?.price ?? null;

    try {
      const chainlinkPromise = polymarketWsPrice !== null
        ? Promise.resolve({ price: polymarketWsPrice, updatedAt: polymarketWsTick?.updatedAt ?? null, source: "polymarket_ws" })
        : chainlinkWsPrice !== null
          ? Promise.resolve({ price: chainlinkWsPrice, updatedAt: chainlinkWsTick?.updatedAt ?? null, source: "chainlink_ws" })
          : fetchChainlinkBtcUsd();

      const [klines1m, klines5m, klines1d, klines1w, lastPrice, chainlink, poly, learning] = await Promise.all([
        fetchKlines({ interval: "1m", limit: 240 }),
        fetchKlines({ interval: "5m", limit: 200 }),
        fetchKlines({ interval: "1d", limit: 100 }), // Macro 1D
        fetchKlines({ interval: "1w", limit: 52 }),  // Macro 1W
        fetchLastPrice(),
        chainlinkPromise,
        fetchPolymarketSnapshot(),
        getSelfLearningBias()
      ]);

      const aiBriefing = await getAIBriefing(klines1d, klines1w);
      const whaleData = await getWhaleSentiment(poly.ok ? poly.market?.slug : null);

      if (!poly.ok) {
        const w = screenWidth();
        const waitLines = [
          "",
          `  ${ANSI.bold}${ANSI.cyan}╔${"═".repeat(w - 4)}╗${ANSI.reset}`,
          `  ${ANSI.bold}${ANSI.cyan}║${ANSI.reset}${centerText(`${ANSI.bold}${ANSI.white} POLYMARKET BTC 5m ASSISTANT ${ANSI.reset}`, w - 4)}${ANSI.bold}${ANSI.cyan}║${ANSI.reset}`,
          `  ${ANSI.bold}${ANSI.cyan}╚${"═".repeat(w - 4)}╝${ANSI.reset}`,
          "",
          "",
          centerText(`${ANSI.yellow}${ANSI.bold}⚠️  MERCADO FECHADO / EM TRANSIÇÃO  ⚠️${ANSI.reset}`, w),
          centerText(`${ANSI.gray}Aguardando a abertura do proximo candle de 5 minutos...${ANSI.reset}`, w),
          "",
          "",
          centerText(`${ANSI.cyan}BTC Price: $${formatNumber(lastPrice, 2)}${ANSI.reset}`, w),
          "",
          "",
          centerText(`${ANSI.gray}Motivo: ${poly.reason}${ANSI.reset}`, w),
          "",
          `  ${sepLine()}`,
          centerText(`${ANSI.dim}${ANSI.gray}Tentando reconectar em ${CONFIG.pollIntervalMs / 1000}s...${ANSI.reset}`, w),
          ""
        ];
        renderScreen(waitLines.join("\n"));
        await sleep(CONFIG.pollIntervalMs);
        continue;
      }

      const settlementMs = poly.ok && poly.market?.endDate ? new Date(poly.market.endDate).getTime() : null;
      const settlementLeftMin = settlementMs ? (settlementMs - Date.now()) / 60_000 : null;

      const timeLeftMin = settlementLeftMin ?? timing.remainingMinutes;

      const candles = klines1m;
      const closes = candles.map((c) => c.close);

      // ──── CORE INDICATORS ────
      const vwap = computeSessionVwap(candles);
      const vwapSeries = computeVwapSeries(candles);
      const vwapNow = vwapSeries[vwapSeries.length - 1];

      const lookback = CONFIG.vwapSlopeLookbackMinutes;
      const vwapSlope = vwapSeries.length >= lookback ? (vwapNow - vwapSeries[vwapSeries.length - lookback]) / lookback : null;
      const vwapDist = vwapNow ? (lastPrice - vwapNow) / vwapNow : null;

      const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
      const rsiSeries = [];
      for (let i = 0; i < closes.length; i += 1) {
        const sub = closes.slice(0, i + 1);
        const r = computeRsi(sub, CONFIG.rsiPeriod);
        if (r !== null) rsiSeries.push(r);
      }
      const rsiMa = sma(rsiSeries, CONFIG.rsiMaPeriod);
      const rsiSlope = slopeLast(rsiSeries, 3);

      const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);

      const ha = computeHeikenAshi(candles);
      const consec = countConsecutive(ha);

      const vwapCrossCount = countVwapCrosses(closes, vwapSeries, 20);
      const volumeRecent = candles.slice(-20).reduce((a, c) => a + c.volume, 0);
      const volumeAvg = candles.slice(-120).reduce((a, c) => a + c.volume, 0) / 6;

      const failedVwapReclaim = vwapNow !== null && vwapSeries.length >= 3
        ? closes[closes.length - 1] < vwapNow && closes[closes.length - 2] > vwapSeries[vwapSeries.length - 2]
        : false;

      // ──── ADVANCED INDICATORS ────
      const bbData = computeBollingerBands(closes, CONFIG.bbPeriod, CONFIG.bbStdDev);
      const bbSqueeze = detectBBSqueeze(closes, CONFIG.bbPeriod, CONFIG.bbStdDev, 20);
      const emaCross = detectEmaCross(closes, CONFIG.emaFast, CONFIG.emaSlow);
      const roc = computeRoc(closes, CONFIG.rocPeriod);
      const atr = computeAtr(candles, CONFIG.atrPeriod);
      const momentum = computeMomentum(closes, CONFIG.rocPeriod);
      const volumeSpike = detectVolumeSpike(candles, 3, 30);
      const velocity = computeVelocity(closes, 5);
      const stochRsi = computeStochRsi(rsiSeries, CONFIG.stochRsiPeriod, CONFIG.stochRsiK, CONFIG.stochRsiD);
      const supertrend = computeSupertrend(candles, CONFIG.supertrendPeriod, CONFIG.supertrendMultiplier);

      // ──── REGIME ────
      const regimeInfo = detectRegime({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        vwapCrossCount,
        volumeRecent,
        volumeAvg,
        atr,
        bbSqueeze
      });

      // ──── MACRO & LEARNING ────
      const macro = analyzeMacroTrend(klines1d, klines1w);

      // ──── SCORING ────
      const scored = scoreDirection({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        rsi: rsiNow,
        rsiSlope,
        macd,
        heikenColor: consec.color,
        heikenCount: consec.count,
        failedVwapReclaim,
        bbData,
        emaCross,
        roc,
        momentum,
        volumeSpike,
        atr,
        bbSqueeze,
        velocity,
        stochRsi,
        supertrend,
        macroBias: macro.biasValue,
        learningBias: (learning.upBias || 0) - (learning.downBias || 0),
        aiBias: aiBriefing.bias,
        whaleBias: whaleData.bias
      });

      const timeAware = applyTimeAwareness(scored.rawUp, timeLeftMin, CONFIG.candleWindowMinutes);

      const marketUp = poly.ok ? poly.prices.up : null;
      const marketDown = poly.ok ? poly.prices.down : null;
      const edge = computeEdge({ modelUp: timeAware.adjustedUp, modelDown: timeAware.adjustedDown, marketYes: marketUp, marketNo: marketDown });

      const rec = decide({
        remainingMinutes: timeLeftMin,
        edgeUp: edge.edgeUp,
        edgeDown: edge.edgeDown,
        modelUp: timeAware.adjustedUp,
        modelDown: timeAware.adjustedDown,
        confidence: scored.confidence,
        indicatorCount: scored.indicatorCount,
        windowMinutes: CONFIG.candleWindowMinutes,
        regime: regimeInfo.regime
      });

      // ──── AUTO-TRADE ────
      const tradeCheck = shouldAutoTrade({
        enabled: CONFIG.autoTrade.enabled,
        decision: rec,
        timeLeftMin,
        modelUp: timeAware.adjustedUp,
        modelDown: timeAware.adjustedDown,
        marketSlug: poly.ok ? poly.market?.slug : null,
      });

      if (tradeCheck.trade) {
        const currentPrice = chainlink?.price ?? null;
        const priceToBeat = priceToBeatState.slug === (poly.ok ? poly.market?.slug : null) ? priceToBeatState.value : null;

        lastAutoTradeResult = await executeTrade({
          side: tradeCheck.side,
          amount: tradeCheck.amount,
          edge: tradeCheck.edge,
          confidence: tradeCheck.confidence,
          strength: tradeCheck.strength,
          phase: rec.phase,
          timeLeftMin,
          currentPrice,
          priceToBeat,
          marketSlug: poly.ok ? poly.market?.slug : null,
          tokenId: tradeCheck.side === "UP" ? poly.tokens.upTokenId : poly.tokens.downTokenId,
          outcomePrice: tradeCheck.side === "UP" ? poly.prices.up : poly.prices.down
        });
      }

      const autoTradeStatus = getAutoTradeStatus();

      // ──── BUILD DISPLAY ────
      const vwapSlopeLabel = vwapSlope === null ? "-" : vwapSlope > 0 ? "UP" : vwapSlope < 0 ? "DOWN" : "FLAT";

      const macdLabel = macd === null
        ? "-"
        : macd.hist < 0
          ? (macd.histDelta !== null && macd.histDelta < 0 ? "Bearish ↘" : "Bearish (converging)")
          : (macd.histDelta !== null && macd.histDelta > 0 ? "Bullish ↗" : "Bullish (converging)");

      const lastCandle = klines1m.length ? klines1m[klines1m.length - 1] : null;
      const lastClose = lastCandle?.close ?? null;
      const close1mAgo = klines1m.length >= 2 ? klines1m[klines1m.length - 2]?.close ?? null : null;
      const close3mAgo = klines1m.length >= 4 ? klines1m[klines1m.length - 4]?.close ?? null : null;
      const delta1m = lastClose !== null && close1mAgo !== null ? lastClose - close1mAgo : null;
      const delta3m = lastClose !== null && close3mAgo !== null ? lastClose - close3mAgo : null;

      const haNarrative = (consec.color ?? "").toLowerCase() === "green" ? "LONG" : (consec.color ?? "").toLowerCase() === "red" ? "SHORT" : "NEUTRAL";
      const rsiNarrative = narrativeFromSlope(rsiSlope);
      const macdNarrative = narrativeFromSign(macd?.hist ?? null);
      const vwapNarrative = narrativeFromSign(vwapDist);

      const pLong = timeAware?.adjustedUp ?? null;
      const pShort = timeAware?.adjustedDown ?? null;
      const predictNarrative = (pLong !== null && pShort !== null && Number.isFinite(pLong) && Number.isFinite(pShort))
        ? (pLong > pShort ? "LONG" : pShort > pLong ? "SHORT" : "NEUTRAL")
        : "NEUTRAL";

      const predictValue = `${ANSI.green}LONG${ANSI.reset} ${ANSI.bold}${ANSI.green}${formatProbPct(pLong, 1)}${ANSI.reset} / ${ANSI.red}SHORT${ANSI.reset} ${ANSI.bold}${ANSI.red}${formatProbPct(pShort, 1)}${ANSI.reset}`;

      const marketUpStr = `${marketUp ?? "-"}${marketUp === null || marketUp === undefined ? "" : "¢"}`;
      const marketDownStr = `${marketDown ?? "-"}${marketDown === null || marketDown === undefined ? "" : "¢"}`;
      const polyHeaderValue = `${ANSI.green}↑ UP${ANSI.reset} ${marketUpStr}  |  ${ANSI.red}↓ DOWN${ANSI.reset} ${marketDownStr}`;

      const spotPrice = wsPrice ?? lastPrice;
      const currentPrice = chainlink?.price ?? null;
      const marketSlug = poly.ok ? String(poly.market?.slug ?? "") : "";
      const marketStartMs = poly.ok && poly.market?.eventStartTime ? new Date(poly.market.eventStartTime).getTime() : null;

      if (marketSlug && priceToBeatState.slug !== marketSlug) {
        priceToBeatState = { slug: marketSlug, value: null, setAtMs: null };
        resetMarketState(marketSlug);
      }

      if (priceToBeatState.slug && priceToBeatState.value === null && currentPrice !== null) {
        const nowMs = Date.now();
        const okToLatch = marketStartMs === null ? true : nowMs >= marketStartMs;
        if (okToLatch) {
          priceToBeatState = { slug: priceToBeatState.slug, value: Number(currentPrice), setAtMs: nowMs };
        }
      }

      const priceToBeat = priceToBeatState.slug === marketSlug ? priceToBeatState.value : null;
      const currentPriceBaseLine = colorPriceLine({
        label: "CURRENT PRICE",
        price: currentPrice,
        prevPrice: prevCurrentPrice,
        decimals: 2,
        prefix: "$"
      });

      const ptbDelta = (currentPrice !== null && priceToBeat !== null && Number.isFinite(currentPrice) && Number.isFinite(priceToBeat))
        ? currentPrice - priceToBeat
        : null;
      const ptbDeltaColor = ptbDelta === null
        ? ANSI.gray
        : ptbDelta > 0 ? ANSI.green : ptbDelta < 0 ? ANSI.red : ANSI.gray;
      const ptbDeltaText = ptbDelta === null
        ? `${ANSI.gray}-${ANSI.reset}`
        : `${ptbDeltaColor}${ptbDelta > 0 ? "+" : ptbDelta < 0 ? "-" : ""}$${Math.abs(ptbDelta).toFixed(2)}${ANSI.reset}`;
      const currentPriceValue = currentPriceBaseLine.split(": ")[1] ?? currentPriceBaseLine;
      const currentPriceLine = kv("CURRENT PRICE:", `${currentPriceValue} (${ptbDeltaText})`);

      if (poly.ok && poly.market && priceToBeatState.value === null) {
        const slug = safeFileSlug(poly.market.slug || poly.market.id || "market");
        if (slug && !dumpedMarkets.has(slug)) {
          dumpedMarkets.add(slug);
          try {
            fs.mkdirSync("./logs", { recursive: true });
            fs.writeFileSync(path.join("./logs", `polymarket_market_${slug}.json`), JSON.stringify(poly.market, null, 2), "utf8");
          } catch {
            // ignore
          }
        }
      }

      const binanceSpotBaseLine = colorPriceLine({ label: "BTC (Binance)", price: spotPrice, prevPrice: prevSpotPrice, decimals: 0, prefix: "$" });
      const diffLine = (spotPrice !== null && currentPrice !== null && Number.isFinite(spotPrice) && Number.isFinite(currentPrice) && currentPrice !== 0)
        ? (() => {
          const diffUsd = spotPrice - currentPrice;
          const diffPct = (diffUsd / currentPrice) * 100;
          const sign = diffUsd > 0 ? "+" : diffUsd < 0 ? "-" : "";
          return ` (${sign}$${Math.abs(diffUsd).toFixed(2)}, ${sign}${Math.abs(diffPct).toFixed(2)}%)`;
        })()
        : "";
      const binanceSpotLine = `${binanceSpotBaseLine}${diffLine}`;
      const binanceSpotValue = binanceSpotLine.split(": ")[1] ?? binanceSpotLine;
      const binanceSpotKvLine = kv("BTC (Binance):", binanceSpotValue);

      const titleLine = poly.ok ? `${ANSI.bold}${ANSI.white}${poly.market?.question ?? "-"}${ANSI.reset}` : `${ANSI.gray}No active market found${ANSI.reset}`;

      const liquidity = poly.ok
        ? (Number(poly.market?.liquidityNum) || Number(poly.market?.liquidity) || null)
        : null;

      const timeColor = timeLeftMin >= 3
        ? ANSI.green
        : timeLeftMin >= 1.5
          ? ANSI.yellow
          : timeLeftMin >= 0
            ? ANSI.red
            : ANSI.reset;

      const polyTimeLeftColor = settlementLeftMin !== null
        ? (settlementLeftMin >= 3 ? ANSI.green : settlementLeftMin >= 1.5 ? ANSI.yellow : settlementLeftMin >= 0 ? ANSI.red : ANSI.reset)
        : ANSI.reset;

      // Signal display
      const signalColor = rec.action === "ENTER" ? (rec.side === "UP" ? ANSI.green : ANSI.red) : ANSI.gray;
      const signalText = rec.action === "ENTER"
        ? `${signalColor}${ANSI.bold}⚡ ${rec.side === "UP" ? "BUY UP" : "BUY DOWN"} (${rec.phase}) ${ANSI.reset}${strengthBadge(rec.strength)}`
        : `${ANSI.gray}NO TRADE${ANSI.reset} ${ANSI.dim}(${rec.reason})${ANSI.reset}`;

      // EMA crossover display
      const emaLabel = emaCross?.signal === "GOLDEN_CROSS" ? `${ANSI.green}Golden Cross ↗${ANSI.reset}`
        : emaCross?.signal === "DEATH_CROSS" ? `${ANSI.red}Death Cross ↘${ANSI.reset}`
          : `${ANSI.gray}No cross${ANSI.reset}`;

      // BB display
      const bbLabel = bbData
        ? `%B ${(bbData.percentB * 100).toFixed(0)}% | BW ${(bbData.bandwidth * 100).toFixed(2)}%${bbSqueeze?.isSqueeze ? ` ${ANSI.magenta}⚡SQUEEZE${ANSI.reset}` : ""}`
        : "-";
      const bbNarrative = bbData ? (bbData.percentB > 0.6 ? "LONG" : bbData.percentB < 0.4 ? "SHORT" : "NEUTRAL") : "NEUTRAL";

      // Momentum display
      const velocityLabel = velocity !== null ? `${velocity > 0 ? "+" : ""}${velocity.toFixed(3)}%` : "-";
      const velocityNarrative = narrativeFromSign(velocity);

      // Volume display
      const volLabel = volumeSpike ? `${volumeSpike.ratio.toFixed(1)}x ${volumeSpike.isSpike ? `${ANSI.yellow}⚡SPIKE${ANSI.reset}` : ""}` : "-";

      // Supertrend & StochRSI
      const supertrendLabel = supertrend ? `${supertrend.trend} @ \$${supertrend.value.toFixed(0)} (${supertrend.distancePct > 0 ? "+" : ""}${supertrend.distancePct.toFixed(2)}%)` : "-";
      const supertrendNarrative = supertrend ? supertrend.trend : "NEUTRAL";
      
      const stochRsiLabel = stochRsi ? `K:${stochRsi.k.toFixed(1)} D:${stochRsi.d.toFixed(1)} (${stochRsi.signal})` : "-";
      const stochRsiNarrative = stochRsi ? (stochRsi.signal === "BULLISH" || stochRsi.signal === "OVERSOLD" ? "LONG" : stochRsi.signal === "BEARISH" || stochRsi.signal === "OVERBOUGHT" ? "SHORT" : "NEUTRAL") : "NEUTRAL";

      // Delta display
      const delta1Narrative = narrativeFromSign(delta1m);
      const delta3Narrative = narrativeFromSign(delta3m);
      const deltaValue = `${colorByNarrative(formatSignedDelta(delta1m, lastClose), delta1Narrative)} | ${colorByNarrative(formatSignedDelta(delta3m, lastClose), delta3Narrative)}`;

      // Confidence bar
      const confBarStr = confidenceBar(scored.confidence, 15);

      const tradeStatus = getAutoTradeStatus();

      const w = screenWidth();

      const lines = [
        "",
        `  ${ANSI.bold}${ANSI.cyan}╔${"═".repeat(w - 4)}╗${ANSI.reset}`,
        `  ${ANSI.bold}${ANSI.cyan}║${ANSI.reset}${centerText(`${ANSI.bold}${ANSI.white} POLYMARKET BTC 5m ASSISTANT ${ANSI.reset}`, w - 4)}${ANSI.bold}${ANSI.cyan}║${ANSI.reset}`,
        `  ${ANSI.bold}${ANSI.cyan}╚${"═".repeat(w - 4)}╝${ANSI.reset}`,
        "",
        `  ${titleLine}`,
        kv("Market:", poly.ok ? (poly.market?.slug ?? "-") : "-"),
        kv("Time left:", `${timeColor}${ANSI.bold}${fmtTimeLeft(timeLeftMin)}${ANSI.reset}  ${ANSI.gray}| Phase: ${timeAware.phase}${ANSI.reset}`),
        kv("Macro Context:", `${macro.bias === "STRONG_BULLISH" ? ANSI.green : macro.bias === "STRONG_BEARISH" ? ANSI.red : ANSI.cyan}${macro.bias}${ANSI.reset} ${ANSI.gray}(1D: ${macro.dTrend}, 1W: ${macro.wTrend})${ANSI.reset}`),
        kv("AI Pre-Market:", aiBriefing.enabled ? `${aiBriefing.bias > 0 ? ANSI.green : aiBriefing.bias < 0 ? ANSI.red : ANSI.gray}${aiBriefing.sentiment}${ANSI.reset} ${ANSI.gray}(Bias: ${formatSignedPct(aiBriefing.bias)}) - ${aiBriefing.reasoning}${ANSI.reset}` : `${ANSI.gray}OFF${ANSI.reset}`),
        kv("🐋 Baleias:", whaleData.ok ? `${whaleData.signal.includes("UP") ? ANSI.green : whaleData.signal.includes("DOWN") ? ANSI.red : ANSI.gray}${whaleData.signal}${ANSI.reset} ${ANSI.gray}(UP: $${whaleData.upVolume.toFixed(0)} | DOWN: $${whaleData.downVolume.toFixed(0)} | ${whaleData.whaleCount} baleias)${ANSI.reset}` : `${ANSI.gray}Aguardando dados...${ANSI.reset}`),
        kv("Self-Learning:", `${(learning.upBias || 0) > 0 ? ANSI.green : (learning.downBias || 0) > 0 ? ANSI.red : ANSI.gray}${learning.streak || "OFF"}${ANSI.reset} ${ANSI.gray}(Recent Bias: ${formatSignedPct((learning.upBias || 0) - (learning.downBias || 0))})${ANSI.reset}`),
        kv("Session P&L:", `${tradeStatus.sessionPnl >= 0 ? ANSI.green : ANSI.red}${tradeStatus.sessionPnl >= 0 ? "+" : ""}$${tradeStatus.sessionPnl.toFixed(2)}${ANSI.reset} ${ANSI.gray}(SL: -$${tradeStatus.stopLoss} | TP: +$${tradeStatus.takeProfit})${ANSI.reset}`),
        kv("Win Rate:", `${tradeStatus.winRate}% ${ANSI.gray}(W: ${tradeStatus.wins} | L: ${tradeStatus.losses})${ANSI.reset}`),
        "",
        `  ${sepLine()}`,
        "",
        section("SIGNAL & PREDICTION"),
        "",
        kv("Signal:", signalText),
        kv("TA Predict:", predictValue),
        kv("Confidence:", `${confBarStr} ${ANSI.bold}${(scored.confidence * 100).toFixed(0)}%${ANSI.reset}  ${ANSI.gray}(${scored.indicatorCount} indicators)${ANSI.reset}`),
        kv("Regime:", `${regimeBadge(regimeInfo.regime)} ${ANSI.gray}| Vol: ${regimeInfo.volatility}${ANSI.reset}`),
        "",
        `  ${sepLine()}`,
        "",
        section("TECHNICAL ANALYSIS"),
        "",
        kv("Heiken Ashi:", colorByNarrative(`${consec.color ?? "-"} x${consec.count}`, haNarrative)),
        kv("RSI:", colorByNarrative(`${formatNumber(rsiNow, 1)} ${rsiSlope !== null && rsiSlope > 0 ? "↗" : rsiSlope !== null && rsiSlope < 0 ? "↘" : "→"}`, rsiNarrative)),
        kv("MACD:", colorByNarrative(macdLabel, macdNarrative)),
        kv("EMA Cross:", emaLabel),
        kv("Bollinger:", colorByNarrative(bbLabel, bbNarrative)),
        kv("VWAP:", colorByNarrative(`${formatNumber(vwapNow, 0)} (${formatPct(vwapDist, 2)}) | slope: ${vwapSlopeLabel}`, vwapNarrative)),
        kv("Supertrend:", colorByNarrative(supertrendLabel, supertrendNarrative)),
        kv("Delta 1m/3m:", deltaValue),
        kv("Velocity:", colorByNarrative(velocityLabel, velocityNarrative)),
        kv("Volume:", volLabel),
        kv("StochRSI:", colorByNarrative(stochRsiLabel, stochRsiNarrative)),
        atr ? kv("ATR:", `$${atr.atr.toFixed(2)} (${atr.atrPct.toFixed(3)}%)`) : null,
        "",
        `  ${sepLine()}`,
        "",
        section("POLYMARKET"),
        "",
        kv("Prices:", polyHeaderValue),
        liquidity !== null ? kv("Liquidity:", `$${formatNumber(liquidity, 0)}`) : null,
        settlementLeftMin !== null ? kv("Settle in:", `${polyTimeLeftColor}${fmtTimeLeft(settlementLeftMin)}${ANSI.reset}`) : null,
        priceToBeat !== null ? kv("PRICE TO BEAT:", `${ANSI.bold}$${formatNumber(priceToBeat, 2)}${ANSI.reset}`) : kv("PRICE TO BEAT:", `${ANSI.gray}-${ANSI.reset}`),
        currentPriceLine,
        edge.edgeUp !== null ? kv("Edge:", `UP ${ANSI.green}${(edge.edgeUp * 100).toFixed(1)}%${ANSI.reset} | DOWN ${ANSI.red}${(edge.edgeDown * 100).toFixed(1)}%${ANSI.reset}`) : null,
        "",
        `  ${sepLine()}`,
        "",
        section("PRICES"),
        "",
        binanceSpotKvLine,
        "",
        `  ${sepLine()}`,
        "",
      ];

      // ──── AUTO-TRADE SECTION ────
      if (CONFIG.autoTrade.enabled) {
        const ats = autoTradeStatus;
        const modeLabel = ats.dryRun ? `${ANSI.yellow}DRY-RUN${ANSI.reset}` : `${ANSI.red}${ANSI.bold}LIVE${ANSI.reset}`;
        lines.push(section("AUTO-TRADE"));
        lines.push("");
        lines.push(kv("Mode:", modeLabel));
        lines.push(kv("Amount:", `$${ats.amount}`));
        lines.push(kv("Min Conf:", `${(ats.minConfidence * 100).toFixed(0)}% | Min Edge: ${(ats.minEdge * 100).toFixed(0)}%`));
        lines.push(kv("Trades:", `${ats.totalTrades} total | ${ANSI.green}W:${ats.wins}${ANSI.reset} / ${ANSI.red}L:${ats.losses}${ANSI.reset}`));
        if (ats.cooldownRemaining > 0) {
          lines.push(kv("Cooldown:", `${ANSI.yellow}${ats.cooldownRemaining}s${ANSI.reset}`));
        }
        if (!tradeCheck.trade) {
          lines.push(kv("Status:", `${ANSI.gray}${tradeCheck.reason}${ANSI.reset}`));
        } else {
          lines.push(kv("Status:", `${ANSI.green}${ANSI.bold}TRADE EXECUTED! ${tradeCheck.side} $${tradeCheck.amount}${ANSI.reset}`));
        }
        if (lastAutoTradeResult) {
          lines.push(kv("Last Trade:", `${lastAutoTradeResult.record.side} $${lastAutoTradeResult.record.amount} @ ${lastAutoTradeResult.record.timestamp.substring(11, 19)} [${lastAutoTradeResult.mode}]`));
        }
        lines.push("");
        lines.push(`  ${sepLine()}`);
        lines.push("");
      }

      lines.push(kv("ET | Session:", `${ANSI.white}${fmtEtTime(new Date())}${ANSI.reset} | ${ANSI.white}${getBtcSession(new Date())}${ANSI.reset}`));
      lines.push("");
      lines.push(`  ${sepLine()}`);
      lines.push(centerText(`${ANSI.dim}${ANSI.gray}Polymarket BTC 5m Assistant${ANSI.reset}`, w));
      lines.push("");

      renderScreen(lines.filter((x) => x !== null).join("\n") + "\n");

      prevSpotPrice = spotPrice ?? prevSpotPrice;
      prevCurrentPrice = currentPrice ?? prevCurrentPrice;

      const signal = rec.action === "ENTER" ? (rec.side === "UP" ? "BUY UP" : "BUY DOWN") : "NO TRADE";

      appendCsvRow("./logs/signals.csv", header, [
        new Date().toISOString(),
        timing.elapsedMinutes.toFixed(3),
        timeLeftMin.toFixed(3),
        regimeInfo.regime,
        signal,
        timeAware.adjustedUp,
        timeAware.adjustedDown,
        marketUp,
        marketDown,
        edge.edgeUp,
        edge.edgeDown,
        rec.action === "ENTER" ? `${rec.side}:${rec.phase}:${rec.strength}` : "NO_TRADE",
        scored.confidence?.toFixed(4) ?? "-",
        macro.bias,
        macro.biasValue?.toFixed(4) || "0",
        learning.streak || "OFF",
        ((learning.upBias || 0) - (learning.downBias || 0)).toFixed(4),
        bbData?.percentB?.toFixed(4) ?? "-",
        emaCross?.signal ?? "-",
        roc?.toFixed(4) ?? "-",
        velocity?.toFixed(4) ?? "-",
        atr?.atrPct?.toFixed(4) ?? "-"
      ]);
    } catch (err) {
      console.log("────────────────────────────");
      console.log(`Error: ${err?.message ?? String(err)}`);
      console.log("────────────────────────────");
    }

    await sleep(CONFIG.pollIntervalMs);
  }
}

main();

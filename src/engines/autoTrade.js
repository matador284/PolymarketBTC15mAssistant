import { CONFIG } from "../config.js";
import { appendCsvRow } from "../utils.js";
import { ClobClient } from "@polymarket/clob-client";
import { fetchEventBySlug } from "../data/polymarket.js";
import { Wallet } from "ethers";

let clobClient = null;

async function getClobClient() {
  if (clobClient) return clobClient;
  const cfg = CONFIG.autoTrade;
  if (!cfg.privateKey || !cfg.apiKey || !cfg.apiSecret || !cfg.apiPassphrase) {
    throw new Error("Missing CLOB API credentials in .env");
  }

  const wallet = new Wallet(cfg.privateKey);
  clobClient = new ClobClient("https://clob.polymarket.com", 137, wallet, {
    key: cfg.apiKey,
    secret: cfg.apiSecret,
    passphrase: cfg.apiPassphrase,
  });
  return clobClient;
}

/**
 * Auto-Trade Engine
 *
 * Manages automatic trade execution based on model signals.
 * Supports dry-run mode (logging only) and live mode.
 *
 * In DRY-RUN mode: logs simulated trades to CSV.
 * In LIVE mode: would execute via Polymarket CLOB API (requires API keys/wallet).
 */

const tradeState = {
  lastTradeMs: 0,
  tradeCount: 0,
  activeMarketSlug: null,
  tradesThisMarket: 0,
  tradeHistory: [],
  // Session P&L tracking
  sessionPnl: 0,
  totalTrades: 0,
  wins: 0,
  losses: 0,
};

const AUTO_TRADE_LOG = "./logs/auto_trades.csv";
const AUTO_TRADE_HEADER = [
  "timestamp",
  "market_slug",
  "side",
  "amount_usd",
  "model_confidence",
  "edge",
  "phase",
  "strength",
  "time_left_min",
  "current_price",
  "price_to_beat",
  "mode",
  "status"
];

/**
 * Determine if we should auto-enter a trade.
 */
export function shouldAutoTrade({
  enabled,
  decision,
  timeLeftMin,
  modelUp,
  modelDown,
  marketSlug,
}) {
  if (!enabled) return { trade: false, reason: "disabled" };

  const cfg = CONFIG.autoTrade;

  if (cfg.tradeAmountUsd <= 0) return { trade: false, reason: "amount_not_set" };

  if (decision.action !== "ENTER") return { trade: false, reason: `no_signal (${decision.reason})` };

  const bestModel = decision.side === "UP" ? modelUp : modelDown;

  // Confidence check
  if (bestModel !== null && bestModel < cfg.minConfidence) {
    return { trade: false, reason: `confidence_below_${cfg.minConfidence} (${bestModel?.toFixed(3)})` };
  }

  // Edge check
  if (decision.edge !== null && decision.edge < cfg.minEdge) {
    return { trade: false, reason: `edge_below_${cfg.minEdge} (${decision.edge?.toFixed(3)})` };
  }
  if (decision.edge !== null && decision.edge > cfg.maxEdge) {
    return { trade: false, reason: `edge_trap_ignored (> ${cfg.maxEdge})` };
  }

  // Time window check
  if (timeLeftMin < cfg.minTimeLeftMin) {
    return { trade: false, reason: `too_late (${timeLeftMin.toFixed(1)}m < ${cfg.minTimeLeftMin}m)` };
  }
  if (timeLeftMin > cfg.maxTimeLeftMin) {
    return { trade: false, reason: `too_early (${timeLeftMin.toFixed(1)}m > ${cfg.maxTimeLeftMin}m)` };
  }

  // Cooldown check
  const now = Date.now();
  if (now - tradeState.lastTradeMs < cfg.cooldownMs) {
    const remaining = ((cfg.cooldownMs - (now - tradeState.lastTradeMs)) / 1000).toFixed(0);
    return { trade: false, reason: `cooldown (${remaining}s left)` };
  }

  // Stop Loss/Take Profit Checks
  if (cfg.stopLossUsd > 0 && tradeState.sessionPnl <= -cfg.stopLossUsd) {
    return { trade: false, reason: `stop_loss_reached (-$${Math.abs(tradeState.sessionPnl).toFixed(2)} / -$${cfg.stopLossUsd})` };
  }
  if (cfg.takeProfitUsd > 0 && tradeState.sessionPnl >= cfg.takeProfitUsd) {
    return { trade: false, reason: `take_profit_reached (+$${tradeState.sessionPnl.toFixed(2)} / +$${cfg.takeProfitUsd})` };
  }

  // Max trades per market check
  if (marketSlug && tradeState.activeMarketSlug === marketSlug && tradeState.tradesThisMarket >= cfg.maxTradesPerMarket) {
    return { trade: false, reason: `max_trades_reached (${cfg.maxTradesPerMarket})` };
  }

  // Strength filter: don't auto-trade weak signals
  if (decision.strength === "WEAK") {
    return { trade: false, reason: "signal_too_weak" };
  }

  return {
    trade: true,
    reason: "all_checks_passed",
    side: decision.side,
    amount: cfg.tradeAmountUsd,
    edge: decision.edge,
    confidence: bestModel,
    strength: decision.strength
  };
}

/**
 * Execute (or simulate) a trade.
 */
export async function executeTrade({
  side,
  amount,
  edge,
  confidence,
  strength,
  phase,
  timeLeftMin,
  currentPrice,
  priceToBeat,
  marketSlug,
  tokenId,
  outcomePrice,
}) {
  const cfg = CONFIG.autoTrade;
  const mode = cfg.dryRun ? "DRY_RUN" : "LIVE";
  const now = new Date();

  // Price for the order: 
  // In binary markets, if we want to buy at outcomePrice (e.g. 0.50), 
  // we can place a limit order slightly above to ensure fill (e.g., 0.52).
  // Or just use the outcomePrice.
  const orderPrice = outcomePrice ? Math.min(0.99, outcomePrice + 0.01) : 0.50;
  // Size is amount_usd / orderPrice
  const orderSize = Math.floor(amount / orderPrice);

  const tradeRecord = {
    timestamp: now.toISOString(),
    marketSlug: marketSlug || "-",
    side,
    amount,
    confidence: confidence?.toFixed(4) ?? "-",
    edge: edge?.toFixed(4) ?? "-",
    phase,
    strength,
    resolved: false,
    timeLeftMin: timeLeftMin?.toFixed(2) ?? "-",
    currentPrice: currentPrice?.toFixed(2) ?? "-",
    priceToBeat: priceToBeat?.toFixed(2) ?? "-",
    mode,
    status: "EXECUTED"
  };

  if (cfg.dryRun) {
    // Log the trade
    appendCsvRow(AUTO_TRADE_LOG, AUTO_TRADE_HEADER, [
      tradeRecord.timestamp,
      tradeRecord.marketSlug,
      tradeRecord.side,
      tradeRecord.amount,
      tradeRecord.confidence,
      tradeRecord.edge,
      tradeRecord.phase,
      tradeRecord.strength,
      tradeRecord.timeLeftMin,
      tradeRecord.currentPrice,
      tradeRecord.priceToBeat,
      tradeRecord.mode,
      tradeRecord.status
    ]);

    // Update state
    tradeState.lastTradeMs = Date.now();
    tradeState.tradeCount++;
    tradeState.totalTrades++;
    if (marketSlug !== tradeState.activeMarketSlug) {
      tradeState.activeMarketSlug = marketSlug;
      tradeState.tradesThisMarket = 0;
    }
    tradeState.tradesThisMarket++;
    tradeState.tradeHistory.push(tradeRecord);

    return { ok: true, mode: "DRY_RUN", record: tradeRecord };
  }

  // ──── LIVE TRADE EXECUTION ────
  try {
    const client = await getClobClient();
    
    // Check balance before (optional but good)
    // const status = await client.getApiKeyStatus();
    
    // Create and post order
    const orderResp = await client.createAndPostOrder({
      tokenID: tokenId,
      price: orderPrice,
      size: orderSize,
      side: "BUY", // In Polymarket, you always 'BUY' the outcome (Yes or No)
    });

    tradeRecord.status = orderResp.success ? "LIVE_EXECUTED" : "LIVE_FAILED";
    tradeRecord.orderId = orderResp.orderID || "-";
    
    // Log the trade
    appendCsvRow(AUTO_TRADE_LOG, AUTO_TRADE_HEADER, [
      tradeRecord.timestamp,
      tradeRecord.marketSlug,
      tradeRecord.side,
      tradeRecord.amount,
      tradeRecord.confidence,
      tradeRecord.edge,
      tradeRecord.phase,
      tradeRecord.strength,
      tradeRecord.timeLeftMin,
      tradeRecord.currentPrice,
      tradeRecord.priceToBeat,
      tradeRecord.mode,
      tradeRecord.status
    ]);

    // Update state
    tradeState.lastTradeMs = Date.now();
    tradeState.tradeCount++;
    tradeState.totalTrades++;
    if (marketSlug !== tradeState.activeMarketSlug) {
      tradeState.activeMarketSlug = marketSlug;
      tradeState.tradesThisMarket = 0;
    }
    tradeState.tradesThisMarket++;
    tradeState.tradeHistory.push(tradeRecord);

    return { ok: orderResp.success, mode: "LIVE", record: tradeRecord, orderId: orderResp.orderID };
  } catch (error) {
    tradeRecord.status = `ERR: ${error.message}`;
    appendCsvRow(AUTO_TRADE_LOG, AUTO_TRADE_HEADER, [
      tradeRecord.timestamp,
      tradeRecord.marketSlug,
      tradeRecord.side,
      tradeRecord.amount,
      tradeRecord.confidence,
      tradeRecord.edge,
      tradeRecord.phase,
      tradeRecord.strength,
      tradeRecord.timeLeftMin,
      tradeRecord.currentPrice,
      tradeRecord.priceToBeat,
      tradeRecord.mode,
      tradeRecord.status
    ]);
    return { ok: false, mode: "LIVE", error: error.message };
  }
}

/**
 * Get current auto-trade status for display.
 */
export function getAutoTradeStatus() {
  const cfg = CONFIG.autoTrade;
  const now = Date.now();
  const cooldownRemaining = Math.max(0, cfg.cooldownMs - (now - tradeState.lastTradeMs));

  return {
    enabled: cfg.enabled,
    dryRun: cfg.dryRun,
    amount: cfg.tradeAmountUsd,
    minConfidence: cfg.minConfidence,
    minEdge: cfg.minEdge,
    totalTrades: tradeState.totalTrades,
    cooldownRemaining: Math.ceil(cooldownRemaining / 1000),
    lastTradeAge: tradeState.lastTradeMs > 0 ? Math.floor((now - tradeState.lastTradeMs) / 1000) : null,
    wins: tradeState.wins,
    losses: tradeState.losses,
    winRate: (tradeState.wins + tradeState.losses) > 0 ? (tradeState.wins / (tradeState.wins + tradeState.losses) * 100).toFixed(1) : "-",
    recentTrades: tradeState.tradeHistory.slice(-5),
    sessionPnl: tradeState.sessionPnl,
    stopLoss: cfg.stopLossUsd,
    takeProfit: cfg.takeProfitUsd,
  };
}

/**
 * Update session P&L by checking results of pending trades.
 */
export async function updateSessionPnL() {
  const unresolved = tradeState.tradeHistory.filter((t) => !t.resolved && t.marketSlug !== "-");
  if (unresolved.length === 0) return;

  for (const t of unresolved) {
    try {
      const event = await fetchEventBySlug(t.marketSlug);
      if (!event) continue;

      const market = event.markets?.[0];
      if (market && market.closed) {
        const prices = JSON.parse(market.outcomePrices || "[]");
        const outcomes = JSON.parse(market.outcomes || "[]");
        let winningIndex = -1;
        if (prices[0] === "1" || prices[0] === 1) winningIndex = 0;
        else if (prices[1] === "1" || prices[1] === 1) winningIndex = 1;

        if (winningIndex !== -1) {
          const actualWinner = outcomes[winningIndex].toUpperCase();
          const isWin = actualWinner === t.side;

          t.resolved = true;
          t.winner = actualWinner;
          t.isWin = isWin;

          const conf = parseFloat(t.confidence) || 0.5;
          const edge = parseFloat(t.edge) || 0.05;
          const sharePrice = Math.max(0.01, Math.min(0.99, conf - edge));
          const profit = isWin ? (t.amount / sharePrice) - t.amount : -t.amount;

          tradeState.sessionPnl += profit;
          if (isWin) tradeState.wins++;
          else tradeState.losses++;
        }
      }
    } catch (e) {
      // Ignore network errors
    }
  }
}

/**
 * Reset trade state for a new market cycle.
 */
export function resetMarketState(newMarketSlug) {
  if (newMarketSlug !== tradeState.activeMarketSlug) {
    tradeState.activeMarketSlug = newMarketSlug;
    tradeState.tradesThisMarket = 0;
  }
}

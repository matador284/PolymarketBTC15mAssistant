import { CONFIG } from "../config.js";
import { appendCsvRow } from "../utils.js";
import { ClobClient, SignatureType } from "@polymarket/clob-client";
import { fetchEventBySlug } from "../data/polymarket.js";
import { getWalletBalance } from "../data/walletBalance.js";
import { Wallet } from "ethers";
import fs from 'fs';
import { SafetyAudit } from "./safetyAudit.js";

const RULES_PATH = './rules.json';
function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  } catch (e) {
    return { trading: { min_edge: 0.05, max_edge_trap: 0.50 } }; // Fallback básico
  }
}

let clobClient = null;

async function getClobClient() {
  if (clobClient) return clobClient;
  const cfg = CONFIG.autoTrade;
  if (!cfg.privateKey || !cfg.apiKey || !cfg.apiSecret || !cfg.apiPassphrase) {
    throw new Error("Missing CLOB API credentials in .env");
  }

  // ethers v5: Wallet tem address direto sem precisar de provider
  const wallet = new Wallet(cfg.privateKey);

  let funder = cfg.funderAddress;
  if (funder) {
    try {
      funder = ethers.utils.getAddress(funder);
    } catch (e) {
      console.error(`  [⚠️] Endereço de funder inválido: ${funder}`);
    }
  }

  // Se tiver funderAddress (proxy), usa POLY_PROXY. Senão usa EOA (0).
  const sigType = funder ? SignatureType.POLY_PROXY : SignatureType.EOA;

  try {
    clobClient = new ClobClient("https://clob.polymarket.com", 137, wallet, {
      key: cfg.apiKey,
      secret: cfg.apiSecret,
      passphrase: cfg.apiPassphrase,
    }, sigType, funder);
    
    // Teste de conexão silencioso
    await clobClient.getSecondaryChannelSubscription(); 
  } catch (err) {
    console.error(`  [⚠️] Erro ao instanciar CLOB Client: ${err.message}`);
    clobClient = null;
    throw err;
  }
  
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
  const rules = loadRules();
  const checks = {
    passed: false,
    reason: "unknown",
    details: {}
  };

  if (cfg.tradeAmountUsd <= 0) {
    checks.reason = "amount_not_set";
    return { trade: false, reason: checks.reason };
  }

  if (decision.action !== "ENTER") {
    checks.reason = `no_signal (${decision.reason})`;
    return { trade: false, reason: checks.reason };
  }

  const bestModel = decision.side === "UP" ? modelUp : modelDown;
  const metrics = {
    confidence: bestModel,
    edge: decision.edge,
    timeLeft: timeLeftMin,
    strength: decision.strength
  };

  // Checklist de Auditoria (Inspirado no projeto GitHub)
  const checklist = [];
  
  // 1. Confiança
  const lowConf = bestModel !== null && bestModel < cfg.minConfidence;
  checklist.push({ name: "confidence", ok: !lowConf, val: bestModel });

  // 2. Edge (Vantagem)
  const lowEdge = decision.edge !== null && decision.edge < cfg.minEdge;
  const edgeTrap = decision.edge !== null && decision.edge > cfg.maxEdge;
  checklist.push({ name: "edge", ok: !lowEdge && !edgeTrap, val: decision.edge });

  // 3. Janela de Tempo
  const timeOk = timeLeftMin >= cfg.minTimeLeftMin && timeLeftMin <= cfg.maxTimeLeftMin;
  checklist.push({ name: "time_window", ok: timeOk, val: timeLeftMin });

  // 4. Cooldown
  const now = Date.now();
  const cooldownOk = (now - tradeState.lastTradeMs >= cfg.cooldownMs);
  checklist.push({ name: "cooldown", ok: cooldownOk });

  // 5. Gestão de Risco (SL/TP)
  const slReached = cfg.stopLossUsd > 0 && tradeState.sessionPnl <= -cfg.stopLossUsd;
  const tpReached = cfg.takeProfitUsd > 0 && tradeState.sessionPnl >= cfg.takeProfitUsd;
  checklist.push({ name: "risk_management", ok: !slReached && !tpReached });

  // Consolidação
  const failed = checklist.find(c => !c.ok);
  if (failed) {
    checks.passed = false;
    checks.reason = failed.name;
    checks.details = checklist;
    
    // Log detalhado da falha (Audit)
    SafetyAudit.logCheck({ marketSlug, side: decision.side, ...metrics }, rules, checks);
    
    // Converte para o formato de retorno legível
    let displayReason = failed.name;
    if (failed.name === "confidence") displayReason = `confidence_below_${cfg.minConfidence} (${bestModel?.toFixed(2)})`;
    if (failed.name === "edge") displayReason = lowEdge ? "low_edge" : "edge_trap";
    
    return { trade: false, reason: displayReason };
  }

  // Se tudo passou
  checks.passed = true;
  checks.reason = "all_checks_passed";
  checks.details = checklist;
  
  SafetyAudit.logCheck({ marketSlug, side: decision.side, ...metrics }, rules, checks);

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
    // 1. Checagem de Saldo (USDC)
    const wallet = await getWalletBalance();
    if (!wallet.ok || wallet.usdc < amount) {
      throw new Error(`Insufficient funds: Need $${amount}, have $${wallet.usdc?.toFixed(2) || "0.00"}`);
    }

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

    tradeRecord.status = orderResp.success ? "LIVE_EXECUTED" : `LIVE_FAILED: ${orderResp.errorMessage || orderResp.error || "Unknown"}`;
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
    // CRÍTICO: Mesmo em erro, aplica cooldown para evitar spam de entradas
    tradeState.lastTradeMs = Date.now();
    // Reset client para forçar reconexão na próxima tentativa
    clobClient = null;
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
  const unresolved = tradeState.tradeHistory.filter((t) => 
    !t.resolved && 
    t.marketSlug !== "-" && 
    t.side &&  // precisa ter side definido
    t.status && !t.status.startsWith("ERR") // ignora trades com erro
  );
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
          const isWin = actualWinner === (t.side || "");

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

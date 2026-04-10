/**
 * 🐋 WHALE SPY ENGINE
 * ─────────────────────────────────────────────────────────────
 * Monitora os trades recentes de grandes apostadores na Polymarket
 * para um determinado mercado BTC 5m. 
 * 
 * Estratégia: Se as "baleias" (apostadores com posições grandes)
 * estiverem majoritariamente em UMA direção, isso é um sinal de 
 * confirmação (ou contra-indicação) poderoso.
 * ─────────────────────────────────────────────────────────────
 */

const DATA_API = "https://data-api.polymarket.com";

// Cache para não chamar a API a cada segundo
const cache = {
  slug: null,
  result: null,
  fetchedAtMs: 0,
};
const CACHE_TTL_MS = 30_000; // Atualiza a cada 30 segundos

/**
 * Busca os trades recentes de um mercado específico e analisa
 * o sentimento das baleias.
 *
 * @param {string} marketSlug - O slug do mercado BTC 5m atual
 * @returns {Object} Resultado da análise de baleias
 */
export async function getWhaleSentiment(marketSlug) {
  if (!marketSlug) {
    return { ok: false, bias: 0, whaleCount: 0, signal: "NEUTRAL", upVolume: 0, downVolume: 0, reason: "no_slug" };
  }

  const now = Date.now();

  // Retorna do cache se ainda for válido e for o mesmo mercado
  if (cache.slug === marketSlug && cache.result && (now - cache.fetchedAtMs < CACHE_TTL_MS)) {
    return cache.result;
  }

  try {
    // Busca os últimos 100 trades nesse mercado BTC 5m específico
    const url = `${DATA_API}/trades?limit=100&slug=${marketSlug}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (!res.ok) {
      return { ok: false, bias: 0, whaleCount: 0, signal: "NEUTRAL", upVolume: 0, downVolume: 0, reason: `api_error_${res.status}` };
    }

    const trades = await res.json();
    if (!Array.isArray(trades) || trades.length === 0) {
      return { ok: false, bias: 0, whaleCount: 0, signal: "NO_DATA", upVolume: 0, downVolume: 0, reason: "no_trades_yet" };
    }

    // ──── ANÁLISE DE VOLUME POR DIREÇÃO ────
    // Consideramos "Baleia" qualquer trade com volume >= $50
    const WHALE_THRESHOLD = 50; // USD

    let upVolume = 0;
    let downVolume = 0;
    let whaleCount = 0;
    let totalVol = 0;

    for (const trade of trades) {
      // só calcula trades de compra (BUY) para saber onde o dinheiro está indo
      if (trade.side !== "BUY") continue;

      const vol = trade.size * (trade.price || 0.5);
      totalVol += vol;

      if (vol >= WHALE_THRESHOLD) {
        whaleCount++;
        const outcome = (trade.outcome || "").toUpperCase();
        if (outcome === "UP") upVolume += vol;
        else if (outcome === "DOWN") downVolume += vol;
      }
    }

    const totalWhaleVol = upVolume + downVolume;

    if (totalWhaleVol < 10) {
      // Pouco volume de baleia, sem sinal claro
      const result = { ok: true, bias: 0, whaleCount, signal: "NEUTRAL", upVolume, downVolume, reason: "low_whale_volume" };
      cache.slug = marketSlug; cache.result = result; cache.fetchedAtMs = now;
      return result;
    }

    const upPct = upVolume / totalWhaleVol;
    const downPct = downVolume / totalWhaleVol;

    // ──── CLASSIFICAÇÃO DO SINAL DAS BALEIAS ────
    let signal = "NEUTRAL";
    let bias = 0;

    if (upPct >= 0.75) {
      signal = "STRONG_UP";
      bias = 0.08; // Baleias fortemente em UP → empurra probabilidade de UP
    } else if (upPct >= 0.60) {
      signal = "LEAN_UP";
      bias = 0.04;
    } else if (downPct >= 0.75) {
      signal = "STRONG_DOWN";
      bias = -0.08; // Baleias fortemente em DOWN → empurra probabilidade de DOWN
    } else if (downPct >= 0.60) {
      signal = "LEAN_DOWN";
      bias = -0.04;
    } else {
      signal = "NEUTRAL";
      bias = 0;
    }

    const result = { ok: true, bias, whaleCount, signal, upVolume, downVolume, upPct, downPct, reason: "ok" };
    cache.slug = marketSlug; cache.result = result; cache.fetchedAtMs = now;
    return result;

  } catch (err) {
    return { ok: false, bias: 0, whaleCount: 0, signal: "ERROR", upVolume: 0, downVolume: 0, reason: err.message };
  }
}

import { CONFIG } from "../config.js";

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export async function fetchMarketBySlug(slug) {
  const url = new URL("/markets", CONFIG.gammaBaseUrl);
  url.searchParams.set("slug", slug);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gamma markets error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const market = Array.isArray(data) ? data[0] : data;
  if (!market) return null;

  return market;
}

export async function fetchEventBySlug(slug) {
  const url = new URL("/events", CONFIG.gammaBaseUrl);
  url.searchParams.set("slug", slug);
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data[0] : null;
}

export async function fetchMarketsBySeriesSlug({ seriesSlug, limit = 50 }) {
  const url = new URL("/markets", CONFIG.gammaBaseUrl);
  url.searchParams.set("seriesSlug", seriesSlug);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("enableOrderBook", "true");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gamma markets(series) error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Try to resolve the series ID from the series slug via /series endpoint.
 */
let cachedSeriesId = null;
let seriesIdFetchedAtMs = 0;

async function resolveSeriesId(slug) {
  const now = Date.now();
  if (cachedSeriesId && now - seriesIdFetchedAtMs < 120_000) return cachedSeriesId;

  try {
    const url = new URL("/series", CONFIG.gammaBaseUrl);
    url.searchParams.set("slug", slug);
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const series = Array.isArray(data) ? data[0] : data;
      if (series?.id) {
        cachedSeriesId = String(series.id);
        seriesIdFetchedAtMs = now;
        return cachedSeriesId;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Fetch live events — multi-method approach with fallbacks:
 * 1. Try /series?slug=... to resolve series_id
 * 2. Try /events?series_id=... if we have a series_id
 * 3. Try /markets?seriesSlug=... as fallback
 * 4. Try /events (active) and filter by slug/title keywords
 */
export async function fetchLiveEventsBySeriesId({ seriesId, limit = 20 }) {
  const seriesSlug = CONFIG.polymarket.seriesSlug;
  const windowTerm = CONFIG.candleWindowMinutes === 5 ? "5" : "15";

  // ──── METHOD 1: Try to resolve series_id from slug ────
  let resolvedId = seriesId || null;
  if (!resolvedId && seriesSlug) {
    resolvedId = await resolveSeriesId(seriesSlug);
  }

  // ──── METHOD 2: Fetch events by series_id ────
  if (resolvedId) {
    try {
      const url = new URL("/events", CONFIG.gammaBaseUrl);
      url.searchParams.set("series_id", String(resolvedId));
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      url.searchParams.set("limit", String(limit));

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const events = Array.isArray(data) ? data : [];
        if (events.length > 0) return events;
      }
    } catch {
      // fall through
    }
  }

  // ──── METHOD 3: Fetch markets by series slug ────
  if (seriesSlug) {
    try {
      const markets = await fetchMarketsBySeriesSlug({ seriesSlug, limit });
      if (markets.length > 0) {
        // Wrap markets in a synthetic event structure
        return [{ markets }];
      }
    } catch {
      // fall through
    }
  }

  // ──── METHOD 4: Fetch all active events and filter ────
  try {
    const url = new URL("/events", CONFIG.gammaBaseUrl);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(Math.min(limit * 5, 100)));

    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const events = Array.isArray(data) ? data : [];

    return events.filter(e => {
      const eventSlug = String(e.slug || "").toLowerCase();
      const eventTitle = String(e.title || "").toLowerCase();
      const seriesSlugLower = String(seriesSlug || "").toLowerCase();

      // Match by series slug
      if (seriesSlugLower && eventSlug.includes(seriesSlugLower)) return true;

      // Match by window time (5m or 15m)
      const matchTerms = [`${windowTerm}m`, `${windowTerm}-min`, `${windowTerm} min`, `${windowTerm}-minute`];
      const btcTerms = ["bitcoin", "btc"];
      const upDownTerms = ["up or down", "up-or-down", "updown"];

      const hasBtc = btcTerms.some(t => eventTitle.includes(t) || eventSlug.includes(t));
      const hasUpDown = upDownTerms.some(t => eventTitle.includes(t) || eventSlug.includes(t));
      const hasTime = matchTerms.some(t => eventTitle.includes(t) || eventSlug.includes(t));

      if (hasBtc && hasUpDown && hasTime) return true;

      // Check series references within event
      const series = Array.isArray(e.series) ? e.series : [];
      for (const s of series) {
        const sSlug = String(s.slug || "").toLowerCase();
        if (sSlug === seriesSlugLower) return true;
        if (matchTerms.some(t => sSlug.includes(t)) && btcTerms.some(t => sSlug.includes(t))) return true;
      }

      // Check markets within the event
      const markets = Array.isArray(e.markets) ? e.markets : [];
      for (const m of markets) {
        const mSlug = String(m.slug || "").toLowerCase();
        const mTitle = String(m.question || m.title || "").toLowerCase();
        const hasMBtc = btcTerms.some(t => mTitle.includes(t) || mSlug.includes(t));
        const hasMUpDown = upDownTerms.some(t => mTitle.includes(t) || mSlug.includes(t));
        const hasMTime = matchTerms.some(t => mTitle.includes(t) || mSlug.includes(t));
        if (hasMBtc && hasMUpDown && hasMTime) return true;
      }

      return false;
    });
  } catch {
    return [];
  }
}

export function flattenEventMarkets(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    const markets = Array.isArray(e.markets) ? e.markets : [];
    for (const m of markets) {
      out.push(m);
    }
  }
  return out;
}

export async function fetchActiveMarkets({ limit = 200, offset = 0 } = {}) {
  const url = new URL("/markets", CONFIG.gammaBaseUrl);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("enableOrderBook", "true");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gamma markets(active) error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function safeTimeMs(x) {
  if (!x) return null;
  const t = new Date(x).getTime();
  return Number.isFinite(t) ? t : null;
}

export function pickLatestLiveMarket(markets, nowMs = Date.now()) {
  if (!Array.isArray(markets) || markets.length === 0) return null;

  const enriched = markets
    .map((m) => {
      const endMs = safeTimeMs(m.endDate);
      const startMs = safeTimeMs(m.eventStartTime ?? m.startTime ?? m.startDate);
      return { m, endMs, startMs };
    })
    .filter((x) => x.endMs !== null);

  const live = enriched
    .filter((x) => {
      const started = x.startMs === null ? true : x.startMs <= nowMs;
      return started && nowMs < x.endMs;
    })
    .sort((a, b) => a.endMs - b.endMs);

  if (live.length) return live[0].m;

  const upcoming = enriched
    .filter((x) => nowMs < x.endMs)
    .sort((a, b) => a.endMs - b.endMs);

  return upcoming.length ? upcoming[0].m : null;
}

function marketHasSeriesSlug(market, seriesSlug) {
  if (!market || !seriesSlug) return false;

  const events = Array.isArray(market.events) ? market.events : [];
  for (const e of events) {
    const series = Array.isArray(e.series) ? e.series : [];
    for (const s of series) {
      if (String(s.slug ?? "").toLowerCase() === String(seriesSlug).toLowerCase()) return true;
    }
    if (String(e.seriesSlug ?? "").toLowerCase() === String(seriesSlug).toLowerCase()) return true;
  }
  if (String(market.seriesSlug ?? "").toLowerCase() === String(seriesSlug).toLowerCase()) return true;
  return false;
}

export function filterBtcUpDown5mMarkets(markets, { seriesSlug, slugPrefix } = {}) {
  const prefix = (slugPrefix ?? "").toLowerCase();
  const wantedSeries = (seriesSlug ?? "").toLowerCase();

  return (Array.isArray(markets) ? markets : []).filter((m) => {
    const slug = String(m.slug ?? "").toLowerCase();
    const matchesPrefix = prefix ? slug.startsWith(prefix) : false;
    const matchesSeries = wantedSeries ? marketHasSeriesSlug(m, wantedSeries) : false;
    return matchesPrefix || matchesSeries;
  });
}

export async function fetchClobPrice({ tokenId, side }) {
  const url = new URL("/price", CONFIG.clobBaseUrl);
  url.searchParams.set("token_id", tokenId);
  url.searchParams.set("side", side);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CLOB price error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return toNumber(data.price);
}

export async function fetchOrderBook({ tokenId }) {
  const url = new URL("/book", CONFIG.clobBaseUrl);
  url.searchParams.set("token_id", tokenId);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CLOB book error: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

export function summarizeOrderBook(book, depthLevels = 5) {
  const bids = Array.isArray(book?.bids) ? book.bids : [];
  const asks = Array.isArray(book?.asks) ? book.asks : [];

  const bestBid = bids.length
    ? bids.reduce((best, lvl) => {
        const p = toNumber(lvl.price);
        if (p === null) return best;
        if (best === null) return p;
        return Math.max(best, p);
      }, null)
    : null;

  const bestAsk = asks.length
    ? asks.reduce((best, lvl) => {
        const p = toNumber(lvl.price);
        if (p === null) return best;
        if (best === null) return p;
        return Math.min(best, p);
      }, null)
    : null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

  const bidLiquidity = bids.slice(0, depthLevels).reduce((acc, x) => acc + (toNumber(x.size) ?? 0), 0);
  const askLiquidity = asks.slice(0, depthLevels).reduce((acc, x) => acc + (toNumber(x.size) ?? 0), 0);

  return {
    bestBid,
    bestAsk,
    spread,
    bidLiquidity,
    askLiquidity
  };
}

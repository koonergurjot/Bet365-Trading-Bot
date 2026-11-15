// Polymarket public read-only API (no key, no account, no betting). Used as a free, liquid, near-vig-free
// reference price for games Bet365 also offers. Prices are crowd probabilities, NOT Bet365 odds.
const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

// sport key -> kind. 3way = Win/Draw/Win markets (soccer), 2way = single moneyline market.
export const LEAGUES = {
  nfl: { kind: '2way', label: 'NFL' }, nba: { kind: '2way', label: 'NBA' }, nhl: { kind: '2way', label: 'NHL' },
  cfb: { kind: '2way', label: 'College football' }, cbb: { kind: '2way', label: 'College basketball' },
  epl: { kind: '3way', label: 'Premier League' }, ucl: { kind: '3way', label: 'Champions League' }, uel: { kind: '3way', label: 'Europa League' },
  lal: { kind: '3way', label: 'La Liga' }, bun: { kind: '3way', label: 'Bundesliga' }, sea: { kind: '3way', label: 'Serie A' },
  fl1: { kind: '3way', label: 'Ligue 1' }, mls: { kind: '3way', label: 'MLS' }, elc: { kind: '3way', label: 'Championship' },
};

async function getJson(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { accept: 'application/json' } });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { err = e; await new Promise((s) => setTimeout(s, 500)); }
  }
  throw new Error(`${url}: ${err?.message}`);
}

let seriesCache;
export async function seriesIds() {
  if (!seriesCache) { const s = await getJson(`${GAMMA}/sports`); seriesCache = Object.fromEntries(s.map((x) => [x.sport, x.series])); }
  return seriesCache;
}

export async function listEvents(sport, { closed = false, limit = 60, offset = 0, endMin, endMax } = {}) {
  const ids = await seriesIds(); if (!ids[sport]) return [];
  const q = new URLSearchParams({ series_id: ids[sport], closed: String(closed), limit: String(limit), offset: String(offset), order: 'endDate', ascending: closed ? 'false' : 'true' });
  if (!closed) q.set('active', 'true');
  if (endMin) q.set('end_date_min', endMin); if (endMax) q.set('end_date_max', endMax);
  return getJson(`${GAMMA}/events?${q}`);
}

const parseArr = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Turn one Gamma event into a normalised pre-match game, or null if it is not a plain game with a usable moneyline.
export function parseGame(e, sport, { now = Date.now(), requirePregame = true } = {}) {
  const cfg = LEAGUES[sport]; if (!cfg || / - /.test(e.title || '')) return null;
  const ml = (e.markets || []).filter((m) => m.sportsMarketType === 'moneyline' && !m.closed);
  const all = (e.markets || []).filter((m) => m.sportsMarketType === 'moneyline');
  const src = ml.length ? ml : all; if (!src.length) return null;
  const startIso = src[0].gameStartTime || e.startTime || e.endDate;
  const start = startIso ? new Date(startIso.replace(' ', 'T').replace(/\+00$/, 'Z')).getTime() : null;
  if (requirePregame && (!start || start <= now)) return null; // in play or finished: prices are not a pre-match reference
  let sel = [];
  if (cfg.kind === '2way' && src.length === 1) {
    const m = src[0]; const names = parseArr(m.outcomes), px = parseArr(m.outcomePrices).map(Number), tok = parseArr(m.clobTokenIds);
    if (names.length !== 2 || px.length !== 2) return null;
    sel = names.map((n, i) => ({ name: n, price: px[i], token: tok[i] }));
  } else if (cfg.kind === '3way' && src.length === 3) {
    sel = src.map((m) => {
      const px = parseArr(m.outcomePrices).map(Number), tok = parseArr(m.clobTokenIds);
      const q = m.question || '';
      const name = /end in a draw/i.test(q) ? 'Draw' : (q.match(/^Will (.+?) win/i)?.[1] || q);
      return { name, price: px[0], token: tok[0], bid: num(m.bestBid), ask: num(m.bestAsk) };
    });
  } else return null;
  if (sel.some((s) => !Number.isFinite(s.price))) return null;
  const total = sel.reduce((a, s) => a + s.price, 0);
  if (total < 0.9 || total > 1.1) return null;                              // incoherent book
  if (requirePregame && sel.some((s) => s.price >= 0.985 || s.price <= 0.005)) return null; // effectively decided
  const outcomes = sel.map((s) => ({ name: s.name, prob: s.price / total, token: s.token }));
  const m0 = src[0]; const spread = cfg.kind === '2way' ? (num(m0.bestAsk) != null && num(m0.bestBid) != null ? num(m0.bestAsk) - num(m0.bestBid) : null) : Math.max(...sel.map((s) => (s.ask != null && s.bid != null ? s.ask - s.bid : 0)));
  return {
    id: String(e.id), slug: e.slug, sport, league: cfg.label, kind: cfg.kind, title: e.title,
    start: start ? new Date(start).toISOString() : null, liquidity: Number(e.liquidity) || 0, volume: Number(e.volume) || 0,
    spread, bookSum: Math.round(total * 1000) / 1000, outcomes,
  };
}

export async function fetchUpcoming(sports = Object.keys(LEAGUES), { horizonDays = 10 } = {}) {
  const now = new Date(); const end = new Date(now.getTime() + horizonDays * 864e5);
  const games = []; const errors = [];
  for (const sport of sports) {
    try {
      const ev = await listEvents(sport, { endMin: now.toISOString(), endMax: end.toISOString(), limit: 100 });
      for (const e of ev) { const g = parseGame(e, sport); if (g) games.push(g); }
    } catch (e) { errors.push(`${sport}: ${e.message}`); }
  }
  return { games, errors };
}

// Price of one outcome token ~minutesBefore the game started (for validation against settled results).
export async function priceBefore(token, startMs, minutesBefore = 60) {
  const t = Math.floor(startMs / 1000) - minutesBefore * 60;
  const h = await getJson(`${CLOB}/prices-history?market=${token}&startTs=${t - 3 * 3600}&endTs=${t + 600}&fidelity=10`);
  const pts = (h.history || []).filter((p) => p.t <= t + 300);
  return pts.length ? pts[pts.length - 1].p : null;
}

export async function getEvent(id) {
  const r = await getJson(`${GAMMA}/events?id=${encodeURIComponent(id)}`);
  return Array.isArray(r) ? r[0] : r;
}

// Final result of one outcome token from a resolved event: 1 win, 0 loss, null unresolved/void.
export function tokenResult(event, token) {
  for (const m of (event?.markets || []).filter((x) => x.sportsMarketType === 'moneyline')) {
    const toks = parseArr(m.clobTokenIds); const idx = toks.indexOf(token); if (idx < 0) continue;
    const px = parseArr(m.outcomePrices).map(Number);
    if (px.length && px.every((x) => x <= 0.01 || x >= 0.99) && px.some((x) => x >= 0.99)) return px[idx] >= 0.99 ? 1 : 0;
    return null;
  }
  return null;
}

/**
 * The Odds API Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches live odds from https://the-odds-api.com and normalizes them
 * into the Bet365 Edge Brain ENGINE_CONTRACT snapshot format.
 *
 * Regions fetched: eu (Bet365, Betfair, Unibet) + us (DraftKings, FanDuel, BetMGM).
 * Markets fetched: h2h (moneyline), spreads, totals.
 * Odds format:     decimal (required by the engine).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { API_CONFIG, PRIORITY_SPORTS, QUOTA, POLL_CONFIG } from "../config.js";

const BASE = API_CONFIG.theOddsApi.baseUrl;
const KEY  = API_CONFIG.theOddsApi.key;

// ── Quota tracker (updated from response headers) ──────────────────────────
export const quota = {
  used:      null,
  remaining: null,
  lastCheck: null,
};

/**
 * Estimate the Odds API credit cost for one sport request.
 * The official formula is: regions x markets.
 */
export function estimateSportRequestCost({
  regions = API_CONFIG.theOddsApi.regions,
  markets = API_CONFIG.theOddsApi.markets,
} = {}) {
  return countCsvValues(regions) * countCsvValues(markets);
}

/**
 * Estimate how many API credits a fetch cycle will cost.
 * @param {number} numSports  - number of sport feeds to fetch
 * @returns {number} estimated credit count
 */
export function estimateFetchCost(
  numSports = POLL_CONFIG.maxSports,
  {
    regions = API_CONFIG.theOddsApi.regions,
    markets = API_CONFIG.theOddsApi.markets,
  } = {}
) {
  return QUOTA.costForSportsList + (numSports * estimateSportRequestCost({ regions, markets }));
}

/**
 * Check whether a fetch is safe to proceed given current quota.
 * @returns {{ ok: boolean, level: 'ok'|'warn'|'stop', remaining: number|null, message: string }}
 */
export function checkQuotaSafety(plannedCost = 1) {
  const remaining = quota.remaining;
  if (remaining === null) return { ok: true, level: "ok", remaining: null, message: "Quota unknown — proceeding" };
  if (remaining < plannedCost) {
    return {
      ok: false,
      level: "stop",
      remaining,
      message: `Estimated fetch cost is ${plannedCost} requests but only ${remaining} remain this month.`,
    };
  }
  if (remaining <= QUOTA.stopThreshold) {
    return {
      ok: false, level: "stop", remaining,
      message: `Only ${remaining} requests left this month — fetching paused to protect your quota. Resets next month.`,
    };
  }
  if (remaining <= QUOTA.warnThreshold) {
    return {
      ok: true, level: "warn", remaining,
      message: `Low quota warning: ${remaining} requests remaining. Switch to manual-only fetching.`,
    };
  }
  return { ok: true, level: "ok", remaining, message: `${remaining} requests remaining` };
}

// ── Book name normalisation map ────────────────────────────────────────────
const BOOK_DISPLAY_NAMES = {
  bet365:           "Bet365",
  draftkings:       "DraftKings",
  fanduel:          "FanDuel",
  betmgm:           "BetMGM",
  caesars:          "Caesars",
  pinnacle:         "Pinnacle",
  betfair_ex_eu:    "Betfair",
  betfair_ex_uk:    "Betfair",
  unibet_eu:        "Unibet",
  unibet_uk:        "Unibet",
  williamhill_us:   "William Hill",
  williamhill:      "William Hill",
  pointsbetus:      "PointsBet",
  betus:            "BetUS",
  mybookieag:       "MyBookie",
  betonlineag:      "BetOnline",
  lowvig:           "LowVig",
  matchbook:        "Matchbook",
  circa:            "Circa",
  superbook:        "SuperBook",
  wynnbet:          "WynnBet",
  barstool:         "Barstool",
  foxbet:           "FoxBet",
  twinspires:       "TwinSpires",
  betrivers:        "BetRivers",
  unibet_us:        "Unibet",
  hardrockbet:      "Hard Rock Bet",
  espnbet:          "ESPN Bet",
  fliff:            "Fliff",
};

// ── Market type map ─────────────────────────────────────────────────────────
const MARKET_TYPE_MAP = {
  h2h:     "moneyline",
  spreads: "spread",
  totals:  "totals",
};

// ── Sport normalisation ─────────────────────────────────────────────────────
const SPORT_CATEGORY_MAP = {
  basketball:      "basketball",
  americanfootball:"americanfootball",
  soccer:          "soccer",
  baseball:        "baseball",
  icehockey:       "icehockey",
  tennis:          "tennis",
  mma:             "mma",
  boxing:          "boxing",
  golf:            "golf",
  cricket:         "cricket",
  rugby:           "rugby",
};

// ── Settlement rules by market type (fallback strings) ─────────────────────
const SETTLEMENT_RULES = {
  moneyline: "Official result. Overtime included unless otherwise stated.",
  spread:    "Official result including overtime. Push returns stake.",
  totals:    "Official combined score including overtime. Push returns stake.",
};

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the list of in-season sports from The Odds API.
 * Returns an array of sport objects: { key, group, title, description, active, has_outrights }
 */
export async function fetchInSeasonSports() {
  const url = `${BASE}/sports?apiKey=${KEY}`;
  const res = await apiFetch(url);
  updateQuotaFromResponse(res);
  const sports = await res.json();
  return sports.filter((s) => s.active && !s.has_outrights);
}

/**
 * Fetch odds for a single sport key.
 * @param {string} sportKey  - e.g. "basketball_nba"
 * @param {object} options
 * @param {string} options.regions    - comma-separated regions (default: "eu,us")
 * @param {string} options.markets    - comma-separated market keys (default: "h2h,spreads,totals")
 * @param {string} options.oddsFormat - "decimal" | "american" (default: "decimal")
 * @returns {Array} raw event objects from The Odds API
 */
export async function fetchSportOdds(sportKey, {
  regions    = API_CONFIG.theOddsApi.regions,
  markets    = API_CONFIG.theOddsApi.markets,
  oddsFormat = "decimal",
} = {}) {
  const params = new URLSearchParams({
    apiKey: KEY,
    regions,
    markets,
    oddsFormat,
    dateFormat: "iso",
  });
  const url = `${BASE}/sports/${sportKey}/odds?${params}`;
  let res;
  try {
    res = await apiFetch(url);
  } catch (err) {
    console.warn(`[OddsAPI] ${sportKey} fetch failed:`, err.message);
    return [];
  }
  if (res.status === 422) {
    // Sport exists but has no upcoming events with odds
    return [];
  }
  if (!res.ok) {
    console.warn(`[OddsAPI] ${sportKey} returned ${res.status}`);
    return [];
  }

  updateQuotaFromResponse(res);

  console.log(`[OddsAPI] ${sportKey} — quota: ${quota.used} used / ${quota.remaining} remaining`);
  return res.json();
}

/**
 * Fetch odds for multiple sports and return a unified ENGINE_CONTRACT snapshot.
 * @param {object} options
 * @param {number} options.maxSports  - cap on concurrent sport feeds (quota guard)
 * @param {string} options.markets    - comma-separated market keys
 * @param {string[]} options.sports   - explicit list of sport keys (overrides auto-detect)
 * @returns {object} ENGINE_CONTRACT snapshot
 */
export async function fetchAllLiveOdds({
  maxSports = POLL_CONFIG.maxSports,
  markets   = API_CONFIG.theOddsApi.markets,
  sports    = null,
} = {}) {
  // Determine which sports to fetch
  let targetSports = sports;
  if (!targetSports) {
    try {
      const activeSports = await fetchInSeasonSports();
      const activeKeys   = new Set(activeSports.map((s) => s.key));
      targetSports = PRIORITY_SPORTS.filter((k) => activeKeys.has(k)).slice(0, maxSports);
      console.log(`[OddsAPI] Active priority sports: ${targetSports.join(", ")}`);
    } catch (err) {
      console.warn("[OddsAPI] Could not fetch sport list, using priority defaults:", err.message);
      targetSports = PRIORITY_SPORTS.slice(0, maxSports);
    }
  }

  // Fetch each sport — quota-gated, sequential with brief pauses
  const allEvents = [];
  for (const sportKey of targetSports) {
    // Check quota before every request
    const safety = checkQuotaSafety();
    if (!safety.ok) {
      console.warn(`[OddsAPI] ${safety.message} — stopping after ${allEvents.length} events`);
      break;
    }
    if (safety.level === "warn") {
      console.warn(`[OddsAPI] ${safety.message}`);
    }
    const events = await fetchSportOdds(sportKey, { markets });
    allEvents.push(...events);
    if (targetSports.indexOf(sportKey) < targetSports.length - 1) {
      await sleep(250); // polite pause between sport calls
    }
  }

  console.log(`[OddsAPI] Total events fetched: ${allEvents.length}`);
  return normalizeToSnapshot(allEvents);
}

// ═══════════════════════════════════════════════════════════════════════════
// Normalization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert raw Odds API events array into ENGINE_CONTRACT snapshot.
 */
export function normalizeToSnapshot(events) {
  const snapshotAt = new Date().toISOString();
  const markets    = [];

  for (const event of events) {
    // Group all bookmakers' data by market type
    const marketsByType = groupBooksByMarketType(event);

    for (const [marketType, books] of Object.entries(marketsByType)) {
      // Only keep markets where at least one book is present
      if (books.length === 0) continue;

      markets.push({
        id:              `${event.id}-${marketType}`,
        sport:           normalizeSport(event.sport_key),
        league:          event.sport_title,
        event:           `${event.home_team} vs ${event.away_team}`,
        homeTeam:        event.home_team,
        awayTeam:        event.away_team,
        commenceTime:    event.commence_time,
        snapshotAt,
        marketType,
        settlementRules: SETTLEMENT_RULES[marketType] ?? null,
        model:           null,   // populated by ML layer in Phase 2
        books,
        // Raw source for debugging
        _sourceEventId:  event.id,
        _sportKey:       event.sport_key,
      });
    }
  }

  return {
    snapshotAt,
    provider:     "the-odds-api",
    totalEvents:  events.length,
    quota:        { ...quota },
    markets,
  };
}

/**
 * For a single Odds API event, build a map of marketType → books array.
 * Handles deduplication when the same bookmaker appears under multiple regions.
 */
function groupBooksByMarketType(event) {
  const result = {}; // marketType -> Map<bookName, bookEntry>

  for (const bookmaker of (event.bookmakers ?? [])) {
    const bookName    = resolveBookName(bookmaker.key);
    const updatedAt   = bookmaker.last_update ?? event.commence_time;

    for (const market of (bookmaker.markets ?? [])) {
      const marketType = MARKET_TYPE_MAP[market.key] ?? market.key;

      if (!result[marketType]) result[marketType] = new Map();
      const byBook = result[marketType];

      // Dedup: keep the more recently updated entry for the same book
      if (byBook.has(bookName)) {
        const existing = byBook.get(bookName);
        if (updatedAt > existing.updatedAt) {
          byBook.set(bookName, buildBookEntry(bookName, updatedAt, market.outcomes));
        }
      } else {
        byBook.set(bookName, buildBookEntry(bookName, updatedAt, market.outcomes));
      }
    }
  }

  // Convert Maps → arrays
  const final = {};
  for (const [mt, bookMap] of Object.entries(result)) {
    final[mt] = Array.from(bookMap.values());
  }
  return final;
}

function buildBookEntry(bookName, updatedAt, outcomes) {
  return {
    name:      bookName,
    updatedAt: updatedAt ?? new Date().toISOString(),
    outcomes:  outcomes.map((o) => ({
      name:  o.name,
      price: Number(o.price),
      ...(o.point != null ? { point: o.point } : {}),
    })),
  };
}

function resolveBookName(key) {
  return BOOK_DISPLAY_NAMES[key] ?? toTitleCase(key);
}

function normalizeSport(sportKey) {
  for (const [prefix, category] of Object.entries(SPORT_CATEGORY_MAP)) {
    if (sportKey.startsWith(prefix)) return category;
  }
  return sportKey;
}

function toTitleCase(str) {
  return String(str).replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiFetch(url) {
  const res = await fetch(url);
  if (res.status === 401) throw new Error("Invalid Odds API key — check config.js");
  if (res.status === 429) throw new Error("Odds API rate limit hit — slow down requests");
  if (res.status === 403) throw new Error("Odds API quota exhausted");
  return res;
}

function updateQuotaFromResponse(res) {
  const used = res.headers.get("x-requests-used");
  const remaining = res.headers.get("x-requests-remaining");
  if (used !== null) quota.used = parseInt(used, 10);
  if (remaining !== null) quota.remaining = parseInt(remaining, 10);
  quota.lastCheck = new Date().toISOString();
}

function countCsvValues(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

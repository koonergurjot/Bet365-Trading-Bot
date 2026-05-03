/**
 * OddsBlaze Adapter — supplementary bookmaker feed
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches odds from https://oddsblaze.com and returns normalized book entries
 * that can be merged into an existing snapshot from The Odds API.
 *
 * OddsBlaze is per-sportsbook / per-league, so one request = one book in one league.
 * Use it to fill in bookmakers not covered by The Odds API, or to double-check
 * specific lines.
 *
 * NOTE: Trial key expires after 24 hours. All calls are wrapped in try/catch
 * so a stale key never crashes the main data pipeline.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { API_CONFIG } from "../config.js";
import { americanToDecimal } from "../engine/oddsMath.js";
import { canonicalizeTeamName, canonicalizeText } from "../engine/marketNormalizer.js";

const BASE = API_CONFIG.oddsBlaze.baseUrl;
const KEY  = API_CONFIG.oddsBlaze.key;

// Map OddsBlaze league slugs → display labels used for event matching
const LEAGUE_META = {
  nba:   { sport: "basketball",       league: "NBA" },
  nfl:   { sport: "americanfootball", league: "NFL" },
  mlb:   { sport: "baseball",         league: "MLB" },
  nhl:   { sport: "icehockey",        league: "NHL" },
  ncaab: { sport: "basketball",       league: "NCAAB" },
  ncaaf: { sport: "americanfootball", league: "NCAAF" },
  epl:   { sport: "soccer",           league: "Premier League" },
  mls:   { sport: "soccer",           league: "MLS" },
};

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch odds for one sportsbook + league combination from OddsBlaze.
 * Returns raw API response or null on failure.
 *
 * @param {string} sportsbook  - e.g. "bet365", "draftkings"
 * @param {string} league      - e.g. "nba", "epl"
 */
export async function fetchOddsBlazeRaw(sportsbook, league) {
  const url = `${BASE}/?sportsbook=${encodeURIComponent(sportsbook)}&league=${encodeURIComponent(league)}&key=${KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn(`[OddsBlaze] Auth failed for ${sportsbook}/${league} — trial key may be expired`);
      } else {
        console.warn(`[OddsBlaze] ${sportsbook}/${league} returned ${res.status}`);
      }
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[OddsBlaze] ${sportsbook}/${league} fetch error:`, err.message);
    return null;
  }
}

/**
 * Fetch supplementary book data for the given leagues and sportsbooks.
 * Returns a flat array of normalised book-entries grouped by a fuzzy event key.
 *
 * Shape returned:
 * [
 *   {
 *     eventKey: "nba::denver nuggets vs minnesota timberwolves::2026-05-04",
 *     sport:    "basketball",
 *     league:   "NBA",
 *     book: {
 *       name:      "Bet365",
 *       updatedAt: "...",
 *       outcomes:  [{ name: "Denver Nuggets", price: 1.95 }, ...]
 *     }
 *   }, ...
 * ]
 *
 * @param {string[]} leagues     - OddsBlaze league slugs to fetch
 * @param {string[]} sportsbooks - OddsBlaze sportsbook slugs to fetch
 */
export async function fetchSupplementaryBooks({
  leagues    = API_CONFIG.oddsBlaze.leagues,
  sportsbooks = API_CONFIG.oddsBlaze.sportsbooks,
} = {}) {
  const results = [];

  for (const league of leagues) {
    const meta = LEAGUE_META[league];
    if (!meta) continue;

    for (const sportsbook of sportsbooks) {
      const data = await fetchOddsBlazeRaw(sportsbook, league);
      if (!data) continue;

      const entries = extractBookEntries(data, sportsbook, meta);
      results.push(...entries);

      // Hard limit: 30 req/min = 1 every 2s. Use 2.1s to stay safely under.
      await sleep(API_CONFIG.oddsBlaze.sleepMsBetweenCalls ?? 2100);
    }
  }

  console.log(`[OddsBlaze] Collected ${results.length} book entries across ${leagues.length} leagues`);
  return results;
}

/**
 * Merge OddsBlaze supplementary entries into an existing ENGINE_CONTRACT snapshot.
 * Matches by fuzzy event key (normalized team names + date).
 * Only adds a book if it is not already present in the market.
 *
 * @param {object}   snapshot  - existing ENGINE_CONTRACT snapshot
 * @param {Array}    entries   - result of fetchSupplementaryBooks()
 * @returns {object} mutated snapshot (same reference)
 */
export function mergeIntoSnapshot(snapshot, entries) {
  if (!entries.length) return snapshot;

  // Build a lookup from normalized event key → market index
  const marketIndex = new Map();
  snapshot.markets.forEach((mkt, idx) => {
    const key = buildEventKey(mkt.sport, mkt.event, mkt.commenceTime);
    if (!marketIndex.has(key)) marketIndex.set(key, []);
    marketIndex.get(key).push(idx);
  });

  let added = 0;
  for (const entry of entries) {
    const indices = marketIndex.get(entry.eventKey);
    if (!indices) continue;

    for (const idx of indices) {
      const mkt = snapshot.markets[idx];
      // Only add to moneyline markets for now (OddsBlaze primarily covers h2h)
      if (mkt.marketType !== "moneyline") continue;
      // Skip if this bookmaker is already present
      const alreadyPresent = mkt.books.some(
        (b) => b.name.toLowerCase() === entry.book.name.toLowerCase()
      );
      if (alreadyPresent) continue;
      mkt.books.push(entry.book);
      added++;
    }
  }

  if (added > 0) {
    console.log(`[OddsBlaze] Added ${added} supplementary book entries to snapshot`);
  }
  return snapshot;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

function extractBookEntries(data, sportsbook, meta) {
  const bookDisplayName = toTitleCase(sportsbook);
  const games = data?.games ?? data?.data ?? [];
  const entries = [];
  const now = new Date().toISOString();

  for (const game of games) {
    try {
      const homeTeam  = game.home_team ?? game.home ?? game.homeTeam ?? "";
      const awayTeam  = game.away_team ?? game.away ?? game.awayTeam ?? "";
      const startTime = game.start_time ?? game.commence_time ?? game.startTime ?? now;
      if (!homeTeam || !awayTeam) continue;

      const eventName = `${homeTeam} vs ${awayTeam}`;
      const eventKey  = buildEventKey(meta.sport, eventName, startTime);

      // Try to extract moneyline odds (American or decimal)
      const outcomes = extractMoneylineOutcomes(game, homeTeam, awayTeam);
      if (outcomes.length < 2) continue;

      entries.push({
        eventKey,
        sport:  meta.sport,
        league: meta.league,
        book: {
          name:      bookDisplayName,
          updatedAt: now,
          outcomes,
        },
      });
    } catch (err) {
      // Skip malformed game entries
    }
  }
  return entries;
}

function extractMoneylineOutcomes(game, homeTeam, awayTeam) {
  const outcomes = [];

  // Try various OddsBlaze response shapes
  const ml = game.odds?.moneyline
          ?? game.moneyline
          ?? game.h2h
          ?? null;

  if (ml) {
    // Shape: { home: { line: -110 }, away: { line: +100 }, draw: { line: +300 } }
    const homeLine = ml.home?.line ?? ml.home?.price ?? ml.home ?? null;
    const awayLine = ml.away?.line ?? ml.away?.price ?? ml.away ?? null;
    const drawLine = ml.draw?.line ?? ml.draw?.price ?? ml.draw ?? null;

    if (homeLine != null) outcomes.push({ name: homeTeam, price: toDecimal(homeLine) });
    if (awayLine != null) outcomes.push({ name: awayTeam, price: toDecimal(awayLine) });
    if (drawLine != null) outcomes.push({ name: "Draw",    price: toDecimal(drawLine) });
  } else if (Array.isArray(game.outcomes)) {
    // Shape: outcomes array with { name, price/odds }
    for (const o of game.outcomes) {
      const price = o.price ?? o.odds ?? o.decimal ?? null;
      if (o.name && price != null) {
        outcomes.push({ name: o.name, price: toDecimal(price) });
      }
    }
  }

  return outcomes.filter((o) => o.price > 1);
}

/**
 * Convert American or decimal odds to decimal.
 * If |value| > 2 and it's a whole number, assume American.
 */
function toDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  // Heuristic: treat as American if |n| >= 100 and it looks like an integer line
  if (Math.abs(n) >= 100 && Number.isInteger(n)) {
    return americanToDecimal(n);
  }
  // Already decimal
  return n > 1 ? n : 0;
}

function buildEventKey(sport, eventName, commenceTime) {
  const datePart = commenceTime ? commenceTime.slice(0, 10) : "";
  return `${sport}::${normalizeEventName(eventName)}::${datePart}`;
}

function normalizeEventName(name) {
  const normalized = canonicalizeText(name);
  if (normalized.includes(" vs ")) {
    return normalized
      .split(" vs ")
      .map((part) => canonicalizeTeamName(part))
      .join(" vs ");
  }
  return canonicalizeTeamName(normalized);
}

function toTitleCase(str) {
  return String(str).replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

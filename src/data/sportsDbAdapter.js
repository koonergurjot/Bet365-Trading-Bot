/**
 * TheSportsDB Adapter — team metadata & logos
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides team badges, stadium info, and canonical team names.
 * Used for UI enrichment (team logos in signal cards, etc.).
 * Free tier — key "123". All calls are cached in-memory to avoid redundant fetches.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { API_CONFIG } from "../config.js";

const BASE = API_CONFIG.sportsDb.baseUrl;
const CACHE_KEY = "bet365EdgeBrain:sportsDbCache";

// ── In-memory cache (lives for the duration of the page session) ───────────
const _cache = new Map();
hydrateCache();

// ── Known league IDs in TheSportsDB ───────────────────────────────────────
const LEAGUE_IDS = {
  "NBA":              "4387",
  "NFL":              "4391",
  "MLB":              "4424",
  "NHL":              "4380",
  "Premier League":   "4328",
  "La Liga":          "4335",
  "Bundesliga":       "4331",
  "Serie A":          "4332",
  "Ligue 1":          "4334",
  "MLS":              "4346",
  "Champions League": "4480",
};

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search for a team by name and return its badge URL + metadata.
 * Returns null if not found or on network error.
 *
 * @param {string} teamName
 * @returns {Promise<{name, badge, stadium, country, formed}|null>}
 */
export async function getTeamInfo(teamName) {
  const cacheKey = `team::${teamName.toLowerCase().trim()}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  try {
    const url = `${BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const t = data?.teams?.[0];
    if (!t) {
      _cache.set(cacheKey, null);
      persistCache();
      return null;
    }
    const result = {
      name:    t.strTeam,
      badge:   t.strBadge   ? `${t.strBadge}/preview`  : null,
      banner:  t.strBanner  ? `${t.strBanner}/preview`  : null,
      stadium: t.strStadium ?? null,
      country: t.strCountry ?? null,
      formed:  t.intFormedYear ?? null,
      sport:   t.strSport?.toLowerCase() ?? null,
    };
    _cache.set(cacheKey, result);
    persistCache();
    return result;
  } catch (err) {
    console.warn(`[SportsDB] getTeamInfo("${teamName}"):`, err.message);
    _cache.set(cacheKey, null);
    persistCache();
    return null;
  }
}

/**
 * Fetch all teams in a league by league name.
 * Returns array of team info objects.
 *
 * @param {string} leagueName  - e.g. "NBA", "Premier League"
 * @returns {Promise<Array>}
 */
export async function getLeagueTeams(leagueName) {
  const leagueId = LEAGUE_IDS[leagueName];
  if (!leagueId) return [];

  const cacheKey = `league::${leagueId}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  try {
    const url  = `${BASE}/lookup_all_teams.php?id=${leagueId}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const teams = (data?.teams ?? []).map((t) => ({
      name:    t.strTeam,
      badge:   t.strBadge   ? `${t.strBadge}/preview`  : null,
      stadium: t.strStadium ?? null,
      country: t.strCountry ?? null,
    }));
    _cache.set(cacheKey, teams);
    persistCache();
    return teams;
  } catch (err) {
    console.warn(`[SportsDB] getLeagueTeams("${leagueName}"):`, err.message);
    _cache.set(cacheKey, []);
    persistCache();
    return [];
  }
}

/**
 * Pre-warm the team cache for a set of events (background fetch).
 * Call this after fetching a snapshot so team logos are ready when signals render.
 *
 * @param {object[]} markets  - ENGINE_CONTRACT markets array
 */
export async function prewarmTeamCache(markets) {
  const teamNames = new Set();
  for (const mkt of markets) {
    if (mkt.homeTeam) teamNames.add(mkt.homeTeam);
    if (mkt.awayTeam) teamNames.add(mkt.awayTeam);
  }

  let loaded = 0;
  for (const name of teamNames) {
    const cacheKey = `team::${name.toLowerCase().trim()}`;
    if (_cache.has(cacheKey)) continue;
    await getTeamInfo(name);
    loaded++;
    await sleep(API_CONFIG.sportsDb.sleepMsBetweenCalls ?? 1100); // ~1 req/sec
  }

  if (loaded > 0) {
    console.log(`[SportsDB] Pre-warmed ${loaded} team entries`);
  }
}

/**
 * Get badge URL for a team name (fast — returns null if not in cache).
 * Use prewarmTeamCache() first for best results.
 *
 * @param {string} teamName
 * @returns {string|null}
 */
export function getCachedBadge(teamName) {
  const key = `team::${teamName?.toLowerCase().trim()}`;
  return _cache.get(key)?.badge ?? null;
}

/**
 * Clear the in-memory cache (useful for testing).
 */
export function clearCache() {
  _cache.clear();
  persistCache();
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hydrateCache() {
  const storage = getStorage();
  if (!storage) return;

  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    for (const [key, value] of Object.entries(parsed)) {
      _cache.set(key, value);
    }
  } catch {
    // Ignore malformed cache state.
  }
}

function persistCache() {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(_cache.entries())));
  } catch {
    // Ignore storage failures.
  }
}

function getStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * FBref scraper — soccer advanced stats.
 *
 * SCRAPE TARGET: https://fbref.com
 *
 * For each event { home, away, league, commenceTime }, return:
 *   {
 *     home: {
 *       rollingXG: number,        // last 5–10 games, league-weighted
 *       rollingXGA: number,
 *       npxG: number,
 *       form5: string,            // e.g. "WWDLW"
 *       restDays: number,
 *     },
 *     away: { ... same shape ... },
 *     modelInputs: {
 *       homeAdv: number,                  // baseline by league
 *       expectedGoalsHome: number,        // tuned for Poisson model
 *       expectedGoalsAway: number,
 *     }
 *   }
 *
 * MUST:
 * - Run only in a Cloudflare Worker (never browser).
 * - Cache season tables for ~24h.
 * - Cache per-team game logs for ~6h.
 * - Use a descriptive User-Agent.
 * - Honor robots.txt and rate-limit (≤1 req/sec).
 * - Return null fields (not fake numbers) if data is unavailable.
 *
 * Status: STUB — implement in Phase 2.
 */

export const META = {
  source: 'fbref',
  sportsSupported: ['soccer'],
  refreshSeconds: 21600, // 6h for game-log freshness
};

export async function scrape(event) {
  // TODO(Phase 2): implement fetch + parse against fbref season tables and team match logs.
  // For now, return an empty partial so the engine knows we tried.
  return {
    _source: META.source,
    _scrapedAt: new Date().toISOString(),
    _status: 'stub',
    home: null,
    away: null,
    modelInputs: null,
  };
}

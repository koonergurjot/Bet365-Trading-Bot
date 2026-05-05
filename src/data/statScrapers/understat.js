/**
 * Understat scraper — soccer xG with shot location detail.
 *
 * SCRAPE TARGET: https://understat.com
 *
 * Provides shot-by-shot xG, expected points, and a clear "luck"
 * signal (teams over- or under-performing xG).
 *
 * RETURN SHAPE:
 *   {
 *     home: {
 *       xgLuck: number,        // (goals − xG) over last N matches
 *       xgPerShot: number,
 *       shotShare: number,     // share of shots in recent games
 *     },
 *     away: { ... },
 *   }
 *
 * Status: STUB — implement in Phase 2.
 */

export const META = {
  source: 'understat',
  sportsSupported: ['soccer'],
  refreshSeconds: 21600,
};

export async function scrape(event) {
  return {
    _source: META.source,
    _scrapedAt: new Date().toISOString(),
    _status: 'stub',
    home: null,
    away: null,
  };
}

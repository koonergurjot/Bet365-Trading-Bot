/**
 * Pro-Football-Reference scraper — NFL (and CFB) advanced metrics.
 *
 * SCRAPE TARGET: https://www.pro-football-reference.com
 *
 * Backbone of NFL signal generation. Use NFLfastR-style public datasets
 * (via GitHub mirrors) where possible for higher-fidelity EPA/CPOE/WPA;
 * fall back to PFR HTML scraping for season tables and team splits.
 *
 * RETURN SHAPE:
 *   {
 *     home: {
 *       offEPA: number,         // opponent-adjusted, season-to-date
 *       defEPA: number,
 *       passSuccessRate: number,
 *       runSuccessRate: number,
 *       pace: number,
 *       restDays: number,
 *       qb: { name, status: 'STARTER' | 'BACKUP' | 'QUESTIONABLE' },
 *     },
 *     away: { ... },
 *     modelInputs: {
 *       teamStrengthHome: number,
 *       teamStrengthAway: number,
 *       expectedTotal: number,
 *       expectedSpread: number,
 *     }
 *   }
 *
 * Status: STUB — implement in Phase 2.
 */

export const META = {
  source: 'pfr',
  sportsSupported: ['nfl', 'cfb'],
  refreshSeconds: 86400, // daily; weekly post-game refresh is fine
};

export async function scrape(event) {
  return {
    _source: META.source,
    _scrapedAt: new Date().toISOString(),
    _status: 'stub',
    home: null,
    away: null,
    modelInputs: null,
  };
}

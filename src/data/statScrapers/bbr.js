/**
 * Basketball-Reference scraper — NBA team and player stats.
 *
 * SCRAPE TARGET: https://www.basketball-reference.com
 *
 * Use NBA.com Stats endpoints in addition for tracking and lineup data.
 *
 * RETURN SHAPE:
 *   {
 *     home: {
 *       ortg: number,          // offensive rating (last 10)
 *       drtg: number,
 *       pace: number,
 *       restDays: number,
 *       b2b: boolean,
 *       starOut: string[],     // names of high-impact players unavailable
 *     },
 *     away: { ... },
 *     modelInputs: {
 *       expectedPossessions: number,
 *       expectedTotal: number,
 *       expectedSpread: number,
 *     }
 *   }
 *
 * Status: STUB — implement in Phase 2.
 */

export const META = {
  source: 'bbr',
  sportsSupported: ['nba'],
  refreshSeconds: 86400,
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

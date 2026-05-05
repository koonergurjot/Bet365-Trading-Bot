/**
 * ESPN scraper — lineups, injuries, weather, in-match events.
 *
 * SCRAPE TARGETS:
 *   https://www.espn.com/soccer
 *   https://www.espn.com/nfl
 *   https://www.espn.com/college-football
 *   https://www.espn.com/nba
 *
 * The single highest-leverage live source for short-fuse signals
 * (late lineup changes, injury upgrades/downgrades, weather updates).
 *
 * RETURN SHAPE:
 *   {
 *     lineups: { home: [...], away: [...] } | null,
 *     injuries: { home: [{ player, status }], away: [...] },
 *     weather: { tempF, windMph, precipPct } | null,
 *     keyAbsences: { home: [...], away: [...] }, // shortlist for UI display
 *   }
 *
 * MUST:
 * - Refresh frequently for events within 2 hours of kickoff.
 * - De-duplicate against the previous scrape; only emit deltas to lower noise.
 *
 * Status: STUB — implement in Phase 2 (start with NFL injuries + soccer lineups).
 */

export const META = {
  source: 'espn',
  sportsSupported: ['soccer', 'nfl', 'cfb', 'nba'],
  refreshSeconds: 600, // 10m, tightens to 60s within 2h of kickoff
};

export async function scrape(event) {
  return {
    _source: META.source,
    _scrapedAt: new Date().toISOString(),
    _status: 'stub',
    lineups: null,
    injuries: { home: [], away: [] },
    weather: null,
    keyAbsences: { home: [], away: [] },
  };
}

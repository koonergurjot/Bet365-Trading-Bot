/**
 * statScrapers — orchestrator.
 *
 * Iterates over all registered adapters that support the given event's
 * sport, calls them in parallel, merges the partial results, and returns
 * a single statContext block to attach to the event in the snapshot.
 *
 * The recommendation engine reads `event.statContext` and uses it to
 * adjust probability beyond no-vig consensus. If statContext is missing
 * or marked stale, the engine MUST lower confidence rather than ignore
 * the absence silently.
 *
 * Status: orchestrator wiring complete; adapters are stubs. Phase 2 fills them in.
 */

import * as fbref from './fbref.js';
import * as understat from './understat.js';
import * as espn from './espn.js';
import * as pfr from './pfr.js';
import * as bbr from './bbr.js';

const ADAPTERS = [fbref, understat, espn, pfr, bbr];

function normalizeSport(sport) {
  if (!sport) return '';
  const s = String(sport).toLowerCase();
  if (s.includes('soccer') || s.includes('football') && !s.includes('american')) return 'soccer';
  if (s.includes('nfl')) return 'nfl';
  if (s.includes('college') && s.includes('football')) return 'cfb';
  if (s.includes('basketball') || s.includes('nba')) return 'nba';
  return s;
}

/**
 * Build a statContext for one event by fanning out to every supporting adapter.
 *
 * @param {object} event
 * @returns {Promise<object>}
 */
export async function buildStatContext(event) {
  const sport = normalizeSport(event.sport || event.league);
  const supporting = ADAPTERS.filter(a => a.META.sportsSupported.includes(sport));

  if (supporting.length === 0) {
    return {
      scrapedAt: new Date().toISOString(),
      sources: [],
      freshness: {},
      home: null,
      away: null,
      modelInputs: null,
      _note: `No stat scraper supports sport "${sport}".`,
    };
  }

  const results = await Promise.allSettled(
    supporting.map(a => a.scrape(event))
  );

  const merged = {
    scrapedAt: new Date().toISOString(),
    sources: [],
    freshness: {},
    home: {},
    away: {},
    modelInputs: {},
  };

  results.forEach((r, i) => {
    const adapter = supporting[i];
    if (r.status !== 'fulfilled' || !r.value) {
      merged.sources.push({ name: adapter.META.source, status: 'failed' });
      return;
    }
    const v = r.value;
    merged.sources.push({ name: adapter.META.source, status: v._status || 'ok' });
    merged.freshness[adapter.META.source] = v._scrapedAt;
    if (v.home) Object.assign(merged.home, v.home);
    if (v.away) Object.assign(merged.away, v.away);
    if (v.modelInputs) Object.assign(merged.modelInputs, v.modelInputs);
  });

  return merged;
}

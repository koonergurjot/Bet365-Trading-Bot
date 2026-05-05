# Stat Scrapers

Per-source adapters that pull public sports statistics and normalize them into a `statContext` block on each event in a snapshot.

## Why this exists

The recommendation engine becomes meaningfully better than no-vig consensus only when it has *informed* probability — i.e. probability adjusted by current player and team performance, injuries, lineups, weather, etc.

These scrapers are how that information enters the engine.

## Rules

- **Server-side only.** Run inside Cloudflare Workers. Never call from the browser.
- **Cache aggressively.** Most stat data refreshes daily.
- **Rate limit:** ≤ 1 req/sec per source. Back off on 429.
- **Identify honestly.** Use a descriptive User-Agent.
- **Fail loud, not silent.** If a scrape fails or is stale, mark it in `statContext.sources` and `statContext.freshness`. The engine will lower confidence accordingly.
- **No fabrication.** Never fill in defaults that look like real data.

## Interface (every adapter)

```js
/**
 * @param {object} event - canonical event { sport, league, eventId, home, away, commenceTime }
 * @returns {Promise<StatContextPartial>} - partial statContext, merged with other sources
 */
export async function scrape(event) { ... }

export const META = {
  source: 'fbref',
  sportsSupported: ['soccer'],
  refreshSeconds: 86400,
};
```

The orchestrator (`liveDataManager.js`) calls every adapter that supports the event's sport, merges the partial results, attaches them to the snapshot, and lets the engine consume `event.statContext`.

## Files

| File | Source | Sport(s) |
|---|---|---|
| `fbref.js` | FBref | Soccer |
| `understat.js` | Understat | Soccer |
| `espn.js` | ESPN | Soccer / NFL / CFB / NBA (lineups, injuries, weather) |
| `pfr.js` | Pro-Football-Reference | NFL |
| `bbr.js` | Basketball-Reference | NBA |

All currently stubs — see each file's header comment for what the implementation must produce.

See `docs/STAT_SOURCES.md` for the canonical field list and per-sport priority.

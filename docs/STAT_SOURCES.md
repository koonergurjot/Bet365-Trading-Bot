# Stat Sources

The scraping layer that turns raw odds into informed signals. Without this, the engine is just no-vig consensus and barely beats the books.

All scraping runs **server-side in Cloudflare Workers** with aggressive caching. No scraping from the browser. Respect `robots.txt` and reasonable rate limits.

---

## Per-Sport Source Map

### Soccer (Priority 1)

| Source | Fields | Refresh | Notes |
|---|---|---|---|
| **FBref** (fbref.com) | xG, xGA, npxG, shots, shots on target, possession, PPDA, deep completions, set-piece xG | Daily for league tables, post-match for game logs | Best advanced-metric coverage. Stable HTML structure. |
| **Understat** (understat.com) | xG, xGA, shot-by-shot xG with location, expected points | Post-match | Useful for variance/luck signal — teams over- or under-performing xG. |
| **ESPN Soccer** (espn.com/soccer) | Lineups, injuries, suspensions, weather (where listed), in-match events | Live during matches, ~1h before kickoff for lineups | Lineup news is the highest-leverage live update for soccer markets. |
| **Premier Injuries / Transfermarkt** | Long-term injury lists, expected return dates | Weekly | Backup injury source. |

**Key derived features for the model:**
- Rolling 5/10-game xG-for and xG-against (home/away split).
- Form-weighted Elo using xG margin instead of goals.
- Lineup strength delta vs season-average XI.
- Set-piece dependency (matters vs strong defensive sides).

---

### NFL + College Football (Priority 2)

| Source | Fields | Refresh | Notes |
|---|---|---|---|
| **Pro-Football-Reference** (pro-football-reference.com) | Team and player season/game logs, EPA, success rate, DVOA-style splits | Post-game | Backbone of any NFL model. |
| **CollegeFootballReference** | Same shape for CFB | Post-game | CFB has more variance, weight model accordingly. |
| **ESPN NFL/CFB** | Injury reports, weather, line movement, lineup changes | Live + pregame | Injury status (Q/D/O) is critical pre-kickoff. |
| **NFLfastR-style public datasets** (via GitHub mirrors) | Play-by-play with EPA, CPOE, WPA | Weekly post-game | Higher fidelity than scraping PFR for advanced metrics. |
| **Weather services** (NWS / Open-Meteo public API) | Wind, temp, precip at stadium coords | Hourly day-of-game | Wind > 15mph noticeably affects passing/totals. |

**Key derived features:**
- Opponent-adjusted EPA per play (offense and defense, splits).
- Pace × pass rate × success rate composite.
- QB starter status vs backup probability.
- Weather-adjusted total expectation.

---

### NBA (Priority 3)

| Source | Fields | Refresh | Notes |
|---|---|---|---|
| **Basketball-Reference** (basketball-reference.com) | Team ORtg/DRtg, pace, four factors, player on/off splits | Daily | Stable HTML, easy to parse. |
| **ESPN NBA** | Injury report, rest days, starting lineups, in-game events | Live + day-of | Late lineup scratches move totals and props heavily. |
| **NBA.com Stats** (stats.nba.com) | Hustle stats, lineup combinations, tracking data | Daily | API-flavored endpoints. Use politely. |

**Key derived features:**
- Pace-adjusted efficiency (predicted possessions × predicted ORtg).
- Rest day delta (B2B, 3-in-4, road back-to-back).
- Star player availability impact (load via player on/off).
- Total leans from pace × efficiency vs Bet365 posted total.

---

## Output Schema

Each scraped block is normalized into a `statContext` object attached to the corresponding event in the snapshot:

```json
{
  "eventId": "epl-mci-ars-2026-05-04",
  "statContext": {
    "scrapedAt": "2026-05-04T13:00:00.000Z",
    "sources": ["fbref", "understat", "espn"],
    "freshness": {
      "fbref": "2026-05-04T06:00:00.000Z",
      "espn":  "2026-05-04T12:55:00.000Z"
    },
    "home": {
      "rollingXG": 2.1,
      "rollingXGA": 0.9,
      "form5": "WWDWW",
      "lineupStrength": 0.97,
      "keyAbsences": ["De Bruyne (Q)"]
    },
    "away": {
      "rollingXG": 1.7,
      "rollingXGA": 1.1,
      "form5": "WLWWD",
      "lineupStrength": 0.92,
      "keyAbsences": []
    },
    "modelInputs": {
      "homeAdv": 0.25,
      "expectedGoalsHome": 1.85,
      "expectedGoalsAway": 1.10
    }
  }
}
```

The probability model consumes `statContext.modelInputs` plus market consensus. If `statContext` is missing or stale, the engine drops back to no-vig consensus only and **lowers confidence accordingly**.

---

## Scraping Rules

1. **Server-side only.** Cloudflare Workers. Never from the browser.
2. **Cache aggressively.** Most stat data refreshes once a day at most. Live data (lineups, injuries, weather) refreshes hourly or on demand.
3. **Respect rate limits.** No more than 1 request/sec per source. Back off on 429s.
4. **Identify the bot honestly.** Use a descriptive User-Agent.
5. **Graceful degrade.** If a source is down, signal that in `statContext.sources` and lower confidence — never silently fabricate data.
6. **No paywalled content.** All sources listed here are free and publicly accessible.
7. **Settlement-rule awareness.** Stats only matter if they map to the same market the bet is on (e.g. "shots on target" stat for "shots on target" prop, not for total goals).

---

## Implementation Status

| Source | Adapter | Status |
|---|---|---|
| FBref | `src/data/statScrapers/fbref.js` | Stub |
| Understat | `src/data/statScrapers/understat.js` | Stub |
| ESPN | `src/data/statScrapers/espn.js` | Stub |
| Pro-Football-Reference | `src/data/statScrapers/pfr.js` | Stub |
| Basketball-Reference | `src/data/statScrapers/bbr.js` | Stub |

Each stub documents the interface it must implement so the next AI session can fill in the actual scraping logic without rediscovering the design.

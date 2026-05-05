# AI Collaboration Rules

This repo is **vibe-coded by multiple LLMs** (primarily Codex and Claude Cowork). Read this file before making any change.

## The Mission (Read This First)

**This is a signals engine for Bet365.** Its only job is to constantly screen sports markets, find bets where Bet365's posted odds are mispriced versus true probability, and surface a short ranked list of high-EV / high-confidence picks. The user (Gurjot) reads those signals and places the bets manually in Bet365. **The end goal is consistent profit over time.**

If a proposed change does not directly make signals more accurate, faster, or easier to act on — push back or skip it.

### What this app is NOT

- **Not a bet tracker.** Bet365 already tracks placed bets, results, and P&L. Do not add bet-tracking features. The legacy tracker tab is hidden in the UI; do not re-enable it without explicit user request.
- **Not an auto-bettor.** Never add code that places bets on Bet365 on the user's behalf.
- **Not a generic odds comparison tool.** The comparison that matters is Bet365 price vs *true* probability (consensus + scraped stats), not Bet365 vs other books for its own sake.

## Repo & Hosting

- **GitHub:** https://github.com/koonergurjot/bet365-edge-brain
- **Cloudflare Pages:** deploys `main` branch automatically. Build command `exit 0`, output dir `/`.
- **Workers:** odds API calls and stat-site scraping run server-side in Cloudflare Workers (keys + rate limits stay out of the browser).

## Sport Priority

Build features for these sports first, in this order:

1. **Soccer** (EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL/UEL) — xG, form, lineups, injuries.
2. **NFL + College Football** — EPA, advanced rates, weather, injuries.
3. **NBA** — pace, ratings, rest days, injuries, props.

Do not spread effort across other sports until the top three produce calibrated, profitable signals.

## File Map

| File | Purpose |
|---|---|
| `index.html` | SPA shell: Signals (primary), Calculator, Data tabs. Tracker tab hidden. |
| `src/app.js` | UI logic, filters, calculator, CSV export. Legacy tracker code retained but tab hidden. |
| `src/styles.css` | Dark-mode design system. |
| `src/engine/oddsMath.js` | Pure math: EV, Kelly, vig removal, conversions. |
| `src/engine/recommendationEngine.js` | `analyzeSnapshot()` → ranked signals. |
| `src/engine/marketNormalizer.js` | Normalize cross-provider market shapes. |
| `src/engine/crossMarketAnalyzer.js` | Peer-book consensus comparison. |
| `src/data/oddsApiAdapter.js` etc. | Odds-provider adapters. |
| `src/data/statScrapers/` | Per-sport stat scrapers (ESPN, FBref, BBR, PFR). |
| `src/data/sample-markets.json` | Demo snapshot data. |
| `docs/MISSION.md` | One-page mission statement — **read this first in every new AI session**. |
| `docs/ENGINE_CONTRACT.md` | Snapshot/signal schema spec. |
| `docs/STAT_SOURCES.md` | Per-sport scraping targets and fields. |
| `docs/ROADMAP.md` | Phase plan. |
| `docs/DATA_PROVIDERS.md` | Odds API options. |
| `docs/DATA_ACCURACY_AND_RISK.md` | Reliability gates and known traps. |

## Prime Directive

**Protect correctness over speed.** Bad signals lose real money. Avoid silent assumptions, hidden data transformations, and untested logic changes. When in doubt, lower confidence rather than emit a noisy signal.

## Edit Rules

- Keep all recommendation logic in `src/engine/`.
- Keep UI-only behavior in `src/app.js` and `src/styles.css`.
- Keep odds-provider adapters in `src/data/`, stat scrapers in `src/data/statScrapers/`.
- Update `docs/ENGINE_CONTRACT.md` whenever the snapshot or signal schema changes.
- Add or update tests for any math, probability, scoring, or risk change.
- Never place API keys, scraping cookies, or session tokens in browser JavaScript, sample data, docs, or commits. Use Worker secrets.
- Do not add automated bet placement on Bet365.
- Do not re-add bet-tracking UI without explicit user request.

## Data Rules

- Treat every provider timestamp as part of the signal.
- Keep original provider odds, normalized odds, scraped stat features, and transformed probabilities all traceable to a snapshot.
- Store provider, book, market, outcome, timestamp, and settlement rule metadata.
- Flag stale, missing, or conflicting data — do not smooth it away.
- For odds: use licensed API providers, never scrape Bet365 directly.
- For stats: scrape public stat sites (ESPN, FBref, Understat, BBR, PFR) server-side with caching and respect for robots.txt + rate limits.

## Review Checklist

Before merging any change to engine logic:

- Does it distinguish Bet365 price from peer-market consensus?
- Does it remove vig or otherwise account for bookmaker margin?
- Does it use scraped stat features where available, not just market consensus?
- Does it prevent stale data from looking like an edge?
- Does it cap stake size?
- Does it expose uncertainty clearly to the user?
- Can the signal be acted on by a human within the next few minutes (i.e. is the price still likely live)?
- Does it move the project closer to the end goal of *consistent profit*?

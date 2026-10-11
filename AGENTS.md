# AI Collaboration Rules

This repo is **vibe-coded by multiple LLMs** (primarily Codex and Claude Cowork). Read this file before making any change.

## The Mission (Read This First)

**This is a private Canadian odds research engine for Gurjot.** Compare a selected destination bookmaker with peer no-vig consensus and a disclosed estimated probability. Support manual decisions only. Profitability is a goal to validate, never a claim derived from a heuristic score. Read `docs/MISSION.md` and `docs/ROADMAP.md` for current scope.

If a proposed change does not improve correctness, source reliability or ease of interpretation, skip it.

### What this app is NOT

- **Not a user bet tracker.** Keep the legacy tracker hidden; a prediction archive and paper-validation ledger are separate research infrastructure.
- **Not an auto-bettor.** Never add wager placement, deposits or sportsbook account operations.
- **Not proof of an edge.** A 0–100 research score is not win probability; consensus is not true probability. Unvalidated, stale, demo or unverified jurisdiction/rules mean zero actionable stake.

## Repo & Hosting

- **GitHub:** https://github.com/koonergurjot/Bet365-Trading-Bot
- **Local backend:** `npm run serve` runs a localhost-only Node server with same-origin odds proxy. Provider keys come from server environment only.
- **Remote deployment:** static Cloudflare Pages cannot execute this Node backend. An authenticated server-side equivalent is required and has not been verified.
- **Free coverage:** provider CA region includes PlayNow and Ontario-labelled books; do not assert free Canadian Bet365 coverage or provincial eligibility without actual verification. No paid plans, direct bookmaker scraping or automatic key reuse.

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

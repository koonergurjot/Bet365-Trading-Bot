# AI Collaboration Rules

This repo is designed for Codex, Claude Cowork, and future AI assistants to edit safely.

## Repo & Hosting

- **GitHub:** https://github.com/YOUR_GITHUB_USERNAME/bet365-edge-brain
  _(replace YOUR_GITHUB_USERNAME once confirmed — Codex could not push; user must add remote)_
- **Cloudflare Pages:** deploy from main branch, build command `exit 0`, output dir `/`
- **Current phase:** Phase 0 complete → Phase 1 (live data adapter) is next

## File Map

| File | Purpose |
|---|---|
| `index.html` | Full SPA: Signals, Calculator, Tracker, Data tabs |
| `src/app.js` | UI logic, filters, tracker, calculator, CSV export |
| `src/styles.css` | Dark-mode design system |
| `src/engine/oddsMath.js` | Pure math: EV, Kelly, vig removal, conversions |
| `src/engine/recommendationEngine.js` | Main engine: analyzeSnapshot → recommendations |
| `src/data/sample-markets.json` | Multi-sport demo data (NBA, EPL, ATP, Cricket, NFL) |
| `docs/ENGINE_CONTRACT.md` | Market snapshot schema spec |
| `docs/ROADMAP.md` | Phase roadmap |
| `docs/DATA_PROVIDERS.md` | Odds API options |

## Prime Directive

Protect correctness over speed. This code may influence real-money betting decisions, so avoid silent assumptions, hidden data transformations, and untested logic changes.

## Edit Rules

- Keep recommendation logic in `src/engine/`.
- Keep UI-only behavior in `src/app.js` and `src/styles.css`.
- Keep normalized market examples in `src/data/`.
- Update `docs/ENGINE_CONTRACT.md` whenever the market snapshot schema changes.
- Add or update tests for any math, probability, scoring, or risk change.
- Never place API keys in browser JavaScript, sample data, docs, or commits.
- Do not add automated bet placement without a separate approval gate and paper-trading audit.

## Data Rules

- Treat every provider timestamp as part of the signal.
- Keep original provider odds, normalized odds, and transformed probabilities traceable.
- Store provider, book, market, outcome, timestamp, and settlement rule metadata.
- Flag stale, missing, or conflicting data instead of smoothing it away.
- Prefer licensed API providers over scraping.

## Review Checklist

- Does the logic distinguish Bet365 price from peer-market consensus?
- Does it remove vig or otherwise account for bookmaker margin?
- Does it prevent stale data from looking like an edge?
- Does it cap stake size?
- Does it expose uncertainty clearly?
- Can a future command-center integration consume the output without scraping the UI?


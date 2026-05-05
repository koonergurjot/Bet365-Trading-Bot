# Bet365 Edge Brain

Standalone recommendation engine for comparing Bet365 odds against broader market prices, estimating probability, scoring expected value, and sizing risk-aware stakes.

This app is intentionally separate from the trading command center for now. It should mature as the "brain" first: data contracts, model logic, audit trails, exposure controls, and testing before any automated execution or command-center integration.

## Current State

- Static Cloudflare Pages compatible app with no build step.
- Manual JSON market snapshot editor for early testing.
- Live data path for The Odds API, OddsBlaze, and TheSportsDB.
- Engine modules for odds conversion, no-vig probability, expected value, Kelly stake sizing, confidence, data quality, risk labels, and portfolio exposure caps.
- Sample markets across basketball, soccer, and tennis.
- Local bet tracker with feedback/CLV learning signals.
- Node test suite for the core math, recommendation engine, history, feedback, cross-market context, and portfolio guardrails.
- AI collaboration docs for Codex, Claude, and future agents.

## Local Workflow

```powershell
cd "C:\Users\koone\Downloads\Bet365 Trade Bot\bet365-edge-brain"
npm test
```

To preview locally:

```powershell
npm run serve
```

Then open `http://127.0.0.1:8787`.

## Cloudflare Pages Setup

Use the GitHub repo as the source project.

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `/`
- Root directory: `/`

The app has a top-level `index.html`, so Cloudflare Pages can serve it directly.

## Production Guardrails

This application must not be treated as a guaranteed-profit machine. A positive expected value estimate is only as reliable as the data, model calibration, market freshness, settlement rules, and execution price. The safest path is to start read-only, prove the historical edge, then move to small manually reviewed stakes before any automation.

Current recommendation sizing is intentionally capped at the portfolio level so multiple good-looking signals cannot quietly overexpose the bankroll to one event, sport, or snapshot.

See:

- [Architecture](./docs/ARCHITECTURE.md)
- [Data Accuracy And Risk](./docs/DATA_ACCURACY_AND_RISK.md)
- [Data Providers](./docs/DATA_PROVIDERS.md)
- [Roadmap](./docs/ROADMAP.md)
- [Cloudflare Pages](./docs/CLOUDFLARE_PAGES.md)
- [Engine Contract](./docs/ENGINE_CONTRACT.md)

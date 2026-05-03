# Bet365 Edge Brain

Standalone recommendation engine for comparing Bet365 odds against broader market prices, estimating probability, scoring expected value, and sizing risk-aware stakes.

This app is intentionally separate from the trading command center for now. It should mature as the "brain" first: data contracts, model logic, audit trails, and testing before any automated execution or command-center integration.

## Current State

- Static Cloudflare Pages compatible app with no build step.
- Manual JSON market snapshot editor for early testing.
- Engine modules for odds conversion, no-vig probability, expected value, Kelly stake sizing, confidence, data quality, and risk labels.
- Sample markets across basketball, soccer, and tennis.
- Node test suite for the core math and recommendation engine.
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

See:

- [Architecture](./docs/ARCHITECTURE.md)
- [Data Accuracy And Risk](./docs/DATA_ACCURACY_AND_RISK.md)
- [Data Providers](./docs/DATA_PROVIDERS.md)
- [Roadmap](./docs/ROADMAP.md)
- [Cloudflare Pages](./docs/CLOUDFLARE_PAGES.md)
- [Engine Contract](./docs/ENGINE_CONTRACT.md)

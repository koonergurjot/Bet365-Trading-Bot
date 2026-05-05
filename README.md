# Bet365 Edge Brain

> **A signals engine for Bet365.** It does the hard work of screening every available market, finds the prices that look mispriced versus true probability, and shows you the bets worth placing. You place them yourself in Bet365. Bet365 already tracks your bets — this app does not.

---

## The One-Sentence Mission

**Constantly stream a short list of high-probability, high-return bets where Bet365's posted odds are out of line with what the data says should happen — so the user (Gurjot) can place those bets in Bet365 and make money consistently over time.**

That sentence is the entire reason this project exists. Every feature, every line of code, every doc should be measured against: *does this make the next signal more accurate, faster, or easier to act on?*

## What This App Is

- A **recommendation engine** that screens sports markets in real time.
- A **signal feed** ranked by edge (expected value), probability, and confidence.
- A **calculator + research surface** so the user can sanity-check why each signal fired.
- A **data layer** that pulls odds from licensed APIs *and* scrapes player/team stats from public stat sites (ESPN, FBref, Basketball-Reference, Pro-Football-Reference) so the probability model has more than just market consensus to lean on.

## What This App Is NOT

- **Not a bet tracker.** Bet365's own account history tracks placed bets, results, P&L, CLV, and balance. Duplicating that here is wasted work. (The legacy tracker code is hidden in the UI but kept in source for developer use.)
- **Not an auto-bettor.** No automated stake placement on Bet365. Signals are read by a human and placed manually in the Bet365 app/site.
- **Not a generic odds comparison tool.** The point is not "Bet365 vs Pinnacle vs DraftKings" — the point is "Bet365 vs *true* probability, derived from market consensus + scraped player/team data."

## How a Trading Day Works

1. Open the app (Cloudflare Pages URL, mobile-friendly).
2. Auto-poll is on; the engine refreshes signals every minute or two.
3. The **Signals** tab shows a ranked list: best edge first, with probability, fair price, Bet365 price, EV %, suggested stake fraction, and confidence.
4. The user reads the top signals, opens Bet365, and places the bets that still match the recommended price.
5. Bet365 tracks the bet from there.

## Sport Priority

Built first for the sports with the deepest public stat coverage and highest Bet365 market depth, in this order:

1. **Soccer** — EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL/UEL. xG, form, injuries, lineup news. Highest market liquidity globally.
2. **NFL + College Football** — EPA, advanced rate stats, weather, injuries. Heavy stat-driven, deep public data.
3. **NBA** — pace, ratings, rest, injuries, player props. Lots of in-play and prop opportunities.

Tennis, cricket, MLB, and others are deferred until the top three are profitable.

## Data Sources

| Layer | Source | Purpose |
|---|---|---|
| Odds (Bet365 + peer books) | Licensed odds APIs (The Odds API, OddsBlaze, Odds-API.io) | Legal, low-latency, signed snapshots |
| Player & team stats | Scraped from ESPN, FBref, Understat, Basketball-Reference, Pro-Football-Reference | Feeds the probability model beyond raw market consensus |
| Schedules & metadata | TheSportsDB / ESPN | Event matching, kickoff times |

Scraping is done server-side (Cloudflare Workers), respects rate limits, and caches aggressively. See [STAT_SOURCES.md](./docs/STAT_SOURCES.md).

## How "Edge" Is Decided

For every market the engine calculates:

- **Fair probability** — start with no-vig consensus across peer books, then adjust with sport-specific stat models (xG-derived for soccer, EPA for NFL, pace-adjusted for NBA, etc.).
- **Bet365 implied probability** — directly from Bet365's posted decimal odds.
- **Expected value (EV %)** — `fair_prob × (price − 1) − (1 − fair_prob)`.
- **Confidence** — function of data freshness, peer-book agreement, sample size of stat features, and model calibration history.
- **Risk label** — Low / Medium / High based on liquidity, volatility, and proximity to event start.

A signal fires when EV is above threshold AND confidence is above threshold AND no reliability gate trips (stale quotes, missing settlement rules, ambiguous matching, single outlier book — see [DATA_ACCURACY_AND_RISK.md](./docs/DATA_ACCURACY_AND_RISK.md)).

## Vibe-Coded With Multiple LLMs

This repo is intentionally structured for **AI-assisted development across Codex (OpenAI) and Claude (Anthropic)**:

- [`AGENTS.md`](./AGENTS.md) — rules every AI must follow before touching code.
- [`docs/MISSION.md`](./docs/MISSION.md) — the one-pager any new AI session should read first.
- [`docs/ENGINE_CONTRACT.md`](./docs/ENGINE_CONTRACT.md) — input/output schema, never break it silently.
- Inline comments and per-file headers explain *why* not just *what*.

The user's workflow: **edit locally → push to GitHub → Cloudflare Pages auto-deploys**. AI sessions should always commit clean, working code.

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

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `/`
- Root directory: `/`

The app has a top-level `index.html`, so Cloudflare Pages can serve it directly. Stat scraping and odds-API calls run inside Cloudflare Workers (kept out of the browser so API keys stay secret and scraping respects rate limits).

## Reality Check

A positive EV estimate is only as good as the data, the model, and the price still being available when you place the bet. Bet365 will limit profitable accounts. Stale odds can fake an edge that doesn't exist. Settlement rule mismatches can void a "winner." This app is built to flag those risks — not hide them.

The path to consistent profit is: small stakes → prove the historical edge → calibrate → scale slowly. Not: trust the green number and chase it.

## Doc Index

- [Mission](./docs/MISSION.md) — the one-pager
- [Architecture](./docs/ARCHITECTURE.md)
- [Roadmap](./docs/ROADMAP.md)
- [Engine Contract](./docs/ENGINE_CONTRACT.md)
- [Data Providers](./docs/DATA_PROVIDERS.md)
- [Stat Sources (scraping)](./docs/STAT_SOURCES.md)
- [Data Accuracy And Risk](./docs/DATA_ACCURACY_AND_RISK.md)
- [Cloudflare Pages](./docs/CLOUDFLARE_PAGES.md)

---

**GitHub:** https://github.com/koonergurjot/bet365-edge-brain

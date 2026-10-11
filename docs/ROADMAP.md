# Canadian Odds Research — ten upgrade rounds

## Decision

Build a private, pre-match research tool first, not an always-on live betting bot. Treat positive EV as an estimate, not a proven advantage. Keep zero real-money stake recommendations until a model has documented out-of-sample validation, fresh prices, verified settlement rules and verified provincial availability. Monthly profit is a goal, never an acceptance test that software can guarantee.

## What inspection actually established

- Both the existing Downloads copy and the clean GitHub baseline passed 16 tests (`npm test`). This establishes those tested behaviors, not prediction accuracy.
- The Downloads copy at `C:/Users/koone/Downloads/Folders/Bet365 Trade Bot/bet365-edge-brain` has uncommitted edits. It was not modified. Work proceeds in `C:/Users/koone/Documents/Bet365-Trading-Bot`.
- The baseline shipped private provider keys in browser `src/config.js`; remove these and rotate them at the provider. Removing a key from HEAD does not erase Git history or previous deployments.
- Baseline free-tier polling was every 72 hours, while README described minute-level screening. Those are incompatible products. Spend quota only on deliberate research windows; never describe old cached data as live.
- The official Odds API bookmaker catalogue lists a Canadian `ca` region, including `playnow_ca`, `betano_ca_on`, `betmgm_ca_on`, `betrivers_ca_on`, `pointsbetca`, `proline_ca_on`, and `sportsinteraction_ca_on`. BET99 is marked paid-only. This is catalogue coverage, NOT an authenticated successful odds request or evidence every event is covered.
- The same catalogue does not establish free Canadian Bet365 coverage. Its `bet365_au` listing is paid-only and limited to AFL/NRL h2h/spreads/totals. Do not relabel another book's price as Bet365.
- A public ESPN EPL scoreboard request returned HTTP 200 with six events. That proves this one request works, not an SLA, historical completeness, model features, or a redistribution licence.

## Data strategy and free-budget reality

Primary odds candidate: The Odds API Starter (advertised 500 credits/month). Start with one selected sport and h2h, `ca`. The official odds cost is markets × regions; choosing up to ten explicit bookmakers is billed as one region. A proposal of one sport × one market × one region × ten uncached requests/day × 30 days uses 300 credits. These are on-demand research windows, not continuous monitoring. Six sports × three markets × two regions × 12 polls/hour × eight hours/day × 30 days would use 103,680 credits: incompatible with free Starter.

Provider headers are the authority for remaining credits. Keep a reserve, cache identical requests briefly, prevent concurrent duplication and stop when budget is unknown/insufficient. A quota cache never makes an old quote actionable. Never purchase historical odds, upgrade a plan or attach payment details automatically. Capture history prospectively instead.

Canada is not one sportsbook jurisdiction. The Province of B.C. identifies PlayNow as its only legal online gambling site. Ontario-labelled data is not automatically available to a B.C. user. Separate **reference books** (probability research) from **eligible destination books** (verified user market). Default to PlayNow research for B.C.; do not assert eligibility from provider region alone.

Use publicly available data only when its terms permit the intended personal use. ESPN is an unofficial public endpoint, so put it behind an adapter with cache and failure status, not a guaranteed API label. Evaluate football-data.co.uk historical football CSVs and licensed free stats tiers separately before integrating; do not build reliability around blocked scraping or bypass anti-bot protections.

## The rounds (each has a release gate)

| Round | Implementation | Pass condition |
|---|---|---|
| 1. Truth and safety foundation | Remove browser secrets; local server proxy; explicit connection status; manual free-tier fetching; demo/research labels; zero actionable stake on stale/unvalidated evidence. | No secret served, failed API never masquerades as successful, sample produces no actionable recommendations, regression tests green. First implementation in this release; real authenticated feed remains blocked pending a rotated key. |
| 2. Canadian destination and connection verification | Select PlayNow/other verified destination separately from reference books; provider capability inventory by sport, province, market and account plan; exact raw response retained. | One real authenticated free request proves an offered Canadian quote, its timestamp and peers; each unsupported book shows unavailable. No claim of Bet365 connection without its actual quote. |
| 3. Immutable snapshot history | Local SQLite archive with raw response, provider timestamps, retrieval time, canonical event ID and content hash; append-only prediction ledger separate from user bet tracking. | Replay an archived snapshot into identical probabilities/EV; no post-event features in pre-event predictions; backup/restore tested. |
| 4. Market identity and rule hardening | Exact event/participant mapping; full outcome set; regulation vs overtime, draw, handicap line, period and pushes; outlier/stale-peer exclusion; correlated provider sources identified. | Soccer 1X2 cannot match draw-no-bet or match-winner overtime; different lines cannot silently match; unknown settlement blocks action. |
| 5. Explainable research UX | Shortlist first; top three research candidates; score/probability/value distinct; why/why-not drawer; quote age and minimum viable price; connections and advanced diagnostics secondary. | Phone and desktop user can identify source, expiry, model status and blockers without opening raw JSON. Formula reproduces values. Initial version in this release, improve after actual usage. |
| 6. One sport-specific model | Start with EPL pre-match 1X2: time-decayed team attack/defence, home advantage, Poisson/Dixon–Coles candidate; add xG only if licensed/source coverage validated. Version features and model. | Rolling chronological holdout; compare against no-vig consensus and simple baseline. No unexplained injury/form multipliers, no fabricated player data. Soccer first; NFL/CFB and NBA only after this pipeline works. |
| 7. Calibration and uncertainty | Walk-forward replay; calibration curves, Brier/log loss, probability intervals, missing-feature sensitivity, price slippage and multiple-testing controls. | Document sample sizes by league/odds band, bootstrap uncertainty and baseline comparison. Initial 500 resolved outcomes is a screening floor, not proof. Model promotion requires meaningful evidence, not one profitable week. |
| 8. Prospective paper validation | Freeze model; automatically settle PAPER recommendations from verified results; record opening and closing equivalent-market prices and attainable quotes. No wagering. | Complete prospective cohort, all rejected and accepted candidates retained, positive edge survives price slippage and conservative uncertainty; no cherry-picked winners. CLV supports diagnosis, never guarantees profit. |
| 9. Conservative manual decision support | Only after gates pass, apply lower-confidence-bound EV, conservative fractional Kelly, per-event/correlation limits, user-set loss and exposure ceilings; show "no bet" prominently. | Low-quality or uncertain estimate yields zero stake; loss limits never raise stakes to recover; replay correlated-event and worst-case loss tests. No account login, deposits or automated bets. |
| 10. Private operation and drift controls | Local-only default; if remote hosting needed, authenticated server proxy and secret storage; source-health alerts, quota scheduling, calibration drift monitor, reproducible releases and rollback. | Source outage automatically removes actionability; expired rows lose action status without manual reload; budget persists across restart; access and deployment verified end-to-end. |

## How the analysis must be shown

1. Offered decimal odds `d`: original bookmaker quote with provider, timestamp, event ID and settlement scope.
2. Book implied probability: `1 / d` (includes bookmaker margin).
3. Per-reference-book no-vig estimate for a complete mutually exclusive market: `(1 / d_i) / sum_j(1 / d_j)`. Show the other outcomes used. Reject incomplete markets; exchange commission requires separate treatment.
4. Peer consensus: weighted no-vig probabilities. Publish contributors and weights; exclude destination book. Similar feeds are not independent evidence.
5. Model probability `p`: disclose consensus-only vs independently feature-driven model; version, as-of inputs, validation cohort and uncertainty. Avoid calling it **true probability**.
6. Estimated expected return per dollar: `p * d - 1`. At proposed odds, break-even model probability is `1 / d`. Minimum viable odds for desired EV `e` is `(1 + e) / p`, using conservative probability when uncertainty is available.
7. Research priority score: this release uses 40 points for EV up to 10%, 30 for heuristic confidence and 30 for data quality. Each component is clamped 0–1 before weighting. This is an explicit design choice, NOT empirically validated odds of winning. Heuristic confidence is NOT calibrated accuracy. Scores cannot override blockers.
8. Actionability is separate: demo, stale/future/missing times, insufficient fresh peers, started/unknown event, unvalidated model, unverified rules or province mean zero actionable stake. Legacy Kelly fields are hypothetical calculation outputs only.

A high-probability favourite can be overpriced; a longshot can have estimated positive EV but high loss probability. Do not boost ranking merely for a large payout and do not introduce parlays as a shortcut to profit.

## Free software implementation

Keep current zero-build vanilla JS UI and Node backend for the first release. No paid dependency needed. Next: SQLite for local immutable history, Python scikit-learn/scipy/statsmodels for reproducible modelling, and Playwright for journey tests. Select packages only when their round needs them; pin versions, record licences and run a real smoke test. Don't install speculative tools.

## Sources

- Repo: https://github.com/koonergurjot/Bet365-Trading-Bot
- Free plan and historical-data exclusion: https://the-odds-api.com/
- Bookmaker catalogue and paid-only restrictions: https://the-odds-api.com/sports-odds-data/bookmaker-apis.html (retrieved directly with Python urllib).
- Cost formula and provider quota headers: https://the-odds-api.com/liveapi/guides/v4/ (retrieved directly with Python urllib).
- B.C. official guidance: https://www2.gov.bc.ca/gov/content/sports-culture/gambling-fundraising/gambling-in-bc
- BCLC: https://corporate.bclc.com/our-social-purpose/100-legal-bclc.html
- Working scoreboard probe: https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard (HTTP 200, six events; no claim of supported API contract).

## Explicit blockers

Rotated server-side provider credential, actual free-account bookmaker response, production backend/access verification and sufficient prospective model evidence. This release is a research foundation, not a proven profitable bot. Nothing in the ten rounds guarantees a profitable calendar month.

# Roadmap

The single goal: **a constantly-running signals feed that finds mispriced Bet365 markets accurately enough to be profitable when bet manually.**

Each phase below should be evaluated on one question: *does finishing this phase put real, profitable signals on Gurjot's screen?*

## Phase 0: Local Brain Scaffold ✅ DONE

- Static SPA, no build step.
- Manual JSON snapshot input for testing.
- Pure odds math (EV, Kelly, vig removal, conversions).
- Recommendation engine with confidence + risk + portfolio caps.
- Sample multi-sport data.
- Test suite for math + engine + history + portfolio guardrails.
- AI collaboration docs.

## Phase 1: Live Odds Pipeline ✅ MOSTLY DONE

- Adapters for The Odds API, OddsBlaze, TheSportsDB.
- Live data manager with poll/refresh.
- Quota + freshness diagnostics in topbar.

**Remaining:** move provider calls into Cloudflare Workers so API keys leave the browser.

## Phase 2: Stat Scraping Layer 🚧 NEXT (highest leverage)

The single highest-leverage upgrade. Without scraped stats, the model is just no-vig consensus, which is barely an edge over the books.

- Cloudflare Worker per stat source. Cache aggressively. Respect robots.txt + rate limits.
- **Soccer first:** FBref + Understat (xG, xGA, form, shot quality, lineup). ESPN for injuries / lineups.
- **NFL/CFB second:** Pro-Football-Reference (EPA, success rate, opponent-adjusted), ESPN for injuries + weather.
- **NBA third:** Basketball-Reference (pace, ORtg/DRtg, rest), ESPN for injuries.
- Output normalized into a per-event `statContext` block on the snapshot (see `docs/STAT_SOURCES.md`).

**Exit criteria:**

- Every market in priority sports carries a `statContext` block.
- Scrape latency under 30s end-to-end per sport.
- Cache hit rate above 80% so we don't hammer source sites.

## Phase 3: Sport-Specific Probability Models

Replace pure no-vig consensus with calibrated, stat-aware models.

- Soccer: Poisson on xG with home advantage + form weighting.
- NFL: EPA-derived team strength + opponent-adjusted, weather and injury overlays.
- NBA: pace × efficiency + rest/back-to-back adjustments + key-player availability.
- Each model versioned. Output goes through the same `model.probabilities` field already in the engine contract.

**Exit criteria:**

- Each sport's model beats no-vig consensus on out-of-sample backtest CLV.
- Calibration plot shipped per sport.

## Phase 4: Backtest + Calibration Harness

- Replay historical odds + stat snapshots through the live engine code.
- Per-sport, per-market, per-odds-band ROI and CLV.
- Calibration curves and Brier scores.
- Block model promotion until backtest ROI is positive after slippage.

## Phase 5: Always-On Signal Feed

- Auto-poll every 60–120 seconds during active hours per sport.
- Push notifications (browser / mobile) when a high-conviction signal appears.
- Signal expires when Bet365 price moves past threshold.
- Ranking surface optimized for "open phone → see top 3 → place bets" flow.

**Exit criteria:**

- Median time from signal-fire → user can place bet < 90 seconds.
- Stale signals disappear automatically.
- Signal feed runs unattended.

## Phase 6: Reliability Hardening

- Exposure limits per event / sport / time window.
- Correlation detection (don't recommend three correlated soccer overs).
- Reason codes on every accepted *and* rejected signal.
- Source-freshness gating: kill signals when scrape lag exceeds threshold.

## Phase 7: Audit + Continuous Learning

- Log every emitted signal with full snapshot + stat context.
- Optional manual outcome feedback (W/L/Void) so model calibration can update — *but* we do not duplicate Bet365's own bet ledger.
- Compare emitted price vs closing price (CLV) to validate edge over time.

## Out Of Scope (for now)

- Automated bet placement on Bet365.
- Bet-tracking UI / P&L charts (Bet365 owns this).
- Sports outside the priority three (Soccer / NFL+CFB / NBA).
- Trading-command-center integration. Brain stays standalone until profitable.

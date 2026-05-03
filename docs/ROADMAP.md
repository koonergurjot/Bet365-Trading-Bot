# Roadmap

## Phase 0: Local Brain Scaffold

- Static app shell.
- Manual snapshot input.
- Odds math and recommendation engine.
- Sample data and tests.
- AI collaboration docs.

Status: started.

## Phase 1: Data Provider Proof

- Choose primary and backup odds providers.
- Build a server-side adapter for each provider.
- Normalize Bet365 and peer-book markets into `ENGINE_CONTRACT.md`.
- Add raw snapshot storage.
- Add provider latency and freshness diagnostics.

Exit criteria:

- Same market can be reconciled across at least five peer books.
- Snapshot freshness is visible per book.
- No API secrets are present in browser code.

## Phase 2: Probability Model Baseline

- Implement no-vig consensus baseline by sport and market type.
- Add trusted-book weighting.
- Add closing-line value tracking.
- Build historical backtest harness.

Exit criteria:

- Backtests separate by sport, league, market, and odds band.
- Calibration error is reported.
- ROI is reported after simulated slippage.

## Phase 3: Risk Layer

- Add exposure limits by event, sport, market, and time window.
- Add correlation detection.
- Add bankroll presets and max-loss controls.
- Add reason codes for blocked recommendations.

Exit criteria:

- Engine can explain every accepted and rejected signal.
- Stake sizing survives stress tests.

## Phase 4: Command Center Integration

- Expose recommendations through JSON endpoint.
- Add command-center read-only panel.
- Add audit log for accepted/rejected signals.
- Add manual approval workflow.

Exit criteria:

- Command center does not duplicate betting math.
- Every recommendation can be traced to a raw source snapshot.

## Phase 5: Automation Candidate

- Paper-trade only at first.
- Compare recommended price to executable price.
- Track slippage, voids, stake acceptance, and account limits.
- Require manual approval for any real-money execution until the system proves live reliability.


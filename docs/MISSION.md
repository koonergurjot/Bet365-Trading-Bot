# Mission

Build a private, Canadian-relevant odds research and manual decision-support tool for Gurjot. Long-run profitability is an objective to test, not a result we can promise or infer from a green score.

## Operating rules

- Never place bets, deposit funds or operate a sportsbook account automatically.
- No paid data, subscriptions or paid API upgrades. Use explicitly verified free access, with hard quota limits.
- No private credentials in browser source, sample data, docs, logs or commits. Previous exposed provider credentials must be rotated.
- Never substitute another book's odds for Bet365. Show unsupported destinations clearly.
- Default B.C. research to PlayNow. Provider Canadian or Ontario region coverage does not establish provincial eligibility.
- Distinguish reference books, destination book, estimated probability, research priority, model validation and actionability.
- No "true probability" label without acknowledging uncertainty; consensus is an estimate, not an oracle.
- Fail closed: stale/demo/missing data, unverified model/rules/jurisdiction mean zero actionable stake.
- A prediction archive and paper validation are needed to test models; do not re-enable the legacy user bet-tracker UI.
- Soccer first, then NFL/CFB and NBA after a working calibration pipeline; add other sports only when supported by reliable free data and evidence.

## What is actually implemented

Vanilla JS research UI, odds math and ranking engine, source adapters, same-origin local server proxy, explicit reliability gate and source/score explanations. Legacy confidence and quality scores are heuristics, not statistically calibrated accuracy.

A live connection, calibrated model and production deployment require separate verification. Read `docs/ROADMAP.md` for the ten release rounds and known blockers. Passing unit tests validates tested behavior only, not a betting edge.

## North-star validation

Prospectively archive every research prediction and its as-of inputs. Evaluate chronological out-of-sample calibration, Brier/log loss against peer no-vig baselines, equivalent-market closing-line value, attainable prices and paper ROI with uncertainty after slippage. Do not cherry-pick successful outcomes. CLV alone does not establish guaranteed profit.

Until the evidence exists, the correct app output is **research only / no bet**.

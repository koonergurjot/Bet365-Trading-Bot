# Backtest findings (2026-11-15)

Reproduce: `node scripts/backtest.js [--ref pin|avg]`. Data: free football-data.co.uk CSVs for EPL, Championship, La Liga, Serie A, Bundesliga, Ligue 1, 2016/17 to 2026/27 (24,137 matches). Flat 1u stakes, 1X2 only, Bet365 pre-close odds vs Pinnacle pre-close no-vig (power method).

| Result | Value |
|---|---|
| Bet every Bet365 outcome | ROI -5.3% (CI -6.4 to -4.1). This is the margin you start against. |
| Value rule EV>=1% vs Pinnacle | 927 bets, ROI +5.8%, CI95 -5.5% to +16.0%, CLV +0.6% |
| Out-of-sample (threshold picked on 16/17-20/21) | 226 bets, ROI +9.5%, CI95 -11.1% to +33.5% |
| Losing calendar months | 48% |

Reading: Bet365's opening 1X2 prices track Pinnacle closely. Value bets are rare (~4% of matches), CLV is slightly positive, but ROI is not statistically separable from zero and half of months lose. The simple "Bet365 vs sharp book" 1X2 filter is not a proven profit engine. Avg-market reference gives the same picture with fewer bets.
Caveats: Bet365 limits or closes winning accounts; B.C. residents are served legally by PlayNow, whose odds are not in this dataset.

## Round 2: goals model and Over/Under (`node scripts/model-backtest.js`)
Time-decayed Poisson/Dixon-Coles model, refit weekly, walk-forward, 22,332 matches.
- 1X2 log-loss: model 0.9981, Pinnacle no-vig 0.9808, Pinnacle close 0.9783. Blending model into Pinnacle makes it worse.
- Betting model-only vs Bet365 1X2: ROI -9% to -10%, CLV -6%. Blend: ROI -5% to -6%. **Model is not used for picks.**
- O/U 2.5 vs Pinnacle: only 33-46 qualifying bets (CLV +8-11% but CI far too wide). Flagged as paper-only.

## Pipeline
- `node scripts/picks.js` refreshes free fixtures, scans Bet365 vs Pinnacle/market no-vig, logs picks to `data/ledger.json`, settles finished picks (result + closing-line value), writes `src/data/picks.json` for the "Today's picks" tab.
- Real-money gate stays closed until 100 settled paper picks with mean CLV >= +0.5%.

## Phase two (2026-11-15)
**Wider league test (`node scripts/backtest-leagues.js`, 20 leagues, 2016-2026, Bet365 vs Pinnacle, EV>=2%):** 3,208 bets, ROI +1.8% (CI -4.2% to +7.3%), mean CLV +1.6%. CLV is positive in 17 of 20 leagues and in both halves of the sample (early +1.9%, late +1.0%). Larger in lower leagues (SC3 +5.7%, T1/SC1 +2.5%, EC +2.1%, I2 +2.2%) but each has n~100-300, so single-league wins are not trustworthy. A second-source consensus filter lifts CLV slightly (+2.2%) and halves volume, but ROI is not better. Reading: a real but thin edge of roughly +1.5-2% of turnover. At 1% stakes on a $1,000 bankroll that is a few dollars a month in expectation, with swings of tens of dollars.

**Free live reference (Polymarket, no key):** `node scripts/targets.js` pulls live pre-match prices for NFL, NBA, NHL, college football/basketball, MLS and the top European soccer leagues (436 games, 317 board lines on first run) and converts them into "take Bet365 at >= X" target odds. `node scripts/validate-polymarket.js` scores settled games: 371 outcomes (~190 games), Brier 0.199, no obvious miscalibration, sample small. This validates the reference, not a Bet365 edge.

## Phase three: proof and simulation (`node scripts/prove.js`, `node scripts/sweep.js`)
Fixed rule (edge >= 2% vs Pinnacle, odds <= 6), 20 leagues: 1X2 n=3,208 ROI +1.8% (CI -3.9..+7.1) CLV +1.6%; O/U 2.5 n=226 ROI +11.2% (CI -4.4..+25.6) CLV +3.1%; combined n=3,434 ROI +2.4% (CI -2.6..+7.5) CLV +1.7%. Per-season combined ROI: +6.1, -3.4, -8.1, +4.8 (CLV positive every season but shrinking: 2.3, 1.8, 0.5, 0.8).

Monte Carlo, 20 bets/month, 1 unit = 1% bankroll: chance of being ahead after 1/3/6/12 months is 51/54/56/59% if history repeats, 50/52/54/56% if the true edge equals CLV, and 43/39/36/31% with no edge. A 25% drawdown within 12 months has ~50% chance. 15-variant grid (odds caps, edge, O/U): best chance of being ahead after 3 months is 58%. Capping odds does not rescue it.

Conclusion: at Bet365 margins a single-book value filter produces a thin edge, not reliable monthly profit. Open levers: more volume/markets, bigger edges (line shopping across more books, promos and profit boosts), and live paper bets measured with CLV (`scripts/settle-paper.js`).

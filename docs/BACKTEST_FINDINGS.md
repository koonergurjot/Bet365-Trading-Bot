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

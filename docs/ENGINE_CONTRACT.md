# Engine Contract

## Input Snapshot

The engine accepts a normalized snapshot object:

```json
{
  "snapshotAt": "2026-05-03T16:30:00.000Z",
  "provider": "manual-sample",
  "markets": []
}
```

Each market:

```json
{
  "id": "nba-den-min-2026-05-03-h2h",
  "sport": "basketball",
  "league": "NBA",
  "event": "Denver Nuggets vs Minnesota Timberwolves",
  "commenceTime": "2026-05-04T01:30:00.000Z",
  "snapshotAt": "2026-05-03T16:30:00.000Z",
  "marketType": "moneyline",
  "settlementRules": "Official game result including overtime.",
  "model": {
    "version": "baseline-consensus-v0",
    "confidence": 0.72,
    "probabilities": [
      { "name": "Denver Nuggets", "probability": 0.545 }
    ]
  },
  "books": []
}
```

Each book:

```json
{
  "name": "Bet365",
  "updatedAt": "2026-05-03T16:29:20.000Z",
  "outcomes": [
    { "name": "Denver Nuggets", "price": 1.95 }
  ]
}
```

## Output Recommendation

The engine returns recommendations shaped for UI and future command-center integration:

```json
{
  "id": "market-id:selection",
  "sport": "basketball",
  "league": "NBA",
  "event": "Denver Nuggets vs Minnesota Timberwolves",
  "marketType": "moneyline",
  "selection": "Denver Nuggets",
  "bet365Decimal": 1.95,
  "bet365ImpliedProbability": 0.5128,
  "fairDecimal": 1.84,
  "modelProbability": 0.545,
  "expectedValue": 0.0628,
  "stakeFraction": 0.02,
  "stakeAmount": 20,
  "unadjustedStakeFraction": 0.02,
  "unadjustedStakeAmount": 20,
  "portfolio": {
    "status": "active",
    "capReasons": [],
    "desiredStakeFraction": 0.02,
    "adjustedStakeFraction": 0.02
  },
  "confidence": 0.72,
  "dataQuality": 0.88,
  "risk": { "label": "Low", "penalty": 2 },
  "notes": []
}
```

`stakeFraction` and `stakeAmount` are the portfolio-adjusted recommendation. Use `unadjustedStakeFraction` / `unadjustedStakeAmount` to inspect the raw Kelly-sized stake before total, sport, and event exposure caps.

## Required Future Additions

- Canonical event IDs from the provider.
- Canonical participant IDs.
- Market period and line values for spreads/totals/props.
- Bookmaker-specific settlement rules.
- Provider raw snapshot ID.
- Liquidity or exchange volume when available.
- Whether market is live, pre-match, suspended, or settled.

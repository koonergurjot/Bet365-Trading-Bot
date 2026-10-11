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

Each book: `updatedAt` is the provider quote timestamp, or `null` when missing. Never substitute event start or local fetch time.

Consensus-baseline versions use the currently selected destination-excluded consensus for `modelProbability`, regardless of a precomputed baseline probability array. Independent-model probabilities remain unchanged. UI action amounts must revalidate freshness against the local clock at use time, not rely on a previously computed `actionable` flag. A 30-second local-only refresh updates the display without provider requests.

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

`stakeFraction` and `stakeAmount` are legacy, portfolio-adjusted **hypothetical** Kelly calculations. They are not authorization to wager. Use `actionableStakeAmount` (zero when blocked) for any decision-support display. Use `unadjustedStakeFraction` / `unadjustedStakeAmount` only to inspect the raw calculation.

## Research and actionability extension

`analyzeSnapshot(snapshot, { targetBook: "PlayNow" })` selects the destination book; omitted target defaults to Bet365 for backward compatibility. `bet365Decimal` and `bet365ImpliedProbability` are legacy field names for the selected destination; new code should display `targetBook` and `offeredDecimal`, not label all quotes Bet365.

Each research candidate now includes:
- `researchScore`: bounded integer 0–100, heuristic research priority, NOT win probability. Components: 40 × clamped(EV / 0.10), 30 × confidence, 30 × dataQuality.
- `actionable`, `blockReasons`, `actionableStakeAmount`.
- `evidence`: formula, model and consensus probabilities, implied probability, quote update time, per-peer decimal odds/no-vig probability/timestamp/freshness, model source, score components and validation reference.

The report includes `actionableRecommendations` and `actionableCount`. `recommendations` remains the research list so rejected actionability can be explained, not silently hidden.

The separate safety gate compares quote and snapshot timestamps with current time, requires at least three fresh peer books, a future pre-match event, positive EV and valid prices/probabilities. It blocks demo data and unverified settlement or jurisdiction. Input must explicitly provide `settlementRulesVerified: true` and `jurisdictionVerified: true`; these represent checks performed by an upstream verified process, not adapter guesses.

Model validation declaration requires `model.validation` with `status: "passed"`, `outOfSample: true`, `sampleSize >= 500`, finite `brierScore` in [0,1], and `reportId`. These are a screening floor and report pointer, not evidence a model is profitable. No current adapter produces verified validation declarations. Future releases must verify archived reports rather than trust imported JSON declarations. Never promote a model merely because its Brier score exists.

`settings.now` supports deterministic offline replay only; the browser uses actual current time. Historical/sample data stays research-only. Current confidence/dataQuality are heuristics, not calibrated accuracy or confidence intervals.

## Required Future Additions

- Canonical event IDs from the provider.
- Canonical participant IDs.
- Market period and line values for spreads/totals/props.
- Bookmaker-specific settlement rules.
- Provider raw snapshot ID.
- Liquidity or exchange volume when available.
- Whether market is live, pre-match, suspended, or settled.

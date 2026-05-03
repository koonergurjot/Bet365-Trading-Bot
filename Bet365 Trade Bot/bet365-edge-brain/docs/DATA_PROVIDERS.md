# Data Providers

Bet365 does not appear to offer a public developer odds API, so this project should not depend on direct Bet365 scraping. Use licensed odds providers and keep provider calls server-side.

## Candidate Providers

### Odds-API.io

Potential fit:

- Explicit Bet365 coverage.
- REST API plus WebSocket support.
- Prematch, live, player props, and broad market coverage.
- Value-bet endpoint may be useful as a benchmark, but the project should still run its own logic.

Risks to verify:

- Legal/data usage rights for storage and private tooling.
- Exact sports, markets, and geographic Bet365 availability.
- Historical odds depth and export limits.
- Latency under live betting load.

### The Odds API

Potential fit:

- Mature sports odds API with JSON output.
- Broad sports coverage and multiple bookmaker regions.
- Historical odds on paid plans.
- Useful as a peer-market source, especially for US/UK/EU/AU books.

Risks to verify:

- Whether Bet365 is included in the required region and market set.
- Live update frequency by sport and market.
- Player props and niche market depth.

### Backup Or Specialty Feeds

Evaluate a secondary provider for redundancy and dispute detection. If two providers disagree sharply, the engine should degrade confidence rather than pick whichever source creates the biggest edge.

## Provider Acceptance Checklist

- Bet365 is available for target sports and regions.
- At least four peer books are available for common markets.
- Per-book `updatedAt` timestamps are available.
- Historical odds are available for backtesting.
- Provider terms allow storing snapshots for private analytics.
- API supports server-side use without exposing keys.
- Latency is low enough for the intended betting type.
- Market and participant IDs are stable.
- Settlement rules or enough metadata exist to map rules internally.


# Data Accuracy And Risk

## Critical Risks

### 1. Fake Edge From Stale Odds

Odds move fast. Bet365 may refresh before peer books, or peer books may refresh before Bet365. Comparing mismatched timestamps can create an edge that no longer exists.

Solution:

- Store `updatedAt` per bookmaker.
- Reject or penalize quotes beyond a sport-specific freshness window.
- Use WebSocket feeds for live betting.
- Log the exact timestamp used for every recommendation.

### 2. Settlement Rule Mismatch

Books can settle the same market differently. Tennis retirements, soccer extra time, player props, void rules, dead heats, and each-way rules can change the true payoff.

Solution:

- Require `settlementRules` before a signal can be high confidence.
- Normalize market type and period.
- Keep bookmaker-specific rule overrides.

### 3. Bad Entity Matching

Team/player names can differ across feeds. A bad match can compare the wrong outcome.

Solution:

- Maintain canonical IDs for sport, league, event, participant, market, and outcome.
- Use fuzzy matching only as a candidate generator, never as final truth.
- Flag ambiguous matches for review.

### 4. Overfitted Probability Model

A model can look profitable historically while failing live.

Solution:

- Split training, validation, and out-of-sample test windows.
- Track calibration curves and closing-line value.
- Prefer simple baseline models until a complex model proves durable edge.

### 5. Bookmaker Limits And Account Effects

Profitable betting systems can hit stake limits, market suspensions, price changes, or account restrictions. The theoretical edge may not be executable.

Solution:

- Track requested stake vs accepted stake.
- Track price at recommendation vs price at placement.
- Reduce stake sizing when execution slippage is high.

### 6. Correlated Bets

Multiple positive-EV picks may share the same underlying risk.

Solution:

- Group by event, team, player, and market family.
- Cap exposure per event and per sport.
- Add correlation controls before any automation.

### 7. Leaking API Keys

Odds provider keys in client-side JavaScript can be stolen.

Solution:

- Keep keys in Cloudflare Worker secrets.
- The Pages app calls your own backend, never providers directly.
- Use `.env.example` for names only.

### 8. Legal And Terms Risk

Scraping sportsbooks can violate terms, trigger blocking, or produce unreliable data.

Solution:

- Use licensed odds APIs.
- Review provider rights for storage, redistribution, and commercial use.
- Avoid browser automation against sportsbook sites for production data collection.

## Reliability Gates

A recommendation should be blocked or degraded when:

- Fewer than four peer books are available.
- Any critical quote is stale.
- Settlement rules are missing.
- Event or outcome matching is ambiguous.
- Model confidence is below threshold.
- Expected value is positive only because of one outlier book.
- Stake exceeds configured bankroll exposure.

## Metrics To Track

- Expected value at recommendation time.
- Closing line value.
- Win/loss/void result.
- Realized ROI.
- Bet365 price movement after signal.
- Provider latency.
- Data freshness by bookmaker.
- Model calibration by sport and market.
- Accepted stake vs recommended stake.


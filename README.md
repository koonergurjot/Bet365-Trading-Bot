# Canadian Odds Research / Bet365 Edge Brain

A private, manually operated odds-research app for Gurjot. It compares an offered bookmaker price with peer no-vig consensus and a disclosed probability estimate. **It does not place bets, guarantee profit, or claim a calibrated win rate.**

## Current release

- Research shortlist with explainable 0–100 research priority, separate probability and estimated EV.
- Configurable destination bookmaker, including PlayNow research for B.C.
- Explicit no-bet blockers for stale/demo data, unvalidated models, unverified rules and unverified jurisdiction.
- Same-origin Node odds proxy; credentials stay server-side rather than in browser JavaScript.
- Canadian free-tier research requests and quota controls. No paid plan upgrades.
- Sample JSON is demonstration data only, never a real recommendation.

**Status:** research foundation. Authenticated live coverage must be verified using a rotated provider credential. Existing baseline/consensus models are not proven profitable. Provider catalogue coverage is not proof a quote is available to your account.

## Run locally

```bash
npm test
node --test tests/reliability.test.js tests/review-blockers.js tests/security-browser.js tests/security-proxy.js tests/security-static.js tests/ui-dashboard.js tests/integration-status.js tests/integration-manager.js tests/integration-errors.js
npm run serve
```

`npm test` runs the 16 legacy engine checks. The explicit `node --test` command above runs the portable reliability/security/UI/integration and review regression suite; CI supplies runner scratch as `TMPDIR`. Optional real-browser smoke tests (`node --test tests/ui-browser.js tests/integration-browser.js`) require locally installed Playwright and Chromium/Edge.

Freshness is rechecked locally every 30 seconds and immediately before action-amount display, CSV export or alerts. This timer never polls an odds API. Missing provider quote timestamps remain unknown, not event-start or capture-time substitutes.

Default local URL: http://127.0.0.1:8787. Read [connection setup](docs/CONNECTION_SETUP.md) before supplying a server-side key. Do not paste provider credentials into the JSON editor, browser source or chat.

The previous source contained exposed credentials. Rotate them at the providers before reuse; deletion from the latest commit does not remove old deployments or Git history. No automatic migration/reuse of exposed keys is performed.

## Free coverage reality

[The Odds API](https://the-odds-api.com/) advertises 500 monthly free credits. [Its bookmaker catalogue](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html) lists Canadian PlayNow and Ontario-labelled books; several listings are paid-only. It does not establish free Canadian Bet365 coverage. Unsupported books must display unavailable, not substituted odds.

The [Province of B.C.](https://www2.gov.bc.ca/gov/content/sports-culture/gambling-fundraising/gambling-in-bc) identifies PlayNow as the only legal online gambling site in B.C. An Ontario API quote is not proof of B.C. eligibility. Book eligibility, exact settlement rules and available odds require separate verification.

Free usage means focused manual pre-match checks, not minute-by-minute monitoring of every sport. Old cached prices are historical research, even if the last network request succeeded.

## How to read a candidate

- **Research score:** heuristic priority, not probability of winning.
- **Estimated probability:** disclose model vs consensus-only source; not "true probability".
- **EV:** `probability * decimalOdds - 1`, conditional on the probability estimate being correct and the quote being attainable.
- **Actionability:** separate safety decision. Zero actionable stake when evidence is missing; legacy Kelly output is hypothetical only.
- **Why / why not:** source quotes, age, contributors, formula and blockers.

High hit rate does not imply positive expected value. Positive estimated EV does not imply monthly profit. Closing-line value is useful validation evidence, not a promise future profit will follow.

## Upgrade sequence

The [ten-round roadmap](docs/ROADMAP.md) covers secure connections, Canadian coverage, immutable history, market identity, UX, sport-specific modelling, calibration, prospective paper validation, conservative manual support and private operation. Each round has a release gate. No automated betting or duplicated bet-tracker UI is in scope.

## Deployment

Static Cloudflare Pages alone cannot run this Node proxy. A deployed version needs an authenticated server-side equivalent with secret storage and budget controls; do not fall back to exposing keys in static assets. Production deployment/access has not been verified by this release.

## Developer references

- [AI collaboration rules](AGENTS.md)
- [Mission](docs/MISSION.md)
- [Engine contract](docs/ENGINE_CONTRACT.md)
- [Roadmap and verified source findings](docs/ROADMAP.md)
- [Connection setup](docs/CONNECTION_SETUP.md)

Repository: https://github.com/koonergurjot/Bet365-Trading-Bot

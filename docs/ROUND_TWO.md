# Round two — explicit source verification

## Delivered contract

Local `npm run serve` remains localhost-only. `GET /api/status` preserves `providers.oddsApi.configured` and adds top-level `deploymentMode: "local"`, `liveEnabled: true`, plus provider `verification`:

```json
{
  "state": "not_checked",
  "checkedAt": null,
  "sport": null,
  "region": "ca",
  "market": "h2h",
  "eventCount": 0,
  "books": [],
  "error": null
}
```

States: `unconfigured` (no server key), `not_checked` (key exists, no evidence), `verified` (valid provider response), `failed` (rejected/unsuccessful check), `stale` (successful check older than eight minutes or clock moved backwards). Configuration is never verification. Status performs no provider requests and recomputes freshness without buying odds. A restart clears in-memory verification; the existing quota ledger persists.

## Manual local check

Only an explicit same-origin `GET /api/odds/verify?sport=soccer_epl` with `X-Odds-Manual: 1` can perform verification. Supported sport keys are the existing soccer/NFL/CFB/NBA allowlist in `server/odds-proxy.js`. Missing/duplicate/unknown parameters, unsupported sports, non-GET methods and cross-origin requests are rejected. The endpoint returns `{ "verification": ... }` for valid-route checks and parameter/manual failures; HTTP method/origin guards return their ordinary error response.

Verification calls the existing standard odds route with **CA only, h2h only, decimal odds, ISO dates**. It never requests a sports catalogue, bookmaker catalogue, event detail, second region, additional market or paid endpoint. An uncached check reserves at most one credit; identical in-flight checks coalesce and share the ordinary odds-route five-minute cache. Existing monthly hard budget and persistent ledger fail closed. Rejected provider requests/timeouts still consume the reserved credit. No automatic retries. A timed-out upstream response cannot populate the cache later.

The returned observed `books` are aggregated from the actual selected-sport response:

```json
{"key":"playnow","title":"PlayNow","quoteCount":3,"freshQuoteCount":3,"lastUpdate":"2026-10-11T11:59:00.000Z"}
```

`quoteCount` counts valid h2h outcome prices across events, not events or eligibility. `freshQuoteCount` counts those quotes whose **market** provider timestamp is between zero and eight minutes old, inclusive. Missing, malformed, impossible or future timestamps are not fresh. A future timestamp at original receipt cannot become valid merely by aging a cached response. `lastUpdate` is the latest valid nonfuture h2h timestamp, or null. No event-start or capture-time substitution. Payload structure, sport, book identifiers, outcomes and decimal prices are validated; malformed payloads fail rather than masquerade as an empty feed. Errors are generic, never upstream error bodies/URLs or keys, and clear previous successful books/event counts. A successful empty array can verify connection transport but returns zero events and **no coverage**.

Book observation does not establish B.C./Ontario eligibility, settlement-rule equivalence, actionable freshness of an entire market, model calibration, or profitability. No Bet365/PlayNow coverage is invented from provider marketing or credential presence.

## Hosted status is not a public odds proxy

`functions/api/status.js` is a Cloudflare Pages status-only function, intended to replace the static deployment's misleading `/api/status` 404 on its next deployment. It reports the same verification fields, `deploymentMode: "hosted-static"`, `liveEnabled: false`, and `liveDisabledReason` explaining that the private authenticated hosted proxy is not enabled. It performs **zero upstream requests**, returns no secret, and cannot spend provider quota even when an environment key exists. It does not enable or add a hosted `/api/odds/verify` or other live endpoint. GitHub Pages remains static and cannot execute this function.

A live hosted feed remains blocked until there is authenticated private access, durable shared budget enforcement, secret storage, constrained routing and deployment verification. Do not expose the personal API quota to the public website. This file fixes the status contract in source; it is not proof the remote site has been deployed or checked.

## Actual-feed blocker and validation

No authorized rotated `ODDS_API_KEY` or authenticated hosted deployment credentials were supplied for this upgrade. Do not recover/reuse historical exposed keys. Actual bookmaker coverage remains **unverified** until the owner configures an authorized free-tier key securely in the server environment and explicitly performs a manual check. No live upstream calls, purchases or bets were made for these tests.

Run:

```sh
node --test tests/round2-backend*.js
npm test
node --test tests/*.js
```

New tests use synthetic provider responses explicitly as fixtures, including a real localhost HTTP server. RED failures were observed before the status, manual-verification, malformed-payload, expiry, method guard, hosted-status and late-timeout-cache implementations; GREEN validates the contract without claiming actual provider access. Full baseline/UI results must be reported from the final coordinated tree, not inferred from backend-only tests.

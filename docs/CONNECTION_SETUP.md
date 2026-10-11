# Manual free-tier odds connection

## Current connection state

The local server supports The Odds API, but an authorized **server-side** `ODDS_API_KEY` is required. No account was created, no historical exposed key was reused, and no successful live provider request was made during implementation. Tests use injected provider responses, not live odds. Without a key, `/api/odds/status` says `configured:false` and odds requests return 503. `configured:true` means a key exists, **not** that authentication or coverage has been verified.

Previously embedded private credentials were removed from browser config. Their owner must revoke/rotate them; removing source values does not remove historical Git copies or invalidate credentials.

## Run locally

Requires Node >=20. From the repository:

```bash
npm run serve
```

Default URL: `http://127.0.0.1:8787`. `PORT` overrides this, e.g. `PORT=8788 npm run serve` in bash. The server binds loopback only.

For an existing authorized free-plan key, copy `.env.example` to `.env` **locally**, enter the key there securely, then use Node's built-in environment-file support:

```bash
node --env-file=.env scripts/local-server.js
```

`npm run serve` reads inherited environment variables; it does **not** automatically load `.env`. Never commit `.env`, paste keys into the browser, or put keys in commands/docs. No new subscription or signup is required by this implementation. If no authorized free-plan key is available, remain disconnected and use demo/local data.

## API contract and safety

- `GET /api/status`: UI readiness contract `{providers:{oddsApi:{configured,manualOnly,budget,oddsBlaze}}}`; no upstream request or credential exposure. A configured flag does not verify authentication or coverage.
- `GET /api/odds/status`: compatibility endpoint with the same odds provider fields at the top level; no upstream call; never returns keys.
- `GET /api/odds/sports`: active provider list constrained to priority sports; cached one hour; provider documents this endpoint as zero credits.
- `GET /api/odds/sports/soccer_epl/odds?regions=ca&markets=h2h`: requires `X-Odds-Manual: 1`. Browser `fetchAllLiveOdds({manual:true})` must only be invoked by a user action. Missing manual authorization returns 403.
- Default **one sport**, EPL first; **Canada (`ca`)**, **h2h**, decimal odds. Manual `eu` or `ca,eu` peer requests are allowed; other regions, markets, bookmakers, credential/query injection, alternate URLs, and non-priority sports are rejected. No props, paid-only bookmaker selections, automatic polling or betting are implemented.
- Every odds cache miss reserves estimated credits (`regions × one market`) before sending a request. Five-minute odds cache and identical-request coalescing prevent repeated charges. Cached provider timestamps are preserved: cached odds are not claimed fresh.
- Default local monthly ceiling 450; `ODDS_MONTHLY_BUDGET` can lower it but cannot exceed 500. Failed/time-out requests remain conservatively charged. Numeric upstream `x-requests-used`, `x-requests-remaining`, and `x-requests-last` pass through; quota reports can only tighten the local budget. Cache-hit headers describe the cached request, not a new quota probe.
- Ledger persists at `~/.bet365-edge-odds-budget.json`, outside the repo. `ODDS_BUDGET_FILE` can select another writable path whose parent exists. Corrupt/unwritable ledgers fail closed. Do not delete/reset a ledger to evade limits. Local accounting rolls at UTC calendar-month boundaries; provider quota remains authoritative. Use **one local server process per ledger and key**: this implementation is not a distributed quota coordinator. Other apps using the same key can consume credits before this app sees new quota headers; use a dedicated free-plan key to avoid that race.
- Eight-second upstream timeout, no retries, redirects rejected, sanitized upstream errors. Browser timeout ten seconds. No upstream URL/key or error body is returned.
- Both fetch buttons pass `manual:true` through `fetchLiveSnapshot` to the odds adapter. Omitted intent is false; the manager refuses automatic polling and the UI labels its disabled controls **Manual only**.
- HTTP failures (including 422), network failures and invalid JSON/response shapes reject the fetch. Only a successful event array `[]` means genuine zero events; the UI says **no events returned**, not verified coverage. Failed requests do not increment successful fetch counts or replace/cache a snapshot. An existing cached snapshot may be shown with an explicit failure notice; it is not a new successful fetch.
- Static serving allowlists public app assets only, rejects dotfiles/.git/.env, encoded traversal and escaping symlinks. API rejects cross-site origin/fetch metadata and non-loopback Host values. No CORS access is enabled. This is a local-only server, not a hardened public hosting service.

## Bookmaker coverage limitations

[Official bookmaker list](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html) lists Canadian region keys including `playnow_ca` (PlayNow CA), `betano_ca_on`, `betmgm_ca_on`, `betrivers_ca_on`, `pointsbetca`, `proline_ca_on`, and `sportsinteraction_ca_on`. Ontario suffixes do not establish BC availability. Availability varies by sport, account entitlement, event, and provider response: Canadian mappings are not fabricated quotes.

`bet99_ca_on` is paid-only and is not requested. The documented Bet365 listing is `bet365_au`, paid-only for AFL/NRL; this does **not** establish Canada/EU Bet365 coverage. Free Canadian peer odds cannot support a Bet365 recommendation unless an independently sourced genuine Bet365 price exists. No bookmaker scraping or automated bets are added.

OddsBlaze remains disabled (`null` raw / empty supplementary results, no network request). An expired trial is not a verified free connection. Explicit future server-side setup needs its own entitlement, security, and free-budget review; there is deliberately no browser-key fallback or paid switch.

## Deployment and verification

Static Cloudflare Pages alone does not execute this Node proxy. This change does not configure/deploy a Worker or secrets. Hosted live connectivity remains blocked until an equivalent constrained same-origin server endpoint is explicitly deployed with a server secret.

```bash
npm test
node --test tests/reliability.test.js tests/security*.js tests/ui*.js tests/integration*.js
```

The Edge integration journey (`tests/integration-browser.js`) requires Playwright and installed Microsoft Edge. It intentionally fails rather than skips if these prerequisites are missing. It uses the real local server and proxy plus a **test-only local HTTP provider fixture** with a dummy key. It checks both manual buttons, readiness, PlayNow normalization, zero action amount, disabled auto controls, genuine empty arrays and upstream failures. Optional public team enrichment is mocked. Passing this journey is not authenticated live provider/Canadian coverage or production deployment verification.

Official references: [API v4 guide](https://the-odds-api.com/liveapi/guides/v4/) and [bookmaker list](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html). The free plan advertises 500 monthly credits; this code applies a lower default ceiling and never increases entitlement or enables paid calls automatically.

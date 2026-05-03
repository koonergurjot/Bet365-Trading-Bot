# AI Collaboration Rules

This repo is designed for Codex, Claude, and future AI assistants to edit safely.

## Prime Directive

Protect correctness over speed. This code may influence real-money betting decisions, so avoid silent assumptions, hidden data transformations, and untested logic changes.

## Edit Rules

- Keep recommendation logic in `src/engine/`.
- Keep UI-only behavior in `src/app.js` and `src/styles.css`.
- Keep normalized market examples in `src/data/`.
- Update `docs/ENGINE_CONTRACT.md` whenever the market snapshot schema changes.
- Add or update tests for any math, probability, scoring, or risk change.
- Never place API keys in browser JavaScript, sample data, docs, or commits.
- Do not add automated bet placement without a separate approval gate and paper-trading audit.

## Data Rules

- Treat every provider timestamp as part of the signal.
- Keep original provider odds, normalized odds, and transformed probabilities traceable.
- Store provider, book, market, outcome, timestamp, and settlement rule metadata.
- Flag stale, missing, or conflicting data instead of smoothing it away.
- Prefer licensed API providers over scraping.

## Review Checklist

- Does the logic distinguish Bet365 price from peer-market consensus?
- Does it remove vig or otherwise account for bookmaker margin?
- Does it prevent stale data from looking like an edge?
- Does it cap stake size?
- Does it expose uncertainty clearly?
- Can a future command-center integration consume the output without scraping the UI?


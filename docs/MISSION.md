# Mission

> **Read this in every new AI session before touching code.**

## What We're Building

A **Bet365 trading bot** that is fundamentally a **recommendation engine**.

It constantly screens sports markets, calculates the *true* probability of each outcome using market consensus + scraped player and team stats, compares that to **Bet365's posted odds**, and surfaces a short, ranked list of bets where Bet365 is mispriced.

The user (Gurjot) opens the app, sees the top signals, opens Bet365 separately, and places those bets manually.

## End Goal

**Make money consistently with the bets the engine screens.**

Not "be a perfect odds model." Not "track every bet ever placed." Not "automate Bet365." Just: *consistently profitable signals, surfaced fast enough to act on.*

Every change to this codebase should be evaluated against that goal.

## What This App Does NOT Do

- ❌ **Track bets.** Bet365 already does this in the user's account history. Duplicating it is wasted work.
- ❌ **Place bets automatically.** Bet365 limits accounts that look like bots. The user places every bet by hand.
- ❌ **Compare books for the sake of comparing.** The point is finding edges *Bet365* gives, not running a generic odds-comparison site.
- ❌ **Spread across every sport.** Focus is Soccer → NFL/CFB → NBA, in that order.

## How Signals Are Made

1. **Pull odds** from licensed odds APIs — Bet365 quotes plus a pool of peer books for consensus.
2. **Scrape stats** server-side from public stat sites:
   - Soccer → FBref, Understat, ESPN
   - NFL/CFB → Pro-Football-Reference, ESPN
   - NBA → Basketball-Reference, ESPN
3. **Estimate true probability** using sport-specific models (xG-Poisson for soccer, EPA-based for NFL, pace×efficiency for NBA), anchored to no-vig consensus as a sanity check.
4. **Compare** Bet365 price vs true probability → expected value (EV %).
5. **Filter** by confidence, data freshness, peer-book agreement, and reliability gates.
6. **Rank** by combined edge × confidence × risk score.
7. **Display** the top picks in plain language: *"Bet on X at Y price for $Z stake — edge is N%."*

## How The User Reads The App

- **Signals tab (default):** the only tab that matters day-to-day. Top picks, best edge first.
- **Calculator tab:** sanity-check a price manually if needed.
- **Data tab:** see raw snapshots and provider/scrape diagnostics for debugging.
- (Tracker tab is hidden — Bet365 owns bet tracking.)

## Why It's Vibe-Coded With Multiple LLMs

The user is comfortable with the technical stack (vanilla JS, Cloudflare Pages, GitHub) but wants AI to do the heavy implementation. Codex and Claude Cowork take turns editing this repo. That's why:

- This `MISSION.md` exists — so every new AI session loads context fast.
- `AGENTS.md` exists — so every AI follows the same edit rules.
- `ENGINE_CONTRACT.md` exists — so no AI silently breaks the snapshot/signal schema.
- `STAT_SOURCES.md` exists — so any AI can pick up the scraping work.
- Code is heavily commented with *why*, not just *what*.

## The Brutal Truths

- A positive EV % is only as good as the data it came from.
- Bet365 will limit profitable accounts. Stake conservatively.
- Stale odds can fake an edge that doesn't exist.
- Settlement-rule mismatches can void a "winner."
- The path to consistent profit is: small stakes → prove the edge → calibrate → scale slowly.

The app is built to flag those risks, not hide them. If the engine is uncertain, it lowers confidence rather than emitting a noisy signal.

## North-Star Metric

**Closing-line value (CLV) on emitted signals over rolling 30 days, by sport.**

If signals consistently beat the closing line, the model has real edge and profit will follow over a large enough sample. If they don't, no amount of UI polish saves us.

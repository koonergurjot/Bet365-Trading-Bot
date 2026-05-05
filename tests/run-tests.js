import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  americanToDecimal,
  decimalToAmerican,
  decimalToImpliedProbability,
  expectedValue,
  kellyFraction,
  removeVig
} from "../src/engine/oddsMath.js";
import { analyzeSnapshot } from "../src/engine/recommendationEngine.js";
import { buildWeightedConsensus } from "../src/engine/marketNormalizer.js";
import {
  buildAdaptiveLearningContext,
  createFeedbackStore,
  observeSnapshotFeedback,
  registerRecommendations,
  resolveAdaptiveLearningProfile,
  syncTrackedBets,
} from "../src/engine/feedbackStore.js";
import {
  annotateSnapshotWithHistory,
  createMarketHistoryStore,
  ingestSnapshotHistory,
} from "../src/engine/marketHistory.js";
import { applyBaselineModels } from "../src/data/liveDataManager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(join(__dirname, "../src/data/sample-markets.json"), "utf8"));

const tests = [
  ["converts odds formats", () => {
    assert.equal(decimalToImpliedProbability(2), 0.5);
    assert.equal(americanToDecimal(100), 2);
    assert.equal(americanToDecimal(-200), 1.5);
    assert.equal(decimalToAmerican(2.5), 150);
    assert.equal(decimalToAmerican(1.5), -200);
  }],
  ["removes market vig by normalizing implied probabilities", () => {
    const market = removeVig([
      { name: "A", price: 1.91 },
      { name: "B", price: 1.91 }
    ]);
    assert.equal(market.length, 2);
    assert.ok(Math.abs(market[0].noVigProbability - 0.5) < 0.0001);
    assert.ok(market[0].overround > 1);
  }],
  ["calculates expected value and Kelly staking", () => {
    assert.ok(expectedValue(0.55, 2) > 0);
    assert.ok(kellyFraction(0.55, 2) > 0);
    assert.equal(kellyFraction(0.45, 2), 0);
  }],
  ["scores a snapshot and returns ranked recommendations", () => {
    const report = analyzeSnapshot(sample, {
      bankroll: 1000,
      minExpectedValue: 0.01,
      minConfidence: 0.4,
      maxBankrollStake: 0.02
    });

    assert.ok(report.totalMarkets >= 3, `Expected at least 3 markets, got ${report.totalMarkets}`);
    assert.ok(report.totalCandidates > 0);
    assert.ok(report.recommendations.length > 0);
    assert.ok(report.recommendations[0].score >= report.recommendations.at(-1).score);
  }],
  ["weights sharper books more heavily in consensus", () => {
    const consensus = buildWeightedConsensus([
      {
        probability: 0.6,
        normalizedBook: "pinnacle",
        equivalenceWeight: 1,
        updatedAt: "2026-05-03T16:29:00.000Z",
      },
      {
        probability: 0.45,
        normalizedBook: "recreationalbook",
        equivalenceWeight: 1,
        updatedAt: "2026-05-03T16:29:00.000Z",
      },
    ], {
      snapshotAt: "2026-05-03T16:30:00.000Z",
    });

    assert.ok(consensus.noVigProbability > 0.525, `Expected sharp-book weighting to lift consensus, got ${consensus.noVigProbability}`);
  }],
  ["honors strict filters", () => {
    const report = analyzeSnapshot(sample, {
      minExpectedValue: 1,
      minConfidence: 0.99
    });

    assert.equal(report.recommendations.length, 0);
  }],
  ["applies portfolio exposure caps after ranking signals", () => {
    const report = analyzeSnapshot(sample, {
      bankroll: 1000,
      minExpectedValue: 0,
      minConfidence: 0,
      maxBankrollStake: 0.02,
      maxTotalExposure: 0.01,
      maxEventExposure: 0.01,
      maxSportExposure: 0.01,
      dynamicThresholds: false,
    });

    assert.ok(report.recommendations.length > 0);
    assert.ok(report.portfolioSummary, "Expected portfolio summary");
    assert.ok(report.portfolioSummary.plannedExposureFraction <= 0.010001);
    assert.ok(report.portfolioSummary.desiredExposureFraction >= report.portfolioSummary.plannedExposureFraction);
    assert.ok(report.recommendations.some((entry) => entry.unadjustedStakeAmount >= entry.stakeAmount));
  }],
  ["reports diagnostics for blocked selections", () => {
    const report = analyzeSnapshot(sample, {
      bankroll: 1000,
      minExpectedValue: 1,
      minConfidence: 0.99
    });

    assert.ok(report.diagnostics);
    assert.ok(report.diagnostics.rejectedSelections > 0);
    assert.ok(report.diagnostics.reasonCounts.ev_below_threshold > 0);
    assert.ok(Array.isArray(report.diagnostics.topReasons));
  }],
  ["flags markets that cannot price Bet365 against peers", () => {
    const report = analyzeSnapshot({
      snapshotAt: "2026-05-03T12:00:00.000Z",
      markets: [
        {
          id: "missing-bet365-market",
          sport: "basketball",
          league: "NBA",
          event: "Example @ Example",
          marketType: "moneyline",
          books: [
            {
              name: "DraftKings",
              updatedAt: "2026-05-03T11:59:00.000Z",
              outcomes: [
                { name: "Away", price: 2.1 },
                { name: "Home", price: 1.8 }
              ]
            }
          ]
        }
      ]
    }, {
      bankroll: 1000,
      minExpectedValue: 0.01,
      minConfidence: 0.4,
      maxBankrollStake: 0.02
    });

    assert.equal(report.recommendations.length, 0);
    assert.equal(report.diagnostics.marketsMissingBet365, 1);
    assert.equal(report.diagnostics.reasonCounts.missing_bet365, 1);
  }],
  ["builds baseline live models without descriptor ordering errors", () => {
    const snapshot = {
      snapshotAt: "2026-05-03T16:30:00.000Z",
      markets: [
        {
          id: "baseline-model-market",
          sport: "basketball",
          league: "NBA",
          event: "Home vs Away",
          homeTeam: "Home",
          awayTeam: "Away",
          commenceTime: "2026-05-04T18:00:00.000Z",
          snapshotAt: "2026-05-03T16:30:00.000Z",
          marketType: "moneyline",
          settlementRules: "Official result including overtime.",
          books: [
            {
              name: "Bet365",
              updatedAt: "2026-05-03T16:29:50.000Z",
              outcomes: [
                { name: "Home", price: 2.05 },
                { name: "Away", price: 1.8 },
              ],
            },
            {
              name: "Pinnacle",
              updatedAt: "2026-05-03T16:29:10.000Z",
              outcomes: [
                { name: "Home", price: 1.92 },
                { name: "Away", price: 1.95 },
              ],
            },
            {
              name: "DraftKings",
              updatedAt: "2026-05-03T16:28:50.000Z",
              outcomes: [
                { name: "Home", price: 1.9 },
                { name: "Away", price: 1.98 },
              ],
            },
          ],
        },
      ],
    };

    applyBaselineModels(snapshot, createMarketHistoryStore());

    assert.equal(snapshot.markets[0].model.version, "baseline-weighted-consensus-v2");
    assert.equal(snapshot.markets[0].model.probabilities.length, 2);
    assert.ok(snapshot.markets[0].model.confidence > 0.5);
  }],
  ["matches spread positions across team aliases and nearby lines", () => {
    const report = analyzeSnapshot({
      snapshotAt: "2026-05-03T16:30:00.000Z",
      markets: [
        {
          id: "spread-market",
          sport: "basketball",
          league: "NBA",
          event: "Los Angeles Lakers vs Golden State Warriors",
          homeTeam: "Los Angeles Lakers",
          awayTeam: "Golden State Warriors",
          commenceTime: "2026-05-03T22:00:00.000Z",
          snapshotAt: "2026-05-03T16:30:00.000Z",
          marketType: "spread",
          settlementRules: "Official result including overtime. Push returns stake.",
          books: [
            {
              name: "Bet365",
              updatedAt: "2026-05-03T16:29:50.000Z",
              outcomes: [
                { name: "Los Angeles Lakers", point: 4.5, price: 1.95 },
                { name: "Golden State Warriors", point: -4.5, price: 1.91 },
              ],
            },
            {
              name: "Pinnacle",
              updatedAt: "2026-05-03T16:29:00.000Z",
              outcomes: [
                { name: "LA Lakers", point: 4, price: 1.88 },
                { name: "GS Warriors", point: -4, price: 2.02 },
              ],
            },
            {
              name: "DraftKings",
              updatedAt: "2026-05-03T16:28:30.000Z",
              outcomes: [
                { name: "L.A. Lakers", point: 5, price: 1.8 },
                { name: "Golden St Warriors", point: -5, price: 2.08 },
              ],
            },
          ],
        },
      ],
    }, {
      bankroll: 1000,
      minExpectedValue: 0,
      minConfidence: 0,
      maxBankrollStake: 0.02,
      dynamicThresholds: false,
    });

    const lakersSignal = report.recommendations.find((entry) => entry.selection === "Los Angeles Lakers");
    assert.ok(lakersSignal, "Expected Lakers spread signal to be priced from alternate peer lines");
    assert.equal(lakersSignal.marketShape.usedLineNormalization, true);
    assert.ok(lakersSignal.peerBookCount >= 2);
  }],
  ["tracks persistent market lag with rolling history", () => {
    const baseMarket = {
      id: "history-moneyline",
      sport: "basketball",
      league: "NBA",
      event: "New York Knicks vs Boston Celtics",
      homeTeam: "New York Knicks",
      awayTeam: "Boston Celtics",
      commenceTime: "2026-05-03T23:00:00.000Z",
      marketType: "moneyline",
      settlementRules: "Official result including overtime.",
    };

    const snapshots = [
      {
        snapshotAt: "2026-05-03T16:00:00.000Z",
        markets: [{
          ...baseMarket,
          snapshotAt: "2026-05-03T16:00:00.000Z",
          books: [
            { name: "Bet365", updatedAt: "2026-05-03T15:59:30.000Z", outcomes: [{ name: "New York Knicks", price: 2.1 }, { name: "Boston Celtics", price: 1.77 }] },
            { name: "Pinnacle", updatedAt: "2026-05-03T15:59:20.000Z", outcomes: [{ name: "NY Knicks", price: 1.96 }, { name: "Boston Celtics", price: 1.92 }] },
            { name: "DraftKings", updatedAt: "2026-05-03T15:58:50.000Z", outcomes: [{ name: "New York Knicks", price: 1.98 }, { name: "Boston Celtics", price: 1.9 }] },
          ],
        }],
      },
      {
        snapshotAt: "2026-05-03T16:20:00.000Z",
        markets: [{
          ...baseMarket,
          snapshotAt: "2026-05-03T16:20:00.000Z",
          books: [
            { name: "Bet365", updatedAt: "2026-05-03T16:19:40.000Z", outcomes: [{ name: "New York Knicks", price: 2.12 }, { name: "Boston Celtics", price: 1.75 }] },
            { name: "Pinnacle", updatedAt: "2026-05-03T16:19:10.000Z", outcomes: [{ name: "NY Knicks", price: 1.92 }, { name: "Boston Celtics", price: 1.96 }] },
            { name: "DraftKings", updatedAt: "2026-05-03T16:18:45.000Z", outcomes: [{ name: "New York Knicks", price: 1.94 }, { name: "Boston Celtics", price: 1.94 }] },
          ],
        }],
      },
      {
        snapshotAt: "2026-05-03T16:40:00.000Z",
        markets: [{
          ...baseMarket,
          snapshotAt: "2026-05-03T16:40:00.000Z",
          books: [
            { name: "Bet365", updatedAt: "2026-05-03T16:39:35.000Z", outcomes: [{ name: "New York Knicks", price: 2.14 }, { name: "Boston Celtics", price: 1.74 }] },
            { name: "Pinnacle", updatedAt: "2026-05-03T16:39:05.000Z", outcomes: [{ name: "New York Knicks", price: 1.9 }, { name: "Boston Celtics", price: 1.98 }] },
            { name: "DraftKings", updatedAt: "2026-05-03T16:38:50.000Z", outcomes: [{ name: "Knicks", price: 1.93 }, { name: "Celtics", price: 1.95 }] },
          ],
        }],
      },
    ];

    let historyStore = createMarketHistoryStore();
    for (const snapshot of snapshots) {
      historyStore = ingestSnapshotHistory(snapshot, historyStore);
    }

    const latestSnapshot = JSON.parse(JSON.stringify(snapshots.at(-1)));
    annotateSnapshotWithHistory(latestSnapshot, historyStore);

    const knicksHistory = Object.values(latestSnapshot.markets[0].historyModel.positions)[0];
    assert.ok(knicksHistory, "Expected rolling history for the home selection");
    assert.ok(knicksHistory.sampleCount >= 3);
    assert.ok(knicksHistory.persistenceSamples >= 2);
    assert.equal(knicksHistory.isLagging, true);
    assert.ok(knicksHistory.selectionReliability.books >= 1);
    assert.ok(knicksHistory.leadLag.leadSignals >= 0);
  }],
  ["uses dynamic thresholds to prefer deep, fresh markets", () => {
    const buildBooks = (count, prices) => {
      const names = ["Pinnacle", "DraftKings", "FanDuel", "BetMGM", "Caesars", "Unibet"];
      return names.slice(0, count).map((name, index) => ({
        name,
        updatedAt: `2026-05-03T16:2${index}:00.000Z`,
        outcomes: [
          { name: "Home", price: prices[0] },
          { name: "Away", price: prices[1] },
        ],
      }));
    };

    const report = analyzeSnapshot({
      snapshotAt: "2026-05-03T16:30:00.000Z",
      markets: [
        {
          id: "deep-market",
          sport: "basketball",
          league: "NBA",
          event: "Home vs Away",
          homeTeam: "Home",
          awayTeam: "Away",
          commenceTime: "2026-05-04T18:00:00.000Z",
          snapshotAt: "2026-05-03T16:30:00.000Z",
          marketType: "moneyline",
          settlementRules: "Official result including overtime.",
          model: {
            version: "baseline-weighted-consensus-v2",
            confidence: 0.68,
            probabilities: [
              { name: "Home", probability: 0.525, canonicalKey: "home" },
              { name: "Away", probability: 0.475, canonicalKey: "away" },
            ],
          },
          books: [
            {
              name: "Bet365",
              updatedAt: "2026-05-03T16:29:50.000Z",
              outcomes: [
                { name: "Home", price: 1.95 },
                { name: "Away", price: 1.91 },
              ],
            },
            ...buildBooks(6, [1.88, 2.02]),
          ],
        },
        {
          id: "thin-market",
          sport: "basketball",
          league: "NBA",
          event: "Thin Home vs Thin Away",
          homeTeam: "Thin Home",
          awayTeam: "Thin Away",
          commenceTime: "2026-05-04T18:00:00.000Z",
          snapshotAt: "2026-05-03T16:30:00.000Z",
          marketType: "moneyline",
          settlementRules: "Official result including overtime.",
          model: {
            version: "baseline-weighted-consensus-v2",
            confidence: 0.68,
            probabilities: [
              { name: "Thin Home", probability: 0.525, canonicalKey: "home" },
              { name: "Thin Away", probability: 0.475, canonicalKey: "away" },
            ],
          },
          books: [
            {
              name: "Bet365",
              updatedAt: "2026-05-03T16:29:50.000Z",
              outcomes: [
                { name: "Thin Home", price: 1.95 },
                { name: "Thin Away", price: 1.91 },
              ],
            },
            ...buildBooks(1, [1.88, 2.02]).map((book) => ({
              ...book,
              outcomes: [
                { name: "Thin Home", price: 1.88 },
                { name: "Thin Away", price: 2.02 },
              ],
            })),
          ],
        },
      ],
    }, {
      bankroll: 1000,
      minExpectedValue: 0.03,
      minConfidence: 0.55,
      maxBankrollStake: 0.02,
      dynamicThresholds: true,
    });

    assert.ok(report.recommendations.some((entry) => entry.marketId === "deep-market"), "Expected deep market to pass dynamic thresholds");
    assert.ok(!report.recommendations.some((entry) => entry.marketId === "thin-market"), "Expected thin market to be filtered out");
  }],
  ["captures CLV and tracked outcomes in the feedback store", () => {
    const openingSnapshot = {
      snapshotAt: "2026-05-03T16:00:00.000Z",
      markets: [
        {
          id: "feedback-market",
          sport: "basketball",
          league: "NBA",
          event: "Phoenix Suns vs Dallas Mavericks",
          homeTeam: "Phoenix Suns",
          awayTeam: "Dallas Mavericks",
          commenceTime: "2026-05-03T18:00:00.000Z",
          marketType: "moneyline",
          settlementRules: "Official result including overtime.",
          model: {
            version: "baseline-weighted-consensus-v2",
            confidence: 0.7,
            probabilities: [
              { name: "Phoenix Suns", probability: 0.56, canonicalKey: "home" },
              { name: "Dallas Mavericks", probability: 0.44, canonicalKey: "away" },
            ],
          },
          books: [
            { name: "Bet365", updatedAt: "2026-05-03T15:59:30.000Z", outcomes: [{ name: "Phoenix Suns", price: 2.05 }, { name: "Dallas Mavericks", price: 1.82 }] },
            { name: "Pinnacle", updatedAt: "2026-05-03T15:59:00.000Z", outcomes: [{ name: "Phoenix Suns", price: 1.88 }, { name: "Dallas Mavericks", price: 2.0 }] },
            { name: "DraftKings", updatedAt: "2026-05-03T15:58:40.000Z", outcomes: [{ name: "Phoenix Suns", price: 1.9 }, { name: "Dallas Mavericks", price: 1.98 }] },
          ],
        },
      ],
    };

    const openingReport = analyzeSnapshot(openingSnapshot, {
      bankroll: 1000,
      minExpectedValue: 0,
      minConfidence: 0,
      maxBankrollStake: 0.02,
      dynamicThresholds: false,
    });

    let feedback = createFeedbackStore();
    feedback = registerRecommendations(openingReport, openingSnapshot, feedback);

    const closingSnapshot = JSON.parse(JSON.stringify(openingSnapshot));
    closingSnapshot.snapshotAt = "2026-05-03T18:05:00.000Z";
    closingSnapshot.markets[0].snapshotAt = "2026-05-03T18:05:00.000Z";
    closingSnapshot.markets[0].books[0].updatedAt = "2026-05-03T18:04:30.000Z";
    closingSnapshot.markets[0].books[1].updatedAt = "2026-05-03T18:04:10.000Z";
    closingSnapshot.markets[0].books[2].updatedAt = "2026-05-03T18:03:50.000Z";
    closingSnapshot.markets[0].books[0].outcomes[0].price = 1.96;
    closingSnapshot.markets[0].books[0].outcomes[1].price = 1.9;
    closingSnapshot.markets[0].books[1].outcomes[0].price = 1.8;
    closingSnapshot.markets[0].books[1].outcomes[1].price = 2.08;
    closingSnapshot.markets[0].books[2].outcomes[0].price = 1.82;
    closingSnapshot.markets[0].books[2].outcomes[1].price = 2.05;

    feedback = observeSnapshotFeedback(closingSnapshot, feedback);
    feedback = syncTrackedBets([
      {
        id: 101,
        signalId: openingReport.recommendations[0].id,
        odds: openingReport.recommendations[0].bet365Decimal,
        stake: 50,
        status: "won",
        addedAt: "2026-05-03T16:02:00.000Z",
      },
    ], feedback);

    const signal = feedback.signals[openingReport.recommendations[0].id];
    assert.ok(signal.closedAt, "Expected signal to be closed after event start");
    assert.ok(signal.clv > 0, `Expected positive CLV for winning close, got ${signal.clv}`);
    assert.equal(signal.result, "won");
    assert.ok(signal.realizedPnl > 0);
  }],
  ["builds adaptive profiles from feedback history", () => {
    const feedback = createFeedbackStore({
      signals: {
        a: {
          id: "a",
          sport: "basketball",
          marketType: "moneyline",
          modelSource: "baseline-weighted-consensus-v2",
          initialPeerBookCount: 5,
          isLagging: true,
          isLineNormalized: false,
          initialBet365ImpliedProbability: 0.48,
          clv: 0.04,
          closingExpectedValue: 0.09,
          result: "won",
          trackedStake: 50,
          realizedPnl: 52.5,
        },
        b: {
          id: "b",
          sport: "basketball",
          marketType: "moneyline",
          modelSource: "baseline-weighted-consensus-v2",
          initialPeerBookCount: 5,
          isLagging: true,
          isLineNormalized: false,
          initialBet365ImpliedProbability: 0.47,
          clv: 0.03,
          closingExpectedValue: 0.07,
          result: "won",
          trackedStake: 50,
          realizedPnl: 45,
        },
        c: {
          id: "c",
          sport: "basketball",
          marketType: "moneyline",
          modelSource: "baseline-weighted-consensus-v2",
          initialPeerBookCount: 5,
          isLagging: true,
          isLineNormalized: false,
          initialBet365ImpliedProbability: 0.49,
          clv: 0.025,
          closingExpectedValue: 0.05,
          result: "won",
          trackedStake: 50,
          realizedPnl: 40,
        },
        d: {
          id: "d",
          sport: "basketball",
          marketType: "moneyline",
          modelSource: "baseline-weighted-consensus-v2",
          initialPeerBookCount: 5,
          isLagging: true,
          isLineNormalized: false,
          initialBet365ImpliedProbability: 0.5,
          clv: 0.02,
          closingExpectedValue: 0.03,
          result: "won",
          trackedStake: 50,
          realizedPnl: 35,
        },
        e: {
          id: "e",
          sport: "basketball",
          marketType: "moneyline",
          modelSource: "baseline-weighted-consensus-v2",
          initialPeerBookCount: 5,
          isLagging: true,
          isLineNormalized: false,
          initialBet365ImpliedProbability: 0.51,
          clv: 0.018,
          closingExpectedValue: 0.025,
          result: "won",
          trackedStake: 50,
          realizedPnl: 30,
        },
        f: {
          id: "f",
          sport: "basketball",
          marketType: "moneyline",
          modelSource: "baseline-weighted-consensus-v2",
          initialPeerBookCount: 5,
          isLagging: true,
          isLineNormalized: false,
          initialBet365ImpliedProbability: 0.5,
          clv: 0.015,
          closingExpectedValue: 0.02,
          result: "won",
          trackedStake: 50,
          realizedPnl: 25,
        },
      },
    });

    const learning = buildAdaptiveLearningContext(feedback);
    const profile = resolveAdaptiveLearningProfile(learning, {
      sport: "basketball",
      marketType: "moneyline",
      peerCount: 5,
      isLagging: true,
      modelSource: "baseline-weighted-consensus-v2",
      isLineNormalized: false,
    });

    assert.ok(profile, "Expected adaptive learning profile to resolve");
    assert.ok(profile.reliability > 0.5);
    assert.ok(profile.thresholdDeltaEv < 0, `Expected good CLV profile to relax EV gate, got ${profile.thresholdDeltaEv}`);
    assert.ok(profile.confidenceBoost > 0);
  }],
  ["boosts signals with cross-market confirmation", () => {
    const report = analyzeSnapshot({
      snapshotAt: "2026-05-03T16:30:00.000Z",
      markets: [
        {
          id: "confirm-ml",
          sport: "basketball",
          league: "NBA",
          event: "Miami Heat vs Cleveland Cavaliers",
          homeTeam: "Miami Heat",
          awayTeam: "Cleveland Cavaliers",
          commenceTime: "2026-05-04T01:00:00.000Z",
          snapshotAt: "2026-05-03T16:30:00.000Z",
          marketType: "moneyline",
          settlementRules: "Official result including overtime.",
          model: {
            version: "baseline-weighted-consensus-v2",
            confidence: 0.7,
            probabilities: [
              { name: "Miami Heat", probability: 0.56, canonicalKey: "home" },
              { name: "Cleveland Cavaliers", probability: 0.44, canonicalKey: "away" },
            ],
          },
          books: [
            { name: "Bet365", updatedAt: "2026-05-03T16:29:30.000Z", outcomes: [{ name: "Miami Heat", price: 2.02 }, { name: "Cleveland Cavaliers", price: 1.84 }] },
            { name: "Pinnacle", updatedAt: "2026-05-03T16:29:00.000Z", outcomes: [{ name: "Miami Heat", price: 1.88 }, { name: "Cleveland Cavaliers", price: 2.0 }] },
            { name: "DraftKings", updatedAt: "2026-05-03T16:28:45.000Z", outcomes: [{ name: "Miami Heat", price: 1.9 }, { name: "Cleveland Cavaliers", price: 1.98 }] },
          ],
        },
        {
          id: "confirm-spread",
          sport: "basketball",
          league: "NBA",
          event: "Miami Heat vs Cleveland Cavaliers",
          homeTeam: "Miami Heat",
          awayTeam: "Cleveland Cavaliers",
          commenceTime: "2026-05-04T01:00:00.000Z",
          snapshotAt: "2026-05-03T16:30:00.000Z",
          marketType: "spread",
          settlementRules: "Official result including overtime. Push returns stake.",
          model: {
            version: "baseline-weighted-consensus-v2",
            confidence: 0.69,
            probabilities: [
              { name: "Miami Heat", probability: 0.545, canonicalKey: "home:3.5", line: 3.5 },
              { name: "Cleveland Cavaliers", probability: 0.455, canonicalKey: "away:-3.5", line: -3.5 },
            ],
          },
          books: [
            { name: "Bet365", updatedAt: "2026-05-03T16:29:20.000Z", outcomes: [{ name: "Miami Heat", point: 3.5, price: 1.95 }, { name: "Cleveland Cavaliers", point: -3.5, price: 1.91 }] },
            { name: "Pinnacle", updatedAt: "2026-05-03T16:28:55.000Z", outcomes: [{ name: "Miami Heat", point: 3.5, price: 1.84 }, { name: "Cleveland Cavaliers", point: -3.5, price: 2.03 }] },
            { name: "DraftKings", updatedAt: "2026-05-03T16:28:40.000Z", outcomes: [{ name: "Miami Heat", point: 3.5, price: 1.86 }, { name: "Cleveland Cavaliers", point: -3.5, price: 2.0 }] },
          ],
        },
      ],
    }, {
      bankroll: 1000,
      minExpectedValue: 0.01,
      minConfidence: 0.4,
      maxBankrollStake: 0.02,
    });

    const confirmed = report.recommendations.find((entry) => entry.marketId === "confirm-ml" && entry.selection === "Miami Heat");
    assert.ok(confirmed, "Expected confirmed moneyline signal");
    assert.ok((confirmed.crossMarket?.supportCount ?? 0) >= 1, "Expected cross-market support count");
    assert.ok(confirmed.notes.includes("multi-market confirmation"));
    assert.ok((report.diagnostics.confirmedSelections ?? 0) >= 1);
  }],
];

let failed = 0;

for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length} tests passed`);
}

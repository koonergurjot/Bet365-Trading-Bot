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
  annotateSnapshotWithHistory,
  createMarketHistoryStore,
  ingestSnapshotHistory,
} from "../src/engine/marketHistory.js";

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

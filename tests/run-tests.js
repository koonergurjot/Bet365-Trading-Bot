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
  }]
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

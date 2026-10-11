import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSnapshot } from '../src/engine/recommendationEngine.js';
import { attachResearchEvidence } from '../src/engine/reliabilityGate.js';
const sample = JSON.parse(readFileSync(new URL('../src/data/sample-markets.json', import.meta.url)));
const options = {minExpectedValue:0,minConfidence:0,dynamicThresholds:false};
test('historical sample is research only with zero actionable stake', () => {
  const report = analyzeSnapshot(sample, options);
  assert.ok(report.recommendations.length > 0);
  assert.equal(report.actionableCount, 0);
  for (const pick of report.recommendations) {
    assert.equal(pick.actionable, false);
    assert.equal(pick.actionableStakeAmount, 0);
    assert.ok(pick.blockReasons.includes('stale_snapshot'));
    assert.ok(pick.blockReasons.includes('model_not_validated'));
    assert.ok(pick.researchScore >= 0 && pick.researchScore <= 100);
    assert.equal(pick.evidence.formula, 'p * decimalOdds - 1');
  }
});
test('target bookmaker is configurable without requiring a Bet365 quote', () => {
  const snapshot = structuredClone(sample);
  snapshot.markets.forEach(market => market.books[0].name = 'PlayNow');
  const report = analyzeSnapshot(snapshot, {...options, targetBook:'PlayNow'});
  assert.ok(report.recommendations.length > 0);
  assert.equal(report.recommendations[0].targetBook, 'PlayNow');
  assert.equal(report.recommendations[0].offeredDecimal, report.recommendations[0].bet365Decimal);
});
test('an event that started one minute ago is blocked, even with fresh quotes', () => {
  const snapshot = structuredClone(sample);
  const now = '2026-05-03T16:30:00.000Z';
  snapshot.provider = 'test-fixture';
  snapshot.markets.forEach(market => market.commenceTime = '2026-05-03T16:29:00.000Z');
  const report = analyzeSnapshot(snapshot, {...options, now});
  assert.ok(report.recommendations.length);
  assert.ok(report.recommendations.every(pick => pick.blockReasons.includes('event_started_or_unknown')));
});
test('missing and future quote timestamps cannot authorize recommendations', () => {
  for (const stamp of [null, 'invalid', '2026-05-03T16:40:00.000Z']) {
    const snapshot = structuredClone(sample);
    snapshot.markets.forEach(market => market.books[0].updatedAt = stamp);
    const report = analyzeSnapshot(snapshot, {...options, now:'2026-05-03T16:30:00.000Z'});
    assert.equal(report.actionableCount, 0);
    assert.ok(report.recommendations.every(pick => pick.blockReasons.includes('stale_or_invalid_target_quote')));
  }
});
test('research score components sum to bounded heuristic priority', () => {
  const report = analyzeSnapshot(sample, options);
  for (const pick of report.recommendations) {
    assert.equal(pick.researchScore, Math.round(Object.values(pick.evidence.scoreComponents).reduce((a,b)=>a+b,0)));
    assert.equal(pick.evidence.modelProbability * pick.offeredDecimal - 1, pick.expectedValue);
    assert.ok(pick.evidence.peers.every(peer => peer.book && Number.isFinite(peer.noVigProbability)));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFixtures, evaluateGate, kellyStake, normaliseFixtures, parseCsv } from '../src/research/picks.js';
import { power } from '../src/research/devig.js';

test('power devig sums to 1 and removes margin', () => {
  const p = power([1.9, 3.6, 4.2]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(p[0] < 1 / 1.9);
});

test('scan flags a Bet365 price above Pinnacle fair price and ignores fair prices', () => {
  const base = { league: 'E0', date: '20/11/2026', time: '15:00', home: 'A', away: 'B', pin: [2.0, 3.5, 4.0], avg: null, ouB365: null, ouAvg: null };
  const fair = scanFixtures([{ ...base, b365: [1.95, 3.4, 3.9] }]);
  assert.equal(fair.length, 0);
  const value = scanFixtures([{ ...base, b365: [2.2, 3.4, 3.9] }]);
  assert.equal(value.length, 1);
  assert.equal(value[0].selection, 'Home win');
  assert.ok(value[0].ev >= 0.02 && value[0].minOdds < 2.2);
});

test('longshots above max odds are excluded', () => {
  const f = { league: 'E0', date: 'x', time: '', home: 'A', away: 'B', pin: [1.2, 6, 12], avg: null, b365: [1.2, 6, 15], ouB365: null, ouAvg: null };
  assert.equal(scanFixtures([f]).length, 0);
});

test('stake is capped at 1% of bankroll and zero without edge', () => {
  assert.equal(kellyStake(0.5, 2.0, 1000), 0);
  assert.ok(kellyStake(0.6, 2.5, 1000) <= 10);
});

test('real-money gate stays closed until enough settled picks with positive CLV', () => {
  const mk = (n, clv) => Array.from({ length: n }, () => ({ settled: true, pl: 0.1, clv }));
  assert.equal(evaluateGate(mk(99, 0.02)).open, false);
  assert.equal(evaluateGate(mk(100, -0.01)).open, false);
  assert.equal(evaluateGate(mk(100, 0.02)).open, true);
  assert.equal(evaluateGate([]).open, false);
});

test('fixtures CSV parsing handles both football-data layouts', () => {
  const a = normaliseFixtures(parseCsv('Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A\nE0,1/1/2027,15:00,X,Y,2,3.3,3.8'));
  assert.deepEqual(a[0].b365, [2, 3.3, 3.8]);
  const b = normaliseFixtures(parseCsv('Country,League,Date,Time,Home,Away,PSH,PSD,PSA,B365H,B365D,B365A\nBrazil,Serie A,1/1/2027,21:00,X,Y,2,3.3,3.8,2.1,3.3,3.8'));
  assert.deepEqual(b[0].pin, [2, 3.3, 3.8]);
});

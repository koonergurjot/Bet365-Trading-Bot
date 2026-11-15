import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGame } from '../src/research/polymarket.js';
import { buildBoard, verdict, parseOdds, gradeGame, decimalToAmerican } from '../src/research/targets.js';

const future = new Date(Date.now() + 36e5 * 5).toISOString();
const ev2 = (p1) => ({ id: '1', slug: 's', title: 'A vs. B', liquidity: '800000', volume: '1', markets: [{ sportsMarketType: 'moneyline', outcomes: '["A","B"]', outcomePrices: `["${p1}","${(1 - p1).toFixed(3)}"]`, clobTokenIds: '["t1","t2"]', gameStartTime: future, bestBid: 0.4, bestAsk: 0.41 }] });

test('2-way game is parsed and normalised', () => {
  const g = parseGame(ev2(0.6), 'nba');
  assert.equal(g.outcomes.length, 2);
  assert.ok(Math.abs(g.outcomes[0].prob + g.outcomes[1].prob - 1) < 1e-9);
});
test('in-play or decided games are rejected as pre-match references', () => {
  assert.equal(parseGame(ev2(0.999), 'nba'), null);
  const started = ev2(0.6); started.markets[0].gameStartTime = new Date(Date.now() - 36e5).toISOString();
  assert.equal(parseGame(started, 'nba'), null);
});
test('derivative/prop events with a suffix are ignored', () => {
  const e = ev2(0.6); e.title = 'A vs. B - Total Corners';
  assert.equal(parseGame(e, 'nba'), null);
});
test('3-way soccer parses win/draw/win', () => {
  const mk = (q, p) => ({ sportsMarketType: 'moneyline', question: q, outcomes: '["Yes","No"]', outcomePrices: `["${p}","${1 - p}"]`, clobTokenIds: '["a","b"]', gameStartTime: future, bestBid: p - 0.01, bestAsk: p + 0.01 });
  const g = parseGame({ id: '2', title: 'X vs. Y', liquidity: '50000', markets: [mk('Will X win on 2026-11-21?', 0.5), mk('Will X vs. Y end in a draw?', 0.25), mk('Will Y win on 2026-11-21?', 0.25)] }, 'epl');
  assert.deepEqual(g.outcomes.map((o) => o.name), ['X', 'Draw', 'Y']);
});
test('grades require liquidity and tight spread; thin markets demand bigger edge', () => {
  assert.equal(gradeGame({ liquidity: 900000, spread: 0.01 }).minEdge, 0.02);
  assert.equal(gradeGame({ liquidity: 30000, spread: 0.02 }).minEdge, 0.05);
  assert.equal(gradeGame({ liquidity: 5000, spread: 0.01 }), null);
});
test('board min odds = (1+edge)/p and verdict flips at that price', () => {
  const rows = buildBoard([parseGame(ev2(0.5), 'nba')]);
  const r = rows[0];
  assert.ok(Math.abs(r.minOdds - 1.02 / 0.5) < 0.005);
  assert.equal(verdict(r, r.minOdds - 0.05).status, 'pass');
  const ok = verdict(r, r.minOdds + 0.05, 1000);
  assert.equal(ok.status, 'bet'); assert.ok(ok.stake > 0 && ok.stake <= 10);
});
test('odds parsing handles American and decimal; conversion round-trips', () => {
  assert.ok(Math.abs(parseOdds('+150') - 2.5) < 1e-9);
  assert.ok(Math.abs(parseOdds('-200') - 1.5) < 1e-9);
  assert.equal(parseOdds('2.35'), 2.35);
  assert.equal(parseOdds('abc'), null);
  assert.equal(decimalToAmerican(2.5), 150);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenResult } from '../src/research/polymarket.js';
import { buildBoard } from '../src/research/targets.js';
import { parseGame } from '../src/research/polymarket.js';

const mk = (px) => ({ markets: [{ sportsMarketType: 'moneyline', clobTokenIds: '["tA","tB"]', outcomePrices: JSON.stringify(px) }] });

test('tokenResult reads resolved winners and losers', () => {
  assert.equal(tokenResult(mk(['1', '0']), 'tA'), 1);
  assert.equal(tokenResult(mk(['1', '0']), 'tB'), 0);
});
test('tokenResult returns null for unresolved or void markets', () => {
  assert.equal(tokenResult(mk(['0.6', '0.4']), 'tA'), null);
  assert.equal(tokenResult(mk(['0.5', '0.5']), 'tA'), null);
  assert.equal(tokenResult(mk(['1', '0']), 'nope'), null);
});
test('board rows carry the token needed for paper settlement', () => {
  const future = new Date(Date.now() + 36e5 * 5).toISOString();
  const g = parseGame({ id: '9', title: 'A vs. B', liquidity: '800000', markets: [{ sportsMarketType: 'moneyline', outcomes: '["A","B"]', outcomePrices: '["0.55","0.45"]', clobTokenIds: '["t1","t2"]', gameStartTime: future, bestBid: 0.5, bestAsk: 0.51 }] }, 'nba');
  assert.ok(buildBoard([g]).every((r) => r.token && r.gameId === '9'));
});

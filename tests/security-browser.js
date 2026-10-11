import test from 'node:test';
import assert from 'node:assert/strict';
import { API_CONFIG, POLL_CONFIG, PRIORITY_SPORTS } from '../src/config.js';
import { fetchSportOdds, fetchAllLiveOdds } from '../src/data/oddsApiAdapter.js';
import { fetchOddsBlazeRaw, fetchSupplementaryBooks } from '../src/data/oddsBlazeAdapter.js';
test('browser configuration has no private keys and defaults to one Canadian h2h sport',()=>{
  assert.ok(!API_CONFIG.theOddsApi.key);assert.ok(!API_CONFIG.oddsBlaze.key);
  assert.equal(API_CONFIG.theOddsApi.baseUrl,'/api/odds');assert.equal(API_CONFIG.theOddsApi.regions,'ca');
  assert.equal(API_CONFIG.theOddsApi.markets,'h2h');assert.equal(POLL_CONFIG.maxSports,1);assert.equal(PRIORITY_SPORTS[0],'soccer_epl');
});
test('browser fetch is manual same-origin and OddsBlaze never fetches',async()=>{
  const original=globalThis.fetch;let calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('[]');};
  try {
    await assert.rejects(fetchAllLiveOdds(),/manual/i);
    await fetchSportOdds('soccer_epl',{manual:true});
    assert.ok(calls[0].url.startsWith('/api/odds/'));assert.ok(!calls[0].url.includes('apiKey'));
    assert.equal(calls[0].options.headers['X-Odds-Manual'],'1');
    assert.equal(await fetchOddsBlazeRaw('bet365','nba'),null);assert.deepEqual(await fetchSupplementaryBooks(),[]);
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=original;}
});

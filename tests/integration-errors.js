import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSportOdds,fetchAllLiveOdds,quota} from '../src/data/oddsApiAdapter.js';
import {fetchLiveSnapshot,getFetchCount,getLastSnapshot} from '../src/data/liveDataManager.js';

test('HTTP and network failures cannot become successful empty snapshots',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;quota.remaining=null;});
  for(const status of [401,403,422,429,500,502,503,504]) {
    globalThis.fetch=async()=>new Response('{"error":"test-only failure"}',{status});
    await assert.rejects(fetchSportOdds('soccer_epl',{manual:true}),/Odds API|Odds provider/);
    await assert.rejects(fetchAllLiveOdds({sports:['soccer_epl'],manual:true}));
  }
  globalThis.fetch=async()=>{throw new Error('test-only offline');};
  await assert.rejects(fetchSportOdds('soccer_epl',{manual:true}),/offline/);
  const before=getFetchCount(),last=getLastSnapshot();
  await assert.rejects(fetchLiveSnapshot({sports:['soccer_epl'],manual:true,withOddsBlaze:false,withSportsDb:false}),/fetch failed/);
  assert.equal(getFetchCount(),before);assert.equal(getLastSnapshot(),last);
});

test('successful provider empty array is distinct from malformed JSON body',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>new Response('[]');
  assert.deepEqual(await fetchSportOdds('soccer_epl',{manual:true}),[]);
  for(const body of ['{}','null','broken-json']) {
    globalThis.fetch=async()=>new Response(body);
    await assert.rejects(fetchSportOdds('soccer_epl',{manual:true}));
  }
});

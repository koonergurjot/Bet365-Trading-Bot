import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchLiveSnapshot,getFetchCount,startPolling,stopPolling,isPolling} from '../src/data/liveDataManager.js';
import {quota} from '../src/data/oddsApiAdapter.js';

test('manual-only manager refuses to start an automatic polling timer',()=>{
  try {
    assert.throws(()=>startPolling(()=>{}),/Automatic odds refresh is disabled/);
    assert.equal(isPolling(),false);
  } finally {stopPolling();}
});

test('manager forbids implicit automatic fetching and threads explicit manual intent',async t=>{
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;quota.remaining=null;quota.used=null;});
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('[]');};
  const options={sports:['soccer_epl'],withOddsBlaze:false,withSportsDb:false};
  await assert.rejects(fetchLiveSnapshot(options),/Manual odds request required/);
  assert.equal(calls.length,0);
  const before=getFetchCount();
  const snapshot=await fetchLiveSnapshot({...options,manual:true});
  assert.equal(snapshot.totalEvents,0);
  assert.equal(getFetchCount(),before+1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.headers['X-Odds-Manual'],'1');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
// Keep test artifacts in the approved Hermes scratch directory.
import { join } from 'node:path';

test('manual constrained request caches and forwards numeric quota only', async () => {
  const { createOddsProxy } = await import('../server/odds-proxy.js');
  let calls = 0;
  const proxy = createOddsProxy({env:{ODDS_API_KEY:'test-private-key'}, ledgerPath:null, fetchImpl:async url => {
    calls++; assert.equal(new URL(url).searchParams.get('regions'),'ca');
    return new Response('[]',{headers:{'x-requests-remaining':'499','x-requests-used':'1'}});
  }});
  assert.equal((await proxy.request('/api/odds/sports/soccer_epl/odds')).status,403);
  for (const suffix of ['unknown/odds','soccer_epl/odds?markets=player_points','soccer_epl/odds?apiKey=evil']) {
    assert.equal((await proxy.request('/api/odds/sports/'+suffix,{manual:true})).status,400);
  }
  const result=await proxy.request('/api/odds/sports/soccer_epl/odds',{manual:true});
  assert.equal(result.status,200); assert.equal(result.headers['x-requests-remaining'],'499');
  assert.equal((await proxy.request('/api/odds/sports/soccer_epl/odds',{manual:true})).headers['x-odds-cache'],'HIT');
  assert.equal(calls,1);
});

test('budget survives restart and refuses over cap; errors and timeout are sanitized', async () => {
  const { createOddsProxy } = await import('../server/odds-proxy.js');
  const dir=mkdtempSync(join(process.env.TMPDIR,'odds-security-'));
  const ledgerPath=join(dir,'ledger.json');
  const env={ODDS_API_KEY:'test-private-key',ODDS_MONTHLY_BUDGET:'1'};
  try {
    const p=createOddsProxy({env,ledgerPath,fetchImpl:async()=>new Response('test-private-key',{status:401})});
    const failed=await p.request('/api/odds/sports/soccer_epl/odds',{manual:true});
    assert.equal(failed.status,502); assert.ok(!JSON.stringify(failed).includes(env.ODDS_API_KEY));
    const restarted=createOddsProxy({env,ledgerPath,fetchImpl:()=>{throw new Error('must not fetch');}});
    assert.equal((await restarted.request('/api/odds/sports/soccer_epl/odds',{manual:true})).status,429);
    const timed=createOddsProxy({env,ledgerPath:null,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});
    assert.equal((await timed.request('/api/odds/sports/soccer_epl/odds',{manual:true})).status,504);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('concurrent identical requests share one call and sports list costs zero',async()=>{
  const {createOddsProxy}=await import('../server/odds-proxy.js');
  let calls=0;
  const p=createOddsProxy({env:{ODDS_API_KEY:'test-private-key'},ledgerPath:null,fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return new Response('[]');}});
  const results=await Promise.all([p.request('/api/odds/sports/soccer_epl/odds',{manual:true}),p.request('/api/odds/sports/soccer_epl/odds',{manual:true})]);
  assert.equal(results[0].status,200);assert.equal(calls,1);
  assert.equal((await p.request('/api/odds/sports')).status,200);
});

test('unconfigured status contains no credential and odds fail closed', async () => {
  const { createOddsProxy } = await import('../server/odds-proxy.js');
  const proxy = createOddsProxy({ env: {}, ledgerPath: null });
  assert.equal((await proxy.request('/api/odds/status')).body.configured, false);
  assert.equal((await proxy.request('/api/odds/sports/soccer_epl/odds', {manual:true})).status, 503);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createOddsProxy} from '../server/odds-proxy.js';
test('verification expires without upstream calls and old quotes never become fresh on cached checks',async()=>{
  let clock=instant;
  const payload=fixture();
  const times=[-60000,-480000,-480001,null,60000,'bad','2026-02-30T12:00:00Z'];
  payload[0].bookmakers=times.map((stamp,i)=>({key:`book_${i}`,title:`Book ${i}`,last_update:iso(-1000),markets:[{key:'h2h',...(stamp===null?{}:{last_update:typeof stamp==='number'?iso(stamp):stamp}),outcomes:[{name:'A',price:2},{name:'B',price:2}]}]}));
  const h=harness(payload,{now:()=>clock});
  const checked=await h.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true});
  assert.equal(checked.status,200);
  assert.deepEqual(checked.body.verification.books.map(b=>b.freshQuoteCount),[2,2,0,0,0,0,0]);
  assert.deepEqual(checked.body.verification.books.map(b=>b.lastUpdate),[iso(-60000),iso(-480000),iso(-480001),null,null,null,null]);
  clock+=480001;
  const status=await h.proxy.request('/api/odds/status');
  assert.equal(status.body.verification.state,'stale');
  assert.equal(status.body.verification.checkedAt,iso(0));
  assert.ok(status.body.verification.books.every(b=>b.freshQuoteCount===0));
  assert.equal(h.calls,1);
});

test('empty successful feed verifies transport only; no configuration returns an explicit verification result',async()=>{
  const h=harness([]);
  const result=await h.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true});
  assert.equal(result.body.verification.state,'verified');assert.equal(result.body.verification.eventCount,0);assert.deepEqual(result.body.verification.books,[]);
  const unconfigured=harness(null,{env:{}});
  const absent=await unconfigured.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true});
  assert.equal(absent.status,503);assert.equal(absent.body.verification.state,'unconfigured');assert.deepEqual(absent.body.verification.books,[]);assert.ok(absent.body.verification.error);
  assert.equal(unconfigured.calls,0);
});

test('provider rejection, network errors, exhausted budget and timeout explicitly clear successful evidence',async()=>{
  for(const failure of [async()=>new Response('private-fixture',{status:401}),async()=>new Response('private-fixture',{status:429}),async()=>{throw Error('private-fixture');},()=>new Promise(()=>{})]) {
    let reject=false;
    const h=harness(null,{timeoutMs:10,env:{ODDS_API_KEY:'private-fixture',ODDS_MONTHLY_BUDGET:'2'},fetchImpl:async()=>reject?failure():new Response(JSON.stringify(fixture()))});
    assert.equal((await h.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true})).body.verification.state,'verified');
    reject=true;
    const result=await h.proxy.request('/api/odds/verify?sport=basketball_nba',{manual:true});
    assert.ok([502,429,504].includes(result.status));
    assert.equal(result.body.verification.state,'failed');assert.deepEqual(result.body.verification.books,[]);assert.equal(result.body.verification.eventCount,0);
    assert.ok(!JSON.stringify(result).includes('private-fixture'));
    assert.equal((await h.proxy.request('/api/odds/status')).body.verification.state,'failed');
    const exhausted=await h.proxy.request('/api/odds/verify?sport=americanfootball_nfl',{manual:true});
    assert.equal(exhausted.status,429);assert.equal(exhausted.body.verification.state,'failed');
  }
});

test('a timed-out upstream that ignores abort cannot install a later verification cache entry',async()=>{
  let complete;let calls=0;
  const h=harness(null,{timeoutMs:5,fetchImpl:()=>{calls++;return new Promise(r=>{complete=r;});}});
  const result=await h.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true});
  assert.equal(result.status,504);assert.equal(result.body.verification.state,'failed');
  complete(new Response(JSON.stringify(fixture())));
  await new Promise(r=>setTimeout(r,10));
  const retry=await h.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true});
  assert.equal(retry.status,429);assert.equal(retry.body.verification.state,'failed');assert.equal(calls,1);
});

const instant=Date.parse('2026-10-11T12:00:00Z');
const iso=offset=>new Date(instant+offset).toISOString();
const fixture=()=>[{id:'event-1',sport_key:'soccer_epl',home_team:'A',away_team:'B',commence_time:iso(3600000),bookmakers:[{key:'playnow',title:'PlayNow',last_update:iso(-60000),markets:[{key:'h2h',last_update:iso(-60000),outcomes:[{name:'A',price:2},{name:'B',price:3},{name:'Draw',price:3.5}]}]}]}];
function harness(payload=fixture(), extra={}) {
  let calls=0; const urls=[];
  const proxy=createOddsProxy({env:{ODDS_API_KEY:'private-fixture',ODDS_MONTHLY_BUDGET:'1'},ledgerPath:null,now:()=>instant,fetchImpl:async url=>{calls++;urls.push(new URL(url));return new Response(JSON.stringify(payload));},...extra});
  return {proxy,urls,get calls(){return calls;}};
}
test('manual verification shares constrained ca h2h cache and single-credit budget with ordinary odds',async()=>{
  const h=harness();
  const [a,b]=await Promise.all([h.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true}),h.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true})]);
  assert.equal(a.status,200);assert.deepEqual(a,b);
  assert.equal(h.calls,1);
  assert.equal(h.urls[0].pathname,'/v4/sports/soccer_epl/odds');
  assert.equal(h.urls[0].searchParams.get('regions'),'ca');assert.equal(h.urls[0].searchParams.get('markets'),'h2h');
  assert.deepEqual(a.body.verification,{state:'verified',checkedAt:iso(0),sport:'soccer_epl',region:'ca',market:'h2h',eventCount:1,books:[{key:'playnow',title:'PlayNow',quoteCount:3,freshQuoteCount:3,lastUpdate:iso(-60000)}],error:null});
  assert.deepEqual((await h.proxy.request('/api/odds/status')).body.verification,a.body.verification);
  assert.equal((await h.proxy.request('/api/odds/sports/soccer_epl/odds',{manual:true})).status,200);
  assert.equal(h.calls,1);
  assert.equal((await h.proxy.request('/api/odds/verify?sport=basketball_nba',{manual:true})).status,429);
  assert.equal(h.calls,1);
});

test('malformed provider payload fails closed and clears previous books without leaking upstream errors',async()=>{
  const mutations=[()=>({error:'private-fixture'}),()=>[null],()=>[{}],p=>{p[0].sport_key='soccer_epl';return p;},p=>{p[0].bookmakers=null;return p;},p=>{p[0].bookmakers[0].markets[0].outcomes[0].price='2';return p;},p=>{p[0].bookmakers[0].markets[0].outcomes[0].price=1;return p;},p=>{p[0].bookmakers[0].key='private-fixture';return p;}];
  for(const mutate of mutations) {
    let response=fixture();
    const h=harness(null,{env:{ODDS_API_KEY:'private-fixture',ODDS_MONTHLY_BUDGET:'50'},fetchImpl:async()=>new Response(JSON.stringify(response))});
    assert.equal((await h.proxy.request('/api/odds/verify?sport=soccer_epl',{manual:true})).body.verification.state,'verified');
    const next=fixture(); next[0].sport_key='basketball_nba'; response=mutate(next);
    const result=await h.proxy.request('/api/odds/verify?sport=basketball_nba',{manual:true});
    assert.equal(result.status,502);
    assert.equal(result.body.verification.state,'failed');
    assert.deepEqual(result.body.verification.books,[]);assert.equal(result.body.verification.eventCount,0);
    assert.ok(result.body.verification.error);assert.ok(!JSON.stringify(result).includes('private-fixture'));
    assert.equal((await h.proxy.request('/api/odds/status')).body.verification.state,'failed');
  }
});

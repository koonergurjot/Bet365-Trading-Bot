import test from 'node:test';
import assert from 'node:assert/strict';

// TEST-ONLY contract fixtures; not results from an actual provider request.
const { summarizeConnectionCoverage } = await import('../src/data/connectionCoverage.js').catch(() => ({}));
const now = Date.parse('2026-10-11T12:00:00Z');
const verification = { state:'verified', checkedAt:'2026-10-11T11:59:00Z', sport:'soccer_epl', region:'ca', market:'h2h', eventCount:1, books:[{key:'playnow_ca',title:'TEST-ONLY PlayNow',quoteCount:3,freshQuoteCount:3,lastUpdate:'2026-10-11T11:58:00Z'}],error:null };
const status = v => ({providers:{oddsApi:{configured:true,verification:v}},deploymentMode:'local',liveEnabled:true});

test('configured is not verified; observations expose age and no eligibility claim', () => {
  assert.equal(typeof summarizeConnectionCoverage, 'function', 'coverage summary must exist');
  const unverified=summarizeConnectionCoverage(status({state:'not_checked'}),{now});
  assert.equal(unverified.state,'not_checked');
  assert.equal(unverified.feedVerified,false);
  assert.deepEqual(unverified.books,[]);
  const observed=summarizeConnectionCoverage(status(verification),{now});
  assert.equal(observed.feedVerified,true);
  assert.equal(observed.books[0].ageMinutes,2);
  assert.equal(observed.books[0].freshQuoteCount,3);
  assert.equal(observed.books[0].eligibility,'Unverified · Canada / Ontario labels do not establish provincial eligibility');
});

test('zero events never invents coverage; invalid, stale, failed and wrong-sport evidence fail closed', () => {
  const summarize=v=>summarizeConnectionCoverage(status(v),{now});
  assert.deepEqual(summarize({...verification,eventCount:0,books:[]}).books,[]);
  assert.equal(summarize({...verification,eventCount:0,books:[]}).feedVerified,true);
  for (const change of [
    {state:'failed',error:'TEST-ONLY quota error'}, {state:'stale'}, {state:'unknown'},
    {checkedAt:'not a date'}, {checkedAt:'2026-10-11T12:01:00Z'},
    {checkedAt:'2026-10-11T11:00:00Z'}, {sport:'basketball_nba'}, {region:'us'},
    {market:'spreads'}, {eventCount:-1}, {eventCount:0},
    {books:[{...verification.books[0],quoteCount:-1}]},
  ]) assert.equal(summarize({...verification,...change}).feedVerified,false, JSON.stringify(change));
  const oldQuote=summarize({...verification,books:[{...verification.books[0],lastUpdate:'2026-10-11T11:00:00Z'}]});
  assert.equal(oldQuote.books[0].freshQuoteCount,0);
  assert.equal(oldQuote.books[0].freshness,'Stale');
  const invalidQuote=summarize({...verification,books:[{...verification.books[0],lastUpdate:'invalid'}]});
  assert.equal(invalidQuote.books[0].ageMinutes,null);
  assert.equal(invalidQuote.books[0].freshness,'Invalid / missing timestamp');
});

test('malformed stale books are rejected rather than rendered or allowed to crash',()=>{
  for (const books of [[null], [{}], [{...verification.books[0],freshQuoteCount:4}]]) {
    const summary=summarizeConnectionCoverage(status({...verification,state:'stale',books}),{now});
    assert.equal(summary.state,'invalid');
    assert.deepEqual(summary.books,[]);
  }
});

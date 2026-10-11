import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
test('Pages status honestly reports hosted-static with no live quota access even with a configured secret',async()=>{
  const moduleUrl=new URL('../functions/api/status.js',import.meta.url);
  assert.ok(existsSync(moduleUrl),'Pages status function must exist to resolve status 404');
  const {onRequest}=await import(moduleUrl);
  for(const configured of [false,true]) {
    const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('hosted status must never call upstream');};
    try {
      const response=await onRequest({request:new Request('https://fixture.pages.dev/api/status'),env:configured?{ODDS_API_KEY:'hosted-private-secret'}:{}});
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      const body=await response.json();assert.equal(body.liveEnabled,false);assert.equal(body.deploymentMode,'hosted-static');
      assert.match(body.liveDisabledReason,/private authenticated hosted proxy.*not enabled/i);
      assert.equal(body.providers.oddsApi.configured,configured);
      assert.deepEqual(body.providers.oddsApi.verification,{state:configured?'not_checked':'unconfigured',checkedAt:null,sport:null,region:'ca',market:'h2h',eventCount:0,books:[],error:null});
      assert.ok(!JSON.stringify(body).includes('hosted-private-secret'));
      assert.equal((await onRequest({request:new Request('https://fixture.pages.dev/api/status',{method:'POST'}),env:{}})).status,405);
    } finally {globalThis.fetch=old;}
  }
});

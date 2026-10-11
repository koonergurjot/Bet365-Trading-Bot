import test from 'node:test';
import assert from 'node:assert/strict';
import {createOddsProxy} from '../server/odds-proxy.js';
import {createLocalServer} from '../server/local-server.js';
import {fileURLToPath} from 'node:url';

test('local status separates configured from checked and enables only local live mode', async () => {
  for (const configured of [false,true]) {
    const proxy=createOddsProxy({env:configured?{ODDS_API_KEY:'private-fixture'}:{},ledgerPath:null,fetchImpl:()=>{throw Error('no calls');}});
    const server=createLocalServer({root:fileURLToPath(new URL('../',import.meta.url)),proxy});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try {
      const body=await (await fetch(`http://127.0.0.1:${server.address().port}/api/status`)).json();
      assert.equal(body.liveEnabled,true);
      assert.equal(body.deploymentMode,'local');
      assert.equal(body.providers.oddsApi.configured,configured);
      assert.deepEqual(body.providers.oddsApi.verification,{state:configured?'not_checked':'unconfigured',checkedAt:null,sport:null,region:'ca',market:'h2h',eventCount:0,books:[],error:null});
      assert.ok(!JSON.stringify(body).includes('private-fixture'));
    } finally {await new Promise(r=>server.close(r));}
  }
});

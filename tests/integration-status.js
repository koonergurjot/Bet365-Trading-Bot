import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createLocalServer} from '../server/local-server.js';
import {createOddsProxy} from '../server/odds-proxy.js';

test('real backend readiness matches UI providers schema without exposing credentials', async t => {
  for (const configured of [false,true]) {
    const proxy=createOddsProxy({env:configured?{ODDS_API_KEY:'test-only-private-key'}:{},ledgerPath:null,fetchImpl:()=>{throw Error('status must not call provider');}});
    const server=createLocalServer({root:fileURLToPath(new URL('../',import.meta.url)),proxy});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try {
      const base=`http://127.0.0.1:${server.address().port}`;
      const response=await fetch(base+'/api/status');
      assert.equal(response.status,200);
      const body=await response.json();
      assert.equal(body.providers.oddsApi.configured,configured);
      assert.ok(!JSON.stringify(body).includes('test-only-private-key'));
      assert.equal((await (await fetch(base+'/api/odds/status')).json()).configured,configured);
      assert.equal((await fetch(base+'/api/status',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    } finally {await new Promise(r=>server.close(r));}
  }
});

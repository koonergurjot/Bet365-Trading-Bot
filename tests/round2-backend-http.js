import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createLocalServer} from '../server/local-server.js';
import {createOddsProxy} from '../server/odds-proxy.js';
test('real HTTP verification requires GET manual same-origin requests and rejects unsupported parameters without upstream calls',async()=>{
  let calls=0;
  const proxy=createOddsProxy({env:{ODDS_API_KEY:'fixture-secret'},ledgerPath:null,fetchImpl:async()=>{calls++;return new Response('[]');}});
  const server=createLocalServer({root:fileURLToPath(new URL('../',import.meta.url)),proxy});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    const path='/api/odds/verify?sport=soccer_epl', headers={'X-Odds-Manual':'1'};
    assert.equal((await fetch(base+path,{method:'HEAD',headers})).status,405);
    assert.equal((await fetch(base+path,{method:'POST',headers})).status,405);
    assert.equal((await fetch(base+path,{headers:{...headers,Origin:'https://evil.invalid'}})).status,403);
    assert.equal((await fetch(base+path,{headers:{...headers,'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await fetch(base+path)).status,403);
    for(const suffix of ['','?sport=','?sport=invalid','?sport=soccer_epl&sport=soccer_epl','?sport=soccer_epl&regions=eu','?sport=soccer_epl&markets=spreads','?sport=soccer_epl&apiKey=ignored','?sport=Soccer_epl','?sport=soccer%5Fepl%00']) {
      assert.equal((await fetch(base+'/api/odds/verify'+suffix,{headers})).status,400,suffix);
    }
    assert.equal(calls,0);
    const response=await fetch(base+path,{headers});assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.json()).verification.state,'verified');assert.equal(calls,1);
    const rejected=await fetch(base+path);const body=await rejected.json();
    assert.equal(body.verification.state,'failed');assert.deepEqual(body.verification.books,[]);
    assert.equal((await (await fetch(base+'/api/status')).json()).providers.oddsApi.verification.state,'failed');
  } finally {await new Promise(r=>server.close(r));}
});

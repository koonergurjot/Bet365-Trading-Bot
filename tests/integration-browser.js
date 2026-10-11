// TEST-ONLY local HTTP fixture. No authenticated provider or live coverage claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createLocalServer} from '../server/local-server.js';
import {createOddsProxy} from '../server/odds-proxy.js';
const require=createRequire(import.meta.url);
let chromium;
try {({chromium}=require('playwright'));} catch {({chromium}=require('C:/Users/koone/Documents/Gurjots-Games-work/node_modules/playwright'));}

test('Edge buttons reach real backend: manual fixture quotes, genuine empty, explicit upstream failure', {timeout:60000}, async t=>{
  let mode='quotes';const upstreamCalls=[];
  const fixture=createServer((req,res)=>{
    upstreamCalls.push(req.url);
    const sports=new URL(req.url,'http://fixture').pathname.endsWith('/sports');
    res.setHeader('Content-Type','application/json');
    if(sports) return res.end(JSON.stringify([{key:'soccer_epl',active:true,has_outrights:false}]));
    if(mode==='failure') {res.statusCode=503;return res.end(JSON.stringify({error:'TEST-ONLY outage'}));}
    const now=new Date().toISOString();
    res.end(JSON.stringify(mode==='empty'?[]:[{id:'test-only-event',sport_key:'soccer_epl',sport_title:'TEST-ONLY EPL',home_team:'Test Home',away_team:'Test Away',commence_time:new Date(Date.now()+3600000).toISOString(),bookmakers:['playnow_ca','betano_ca_on','betmgm_ca_on'].map(key=>({key,last_update:now,markets:[{key:'h2h',outcomes:[{name:'Test Home',price:key==='playnow_ca'?3:2.1},{name:'Test Away',price:3.5},{name:'Draw',price:3.2}]}]}))}]));
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>fixture.close(r)));
  const backendRequests=[];
  const proxy=createOddsProxy({env:{ODDS_API_KEY:'TEST-ONLY-fixture-key'},ledgerPath:null,fetchImpl:async(url,options)=>fetch(`http://127.0.0.1:${fixture.address().port}${url.pathname}`,options)});
  const server=createLocalServer({root:fileURLToPath(new URL('../',import.meta.url)),proxy:{request:(path,options)=>{backendRequests.push({path,options});return proxy.request(path,options);}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const errors=[];const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  // Only optional public team enrichment is mocked; same-origin app/API traffic is real HTTP.
  const isolate=pg=>pg.route('https://www.thesportsdb.com/**',route=>route.fulfill({contentType:'application/json',body:'{"teams":[]}'}));
  await isolate(page);
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('configured'));
  assert.equal(upstreamCalls.length,0,'startup readiness must not request provider data');
  await page.locator('#btnFetchLive').click();
  await page.waitForFunction(()=>document.querySelector('#btnFetchLive').disabled===false);
  assert.ok(backendRequests.some(r=>r.path.includes('/soccer_epl/odds')&&r.options.manual===true),'button must send explicit manual intent through manager to backend');
  assert.ok(upstreamCalls.some(u=>u.endsWith('/soccer_epl/odds')));
  assert.match(await page.locator('#snapshotEditor').inputValue(),/PlayNow/);
  assert.equal(await page.locator('#mTotalStake').textContent(),'$0');
  assert.equal(await page.locator('#btnTogglePoll').isDisabled(),true);
  assert.equal(await page.locator('#btnTogglePoll2').isDisabled(),true);
  await browser.close();
  // Fresh proxy/page per response mode prevents cache disguising error or empty data.
  for(const next of ['empty','failure','disconnected']) {
    mode=next;
    const callsBefore=upstreamCalls.length;
    const p=createOddsProxy({env:next==='disconnected'?{}:{ODDS_API_KEY:'TEST-ONLY-fixture-key'},ledgerPath:null,fetchImpl:async(url,options)=>fetch(`http://127.0.0.1:${fixture.address().port}${url.pathname}`,options)});
    proxy.request=p.request;
    const b=await chromium.launch({headless:true,channel:'msedge'});
    try {
      const pg=await b.newPage();await isolate(pg);pg.on('pageerror',e=>errors.push(e.message));await pg.goto(base);
      await pg.locator('[data-tab="data"]').click();
      if(next==='disconnected') {
        // Unconfigured backend: the control must be disabled (not clickable) and nothing may be fetched or fabricated.
        await pg.waitForFunction(()=>/Disconnected/.test(document.querySelector('#connectionStatus').textContent));
        assert.equal(await pg.locator('#btnFetchLive2').isDisabled(),true,'Fetch Live must be disabled when disconnected');
        await pg.locator('#btnFetchLive2').evaluate(el=>el.click());
        await pg.waitForTimeout(300);
        assert.equal(await pg.locator('#snapshotEditor').inputValue(),'');
        assert.ok(!(await pg.locator('body').innerText()).includes('Research data loaded:'));
        assert.equal(upstreamCalls.length,callsBefore,'disabled/unconfigured control must not call a provider');
        continue;
      }
      await pg.locator('#btnFetchLive2').click();
      await pg.waitForFunction(()=>document.querySelector('#btnFetchLive2').disabled===false);
      const text=await pg.locator('body').innerText();
      if(next==='empty') assert.match(text,/no events returned/i);
      else {assert.match(text,/Live fetch failed/i);assert.ok(!text.includes('Research data loaded:'));assert.ok(!text.includes('no events returned'));assert.equal(await pg.locator('#snapshotEditor').inputValue(),'');}
    } finally {await b.close();}
  }
  assert.deepEqual(errors,[]);
});

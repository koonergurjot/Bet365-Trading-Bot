// TEST-ONLY integration fixtures exercise actual local routes, not provider access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createLocalServer} from '../server/local-server.js';
import {createOddsProxy} from '../server/odds-proxy.js';
const require=createRequire(import.meta.url);
let chromium;
try {({chromium}=require('playwright'));} catch {({chromium}=require('C:/Users/koone/Documents/Gurjots-Games-work/node_modules/playwright'));}

test('Edge TEST-ONLY integration: manual verification traverses local routes, status readback and manager cached fetch', {timeout:60000},async t=>{
  const calls=[];
  const stamp=new Date().toISOString();
  const fixture=[{id:'test-only-event',sport_key:'soccer_epl',sport_title:'TEST-ONLY EPL',home_team:'TEST-ONLY Home',away_team:'TEST-ONLY Away',commence_time:new Date(Date.now()+3600000).toISOString(),bookmakers:[{key:'playnow_ca',title:'TEST-ONLY PlayNow',last_update:stamp,markets:[{key:'h2h',last_update:stamp,outcomes:[{name:'TEST-ONLY Home',price:2.5},{name:'TEST-ONLY Away',price:2.5},{name:'Draw',price:3.5}]}]}]}];
  const proxy=createOddsProxy({env:{ODDS_API_KEY:'TEST-ONLY-NOT-A-REAL-CREDENTIAL'},ledgerPath:null,fetchImpl:async url=>{
    calls.push(url.pathname);
    return new Response(JSON.stringify(url.pathname.endsWith('/sports')?[{key:'soccer_epl',active:true,has_outrights:false}]:fixture),{headers:{'content-type':'application/json','x-requests-remaining':'499','x-requests-used':'1','x-requests-last':'1'}});
  }});
  const server=createLocalServer({root:fileURLToPath(new URL('../',import.meta.url)),proxy});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://www.thesportsdb.com/**',route=>route.fulfill({contentType:'application/json',body:'{"teams":[]}'}));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('configured'));
  assert.equal(calls.length,0);
  await page.locator('#btnVerifyFeed').click();
  await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('Feed verified'));
  assert.deepEqual(calls,['/v4/sports/soccer_epl/odds']);
  const status=await (await fetch(base+'/api/status')).json();
  assert.equal(status.providers.oddsApi.verification.state,'verified');
  assert.equal(status.providers.oddsApi.verification.books[0].freshQuoteCount,3);
  await page.locator('#btnCheckConnections').click();
  await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('Feed verified'));
  await page.locator('[data-tab="data"]').click();
  assert.match(await page.locator('#coverageInventory').innerText(),/TEST-ONLY PlayNow/);
  assert.match(await page.locator('#checkFeed').innerText(),/verified.*1 events/i);
  await page.locator('#btnFetchLive2').click();
  await page.waitForFunction(()=>document.querySelector('#btnFetchLive2').textContent==='Fetch Live');
  assert.match(await page.locator('#snapshotEditor').inputValue(),/PlayNow/);
  assert.equal(calls.filter(c=>c.endsWith('/odds')).length,1,'normal manager request uses shared verification cache');
  assert.equal(await page.locator('#mTotalStake').textContent(),'$0');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
});

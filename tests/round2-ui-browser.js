import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require('playwright')); } catch { ({chromium}=require('C:/Users/koone/Documents/Gurjots-Games-work/node_modules/playwright')); }

// All API replies here are TEST-ONLY fixtures, not actual provider verification.
async function harness(t, {hosted=false, configured=true}={}) {
  const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
  const requests=[];
  let result={state:'verified',checkedAt:new Date().toISOString(),sport:'soccer_epl',region:'ca',market:'h2h',eventCount:1,books:[{key:'playnow_ca',title:'TEST-ONLY PlayNow',quoteCount:3,freshQuoteCount:3,lastUpdate:new Date().toISOString()}],error:null};
  const status={providers:{oddsApi:{configured,verification:{state:configured?'not_checked':'unconfigured'}}},deploymentMode:hosted?'hosted-static':'local',liveEnabled:!hosted};
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    requests.push({url:url.pathname+url.search,manual:req.headers['x-odds-manual']});
    if(url.pathname==='/api/status') {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(status));return;}
    if(url.pathname==='/api/odds/verify') {status.providers.oddsApi.verification=result;res.writeHead(result.state==='failed'?502:200,{'content-type':'application/json'});res.end(JSON.stringify({verification:result}));return;}
    if(url.pathname==='/api/odds/sports') {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([{key:'soccer_epl',title:'TEST-ONLY EPL',active:true}]));return;}
    if(url.pathname.startsWith('/api/odds/sports/')) {res.writeHead(200,{'content-type':'application/json','x-requests-remaining':'499','x-requests-used':'1','x-requests-last':'1'});res.end('[]');return;}
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
    try {const content=await readFile(file);res.writeHead(200,{'content-type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'}[path.extname(file)]??'text/plain'});res.end(content);}
    catch {res.writeHead(404);res.end('Not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>!document.querySelector('#connectionStatus').textContent.includes('checking'));
  return {page,requests,errors,setResult:v=>{result=v;},result};
}

test('Edge: explicit selected-feed verification observes books; startup and status checks spend no odds credit', {timeout:60000}, async t=>{
  const {page,requests,errors}=await harness(t);
  assert.equal(await page.locator('#selectedSport').count(),1,'selected sport dropdown must exist');
  assert.equal(await page.locator('#selectedSport').inputValue(),'soccer_epl');
  assert.match(await page.locator('#connectionStatus').innerText(),/configured.*not verified/i);
  assert.equal(requests.filter(r=>r.url.startsWith('/api/odds/')).length,0);
  await page.locator('#btnCheckConnections').click();
  await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('not verified'));
  assert.equal(requests.filter(r=>r.url.startsWith('/api/odds/')).length,0);
  assert.match(await page.locator('#verificationCost').innerText(),/1.*credit.*uncached/i);
  await page.locator('#btnVerifyFeed').click();
  await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('Feed verified'));
  assert.deepEqual(requests.filter(r=>r.url.startsWith('/api/odds/')),[{url:'/api/odds/verify?sport=soccer_epl',manual:'1'}]);
  await page.locator('[data-tab="data"]').click();
  assert.match(await page.locator('#coverageInventory').innerText(),/TEST-ONLY PlayNow/);
  assert.match(await page.locator('#coverageInventory').innerText(),/3 observed.*3 fresh/i);
  assert.match(await page.locator('#coverageInventory').innerText(),/eligibility.*unverified/i);
  assert.equal(await page.locator('#signalsBody .research-card').count(),0,'verification must not substitute a fabricated snapshot');
  if(process.env.UI_SCREENSHOT_DIR) {
    await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'round2-ui-local-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'round2-ui-local-mobile.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
});

test('Edge hosted-static: live controls disabled, clear backend guidance; demo and calculator work on mobile', {timeout:60000}, async t=>{
  const {page,requests,errors}=await harness(t,{hosted:true});
  assert.equal(await page.locator('#btnFetchLive').isDisabled(),true);
  assert.equal(await page.locator('#btnFetchLive2').isDisabled(),true);
  assert.equal(await page.locator('#btnVerifyFeed').isDisabled(),true);
  assert.match(await page.locator('#deploymentNotice').innerText(),/hosted.static.*localhost.*private.*backend/i);
  await page.locator('#btnReloadSample').click();
  await page.waitForFunction(()=>document.querySelector('#researchStatus').textContent.includes('Demo'));
  assert.match(await page.locator('#researchStatus').innerText(),/Demo.*non-actionable/i);
  await page.locator('[data-tab="calculator"]').click();
  await page.locator('#calcOdds').fill('2.5');await page.locator('#calcProb').fill('50');
  assert.match(await page.locator('#calcEV').innerText(),/25\.00/);
  for(const tab of ['signals','data','calculator']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`mobile ${tab} must not overflow`);
  }
  assert.equal(requests.filter(r=>r.url.startsWith('/api/odds/')).length,0);
  assert.equal(await page.locator('[data-tab="tracker"]').isVisible(),false);
  assert.deepEqual(errors,[]);
});

test('Edge: manual Fetch Live requests only selected EPL through manager and remains disabled during status refresh', {timeout:60000}, async t=>{
  const {page,requests,errors}=await harness(t);
  await page.route('**/api/odds/sports/soccer_epl/odds?*',async route=>{
    await new Promise(resolve=>setTimeout(resolve,1200));
    await route.fulfill({contentType:'application/json',body:'[]'});
  });
  const odds=[];page.on('request',r=>{if(r.url().includes('/api/odds/sports/'))odds.push({url:r.url(),manual:r.headers()['x-odds-manual']});});
  await page.locator('#btnFetchLive').click();
  await page.waitForFunction(()=>document.querySelector('#btnFetchLive').textContent==='Fetching...');
  await page.locator('#btnCheckConnections').click();
  await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('not verified'));
  assert.equal(await page.locator('#btnFetchLive').isDisabled(),true,'readiness refresh must not unlock a pending fetch');
  await page.waitForFunction(()=>document.querySelector('#btnFetchLive').textContent==='Fetch Live');
  assert.equal(odds.length,1);
  assert.match(odds[0].url,/\/sports\/soccer_epl\/odds/);
  assert.equal(odds[0].manual,'1');
  assert.equal(requests.filter(r=>r.url.startsWith('/api/odds/verify')).length,0);
  assert.match(await page.locator('#signalsBody').innerText(),/no events returned/i);
  assert.deepEqual(errors,[]);
});

test('Edge: zero events, failed, stale and invalid verification stay explicit and never imply demo coverage', {timeout:60000}, async t=>{
  const {page,setResult,result,errors}=await harness(t);
  for(const [verification,expected] of [
    [{...result,eventCount:0,books:[]},/no events returned.*no book coverage/i],
    [{...result,state:'failed',books:[],error:'TEST-ONLY provider failure'},/Verification failed/i],
    [{...result,checkedAt:new Date(Date.now()-60*60000).toISOString()},/Verification stale/i],
    [{...result,checkedAt:'invalid'},/Invalid verification evidence/i],
  ]) {
    setResult(verification);
    await page.locator('[data-tab="signals"]').click();
    await page.locator('#btnVerifyFeed').click();
    await page.waitForFunction(()=>document.querySelector('#btnVerifyFeed').disabled===false);
    assert.match(await page.locator('#connectionStatus').innerText(),expected);
    await page.locator('[data-tab="data"]').click();
    if(verification.state==='failed') assert.match(await page.locator('#coverageSummary').innerText(),/TEST-ONLY provider failure/);
    if(expected.source.includes('stale')) assert.match(await page.locator('#coverageInventory').innerText(),/0 fresh/);
    else assert.match(await page.locator('#coverageInventory').innerText(),/No observed bookmaker quotes/);
  }
  await page.locator('#btnReloadSample2').click();
  await page.waitForFunction(()=>document.querySelector('#researchStatus').textContent.includes('Demo'));
  assert.match(await page.locator('#coverageSummary').innerText(),/Invalid verification evidence/i);
  assert.match(await page.locator('#coverageInventory').innerText(),/No observed bookmaker quotes/);
  assert.deepEqual(errors,[]);
});

test('Edge: status controls cannot replace readiness during an in-flight manual verification', {timeout:60000},async t=>{
  const {page,result,errors}=await harness(t);
  await page.route('**/api/odds/verify?*',async route=>{
    await new Promise(resolve=>setTimeout(resolve,800));
    await route.fulfill({contentType:'application/json',body:JSON.stringify({verification:result})});
  });
  await page.locator('#btnVerifyFeed').click();
  assert.equal(await page.locator('#btnCheckConnections').isDisabled(),true);
  assert.equal(await page.locator('#selectedSport').isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('#btnVerifyFeed').disabled===false);
  assert.equal(await page.locator('#btnCheckConnections').isDisabled(),false);
  assert.equal(await page.locator('#selectedSport').isDisabled(),false);
  assert.deepEqual(errors,[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require('playwright')); } catch {
  try { ({chromium}=require('C:/Users/koone/Documents/Gurjots-Games-work/node_modules/playwright')); } catch { /* optional local smoke tooling */ }
}

test('real browser: empty startup, connection failure, explicit demo, evidence, calculator and mobile layout', {skip:!chromium,timeout:60000}, async t=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root)) { res.writeHead(403);res.end();return; }
    try {
      const content=await readFile(file);
      const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'text/plain'});res.end(content);
    } catch { res.writeHead(404);res.end('Not found'); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  let browser;
  try { browser=await chromium.launch({headless:true}); } catch { browser=await chromium.launch({headless:true,channel:'msedge'}); }
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  const errors=[]; const requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>requests.push(r.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.querySelector('#connectionStatus').textContent.includes('Disconnected'));
  assert.equal(await page.locator('#signalsBody .research-card').count(),0);
  assert.ok(!requests.some(url=>url.includes('sample-markets')));
  assert.equal(await page.locator('#targetBookSelect').inputValue(),'PlayNow');
  await page.locator('#targetBookSelect').selectOption('Bet365');
  await page.locator('#btnReloadSample').click();
  await page.waitForFunction(()=>document.querySelector('#researchStatus').textContent.includes('Demo'));
  // Baseline probabilities now come from destination-excluded consensus. The
  // historical demo may correctly have no candidates under the default screen.
  assert.match(await page.locator('#researchStatus').innerText(),/Demo.*non-actionable/);
  assert.match(await page.locator('#signalsBody').innerText(),/No-bet is a valid research result/);
  assert.equal(await page.locator('#mTotalStake').textContent(),'$0');
  assert.equal(await page.locator('button:visible').filter({hasText:/^Track$/}).count(),0);
  // Explicit TEST-ONLY independent-model import exercises evidence disclosure;
  // it remains historical paper research, never fabricated live provider data.
  const fixture=JSON.parse(await page.locator('#snapshotEditor').inputValue());
  fixture.markets.forEach(market=>{if(market.model)market.model.version='TEST-ONLY-independent-fixture';});
  await page.locator('[data-tab="data"]').click();
  await page.locator('#snapshotEditor').fill(JSON.stringify(fixture));
  await page.locator('#btnRun').click();
  await page.waitForFunction(()=>document.querySelectorAll('.research-card').length>0);
  assert.match(await page.locator('#signalsBody').innerText(),/Paper only/);
  assert.match(await page.locator('#signalsBody').innerText(),/\$0\.00/);
  await page.locator('.evidence-disclosure summary').first().click();
  assert.match(await page.locator('.evidence-content').first().innerText(),/p \* decimal - 1/);
  await page.locator('[data-tab="calculator"]').click();
  await page.locator('#calcOdds').fill('2.5'); await page.locator('#calcProb').fill('50');
  assert.match(await page.locator('#calcEV').innerText(),/25\.00/);
  await page.locator('[data-tab="signals"]').click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile must not overflow viewport');
  assert.equal(await page.locator('[data-tab="tracker"]').isVisible(),false);
  assert.deepEqual(errors,[]);
  if(process.env.UI_SCREENSHOT_DIR) {
    await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'odds-research-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1080});
    await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'odds-research-desktop.png'),fullPage:true});
  }
});

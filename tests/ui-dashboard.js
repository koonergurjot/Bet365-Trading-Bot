import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { attachResearchEvidence } from '../src/engine/reliabilityGate.js';
import { summarizeConnectionCoverage } from '../src/data/connectionCoverage.js';
const source = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
function harness(fetchImpl = async () => ({ok:true, json:async()=>({})})) {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, {textContent:'', innerHTML:'', value:'', style:{}, classList:{toggle(){}}, setAttribute(){}, addEventListener(){}, querySelectorAll(){return []}}); return nodes.get(id); };
  const calls = [];
  const context = vm.createContext({document:{getElementById:node,querySelectorAll:()=>[]}, localStorage:{getItem:()=>null}, window:{}, console, Date, attachResearchEvidence, summarizeConnectionCoverage, setInterval:callback=>{context.freshnessTick=callback;return 1;}, setTimeout:()=>0, fetch:async(...args)=>{calls.push(args[0]);return fetchImpl(...args)}, liveData:{getAdaptiveEngineConfig:config=>config,restoreCachedSnapshot:()=>null,getFullStatus:()=>({quota:{remaining:null,level:'ok'},isPolling:false}),getStatusSummary:()=>''}, clamp:(v,a,b)=>Math.min(b,Math.max(a,v))});
  const code = source.replace(/\r\n/g,'\n').replace(/import\s+[\s\S]*?from\s+"[^"]+";/g,'').replace('bindEvents();\nupdateCalculator();\nrenderTracker();\nboot();','');
  vm.runInContext(code,context);
  return {nodes,node,calls,run:code=>vm.runInContext(code,context)};
}

test('connections use same-origin readiness and do not assume an unknown schema is connected',async()=>{
  const h=harness(); await h.run('checkConnections()');
  assert.deepEqual(h.calls,['/api/status']);
  assert.match(h.node('connectionStatus').textContent,/disconnected/i);
  const ready=harness(async()=>({ok:true,json:async()=>({providers:{oddsApi:{configured:true}}})}));
  await ready.run('checkConnections()');
  assert.match(ready.node('connectionStatus').textContent,/configured/i);
  assert.match(ready.node('connectionStatus').textContent,/not.*verified/i);
});
test('shell makes research status visible and groups diagnostics below primary shortlist',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/id="researchStatus"/);
  assert.match(html,/id="targetBookSelect"/);
  assert.match(html,/PlayNow/);
  assert.match(html,/<details[^>]*id="researchDiagnostics"/);
  assert.ok(html.indexOf('id="signalsPanel"')<html.indexOf('id="researchDiagnostics"'));
  assert.ok(!html.includes('Keys in')&&!html.includes('Keys are in'));
  const css=fs.readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/:focus-visible/);
  assert.match(css,/candidate-metrics/);
});

test('book choice reaches engine configuration and demo stays visibly non-actionable',()=>{
  const h=harness(); h.node('targetBookSelect').value='PlayNow';
  h.run('liveData.getAdaptiveEngineConfig = config => config');
  assert.equal(h.run('readEngineConfig().targetBook'),'PlayNow');
  h.run(`currentSnapshot = {snapshotAt:'2020-01-01',provider:'manual-sample'}; currentReport={recommendations:[${JSON.stringify({...recommendation,actionable:true,actionableStakeAmount:20})}]}; renderSignals(); updateLiveStatus()`);
  assert.match(h.node('researchStatus').textContent,/demo.*non-actionable/i);
  assert.match(h.node('freshnessStatus').textContent,/stale/i);
  assert.match(h.node('signalsBody').innerHTML,/\$0\.00/);
});
test('summary and portfolio never advertise blocked legacy stake amounts',()=>{
  const h=harness();
  h.run(`currentReport={totalMarkets:1,totalCandidates:1,recommendations:[${JSON.stringify({...recommendation,actionable:false})}],portfolioSummary:{activeCount:1,watchlistCount:0,plannedStakeAmount:20,plannedExposureFraction:.02,reducedStakeAmount:0,caps:{maxTotalExposure:.06,maxEventExposure:.025,maxSportExposure:.04}}}; renderMetrics(currentReport);renderPortfolio(currentReport)`);
  assert.equal(h.node('mTotalStake').textContent,'$0');
  assert.equal(h.node('pPlannedStake').textContent,'$0.00');
  assert.equal(h.node('pActiveSignals').textContent,'0');
});

test('calculator does not infer predictive confidence from positive arithmetic EV',()=>{
  const h=harness();
  h.node('calcOdds').value='2.5';h.node('calcProb').value='50';h.node('calcBankroll').value='1000';h.node('calcKellyFrac').value='.25';
  h.run('decimalToImpliedProbability=d=>1/d;expectedValue=(p,d)=>p*d-1;kellyFraction=(p,d)=>(p*d-1)/(d-1); updateCalculator()');
  assert.match(h.node('calcVerdictSub').textContent,/hypothetical/i);
  assert.ok(!h.node('calcVerdictSub').textContent.includes('high-confidence'));
});
test('export distinguishes paper sizing from gated action amount',()=>{
  const h=harness();
  h.run(`currentReport={recommendations:[${JSON.stringify({...recommendation,actionable:false})}]}; var captured; downloadCsv=(rows)=>{captured=rows};exportSignalsCsv()`);
  const rows=h.run('captured');
  assert.ok(rows[0].includes('PaperStake'));
  assert.ok(rows[0].includes('ActionAmount'));
  assert.equal(rows[1][rows[0].indexOf('ActionAmount')],0);
});

test('blocked paper-only recommendations never trigger value alerts',()=>{
  const h=harness(); h.run('var alerts=[];showToast=message=>alerts.push(message)');
  h.run(`maybeNotifySignals({recommendations:[${JSON.stringify({...recommendation,actionable:false,id:'paper'})}]})`);
  assert.deepEqual(Array.from(h.run('alerts')),[]);
});

test('demo empty state explains selected-book coverage rather than urging weaker gates',()=>{
  const h=harness();h.node('targetBookSelect').value='PlayNow';
  h.run('currentSnapshot={provider:"manual-sample"};currentReport={recommendations:[]};renderSignals()');
  assert.match(h.node('signalsBody').innerHTML,/demo.*Bet365/i);
  assert.match(h.node('signalsBody').innerHTML,/non-actionable/i);
});

test('unsupported selected destination reports unavailable rather than missing Bet365',()=>{
  const h=harness();h.node('targetBookSelect').value='PlayNow';
  h.run('currentSnapshot={provider:"test-only-fixture",totalEvents:1,markets:[{books:[{name:"BetMGM"}]}]};currentReport={recommendations:[],diagnostics:{topReasons:[{code:"missing_bet365"}]}};renderSignals()');
  assert.match(h.node('signalsBody').innerHTML,/PlayNow.*unavailable/i);
  assert.ok(!h.node('signalsBody').innerHTML.includes('Missing Bet365'));
});

test('score component display rounds numeric contributions to one decimal',()=>{
  const h=harness();
  h.run(`currentReport={recommendations:[${JSON.stringify({...recommendation,evidence:{scoreComponents:{value:25.100000000000033,confidence:21,quality:24.456789}}})}]};renderSignals()`);
  const html=h.node('signalsBody').innerHTML;
  assert.match(html,/Value: 25\.1/);
  assert.match(html,/Confidence: 21\.0/);
  assert.match(html,/Quality: 24\.5/);
  assert.ok(!html.includes('25.100000000000033'));
});

function expiringHarness(){
 const h=harness();const at='2026-10-10T20:00:00Z';
 const pick={...recommendation,id:'expiry',marketId:'expiry',selection:'Home',actionable:true,actionableStakeAmount:20};
 const market={id:'expiry',event:'Home vs Away',marketType:'moneyline',snapshotAt:at,commenceTime:'2026-10-11T20:00:00Z',settlementRules:'fixture',settlementRulesVerified:true,jurisdictionVerified:true,model:{validation:{status:'passed',outOfSample:true,sampleSize:500,brierScore:.2,reportId:'fixture'}},books:['PlayNow','Betano','BetMGM','BetRivers'].map(name=>({name,updatedAt:at,outcomes:[{name:'Home',price:2.1},{name:'Away',price:2}]}))};
 h.node('targetBookSelect').value='PlayNow';
 h.run(`Date=class extends Date { static now(){return Date.parse('${at}')} }; currentSnapshot=${JSON.stringify({provider:'test-only-fixture',snapshotAt:at,markets:[market]})}; currentReport={portfolioSummary:{reducedStakeAmount:0,topEventExposures:[],topSportExposures:[],caps:{maxTotalExposure:.06,maxEventExposure:.025,maxSportExposure:.04}},settings:{targetBook:'PlayNow',staleMinutes:8},recommendations:[${JSON.stringify(pick)}]};isLiveMode=true;var alerts=[];showToast=m=>alerts.push(m);downloadCsv=rows=>{globalThis.captured=rows};`);
 return h;
}
for(const operation of ['renderSignals();renderMetrics(currentReport);renderPortfolio(currentReport)','exportSignalsCsv()','maybeNotifySignals(currentReport)']){
 test(`expired quote blocks action amounts before ${operation}`,()=>{
  const h=expiringHarness();assert.equal(h.run('researchActionAmount(currentReport.recommendations[0])'),20);
  h.run("Date=class extends Date { static now(){return Date.parse('2026-10-10T20:09:00Z')} };"+operation);
  assert.equal(h.run('researchActionAmount(currentReport.recommendations[0])'),0);
  if(operation.startsWith('render')){assert.match(h.node('signalsBody').innerHTML,/\$0\.00/);assert.equal(h.node('mTotalStake').textContent,'$0');assert.equal(h.node('pPlannedStake').textContent,'$0.00');}
  if(operation.startsWith('export')){const rows=h.run('captured');assert.equal(rows[1][rows[0].indexOf('ActionAmount')],0);assert.equal(rows[1][rows[0].indexOf('Actionable')],false);}
  if(operation.startsWith('maybe')) assert.equal(h.run('alerts.length'),0);
 });
}
test('unknown source or quote evidence fails closed at use time',()=>{
 for(const mutation of ['delete currentSnapshot.provider','currentSnapshot.markets[0].books[0].updatedAt=null','currentSnapshot.markets[0].books.slice(1).forEach(book=>book.updatedAt=null)','currentSnapshot=null']){
  const h=expiringHarness();h.run(mutation);assert.equal(h.run('researchActionAmount(currentReport.recommendations[0])'),0);
 }
});
test('local freshness timer updates stale display without requesting odds',async()=>{
 const h=expiringHarness();await h.run('boot()');const before=h.calls.length;
 assert.equal(h.run('typeof freshnessTick'),'function');
 h.run("Date=class extends Date { static now(){return Date.parse('2026-10-10T20:09:00Z')} };freshnessTick()");
 assert.equal(h.calls.length,before);assert.match(h.node('signalsBody').innerHTML,/\$0\.00/);assert.match(h.node('freshnessStatus').textContent,/Stale/);
});
const recommendation = {selection:'Home <unsafe>',event:'Home vs Away',league:'League',sport:'soccer',marketType:'h2h',bet365Decimal:2.1,fairDecimal:2,modelProbability:.52,consensusProbability:.50,expectedValue:.092,score:.8,confidence:.7,dataQuality:.8,stakeAmount:20,stakeFraction:.02,risk:{label:'Low'},notes:[],peerBookCount:3,staleBookCount:0};
test('shortlist separates research score from probability and blocks hypothetical stakes',()=>{
  const h=harness();
  h.run(`currentReport = {recommendations:[${JSON.stringify({...recommendation,researchScore:74,actionable:false,blockReasons:['model_not_validated'],evidence:{modelSource:'consensus-fallback',peers:[{book:'Peer',decimal:2.0,noVigProbability:.5,updatedAt:'2020-01-01'}]}})}]}; renderSignals()`);
  const html=h.node('signalsBody').innerHTML;
  assert.match(html,/74\/100/);
  assert.match(html,/not chance of winning/i);
  assert.match(html,/Estimated probability/);
  assert.match(html,/Paper only/);
  assert.match(html,/\$0\.00/);
  assert.ok(!html.includes('$20.00'));
  assert.match(html,/<details/);
  assert.match(html,/p \* decimal - 1/);
  assert.match(html,/Peer/);
  assert.match(html,/consensus/i);
  assert.match(html,/Home &lt;unsafe&gt;/);
  assert.ok(!html.includes('trackSignal'));
});

test('startup stays empty and never silently loads demonstration markets', async()=>{
  const h=harness(); await h.run('boot()');
  assert.ok(!h.calls.some(url=>String(url).includes('sample-markets')),'startup must not fetch sample data');
  assert.match(h.node('researchStatus').textContent,/not validated/i);
});

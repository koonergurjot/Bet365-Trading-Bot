import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeToSnapshot} from '../src/data/oddsApiAdapter.js';
import {applyBaselineModels} from '../src/data/liveDataManager.js';
import {analyzeMarket} from '../src/engine/recommendationEngine.js';
import {fetchAllLiveOdds,quota} from '../src/data/oddsApiAdapter.js';
import {fetchLiveSnapshot,getFetchCount,getLastSnapshot} from '../src/data/liveDataManager.js';
test('catalogue quota stop cannot count as successful empty odds fetch',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;quota.remaining=null;});
 let oddsCalls=0;globalThis.fetch=async url=>{if(/\/odds\?/.test(String(url))) oddsCalls++;return new Response(JSON.stringify([{key:'soccer_epl',active:true}]),{headers:{'x-requests-remaining':'15'}});};
 quota.remaining=null;const count=getFetchCount(),last=getLastSnapshot();
 await assert.rejects(fetchLiveSnapshot({manual:true,withOddsBlaze:false,withSportsDb:false}),/quota|requests left/i);
 assert.equal(oddsCalls,0);assert.equal(getFetchCount(),count);assert.equal(getLastSnapshot(),last);
 quota.remaining=null;globalThis.fetch=async()=>{oddsCalls++;return new Response('[]');};
 assert.equal((await fetchAllLiveOdds({manual:true,sports:['soccer_epl']})).totalEvents,0);assert.equal(oddsCalls,1);
 await assert.rejects(fetchAllLiveOdds({manual:true,sports:[]}),/No odds request/);
});
test('portable CI test step explicitly supplies runner scratch TMPDIR',()=>{
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 assert.match(ci,/env:\s*\n\s+TMPDIR: \$\{\{ runner.temp \}\}/);
});
test('missing provider quote timestamps remain unknown rather than event start or capture time',()=>{
 const event=structuredClone(raw);event.bookmakers.forEach(book=>delete book.last_update);
 const books=normalizeToSnapshot([event]).markets[0].books;assert.ok(books.every(book=>book.updatedAt===null));
});
import vm from 'node:vm';
import {canonicalizeTeamName,canonicalizeText} from '../src/engine/marketNormalizer.js';
import {americanToDecimal} from '../src/engine/oddsMath.js';
test('supplementary provider missing timestamp stays unknown',()=>{
 const source=readFileSync(new URL('../src/data/oddsBlazeAdapter.js',import.meta.url),'utf8').replace(/import .*?;\r?\n/g,'').replace(/export /g,'');
 const context=vm.createContext({API_CONFIG:{oddsBlaze:{}},canonicalizeTeamName,canonicalizeText,americanToDecimal,Date,console});
 vm.runInContext(source,context);
 const entries=vm.runInContext(`extractBookEntries({games:[{home_team:'Home',away_team:'Away',start_time:'2099-01-01',odds:{moneyline:{home:2,away:2}}}]},'bet365',{sport:'soccer',league:'fixture'})`,context);
 assert.equal(entries.length,1);assert.equal(entries[0].book.updatedAt,null);
});
const stamp='2026-10-10T20:00:00Z';
function baseline(price=3){
 const snapshot={snapshotAt:stamp,markets:[{id:'fixture',sport:'soccer',event:'Home vs Away',homeTeam:'Home',awayTeam:'Away',marketType:'moneyline',snapshotAt:stamp,commenceTime:'2099-01-01',books:['Betano','PlayNow','BetMGM','BetRivers'].map(name=>({name,updatedAt:stamp,outcomes:[{name:'Home',price:name==='PlayNow'?price:2},{name:'Away',price:2}]}))}]};
 applyBaselineModels(snapshot);return snapshot.markets[0];
}
const options={targetBook:'PlayNow',bankroll:1000,fractionalKelly:.25,maxBankrollStake:.02,staleMinutes:8,minExpectedValue:-1,minConfidence:0,dynamicThresholds:false};
test('baseline probability excludes selected destination despite precomputed model; price changes EV only',()=>{
 const a=analyzeMarket(baseline(3),options)[0],b=analyzeMarket(baseline(10),options)[0];
 assert.equal(a.modelProbability,.5);assert.equal(b.modelProbability,a.modelProbability);assert.notEqual(a.expectedValue,b.expectedValue);
 const switched=analyzeMarket(baseline(10),{...options,targetBook:'BetMGM'})[0];
 assert.equal(switched.modelProbability,switched.consensusProbability);assert.notEqual(switched.modelProbability,a.modelProbability);
 const independent=baseline(10);independent.model={version:'independent-v1',probabilities:[{name:'Home',probability:.61}]};
 assert.equal(analyzeMarket(independent,options)[0].modelProbability,.61);
});
const raw = {id:'fixture',sport_key:'soccer_epl',sport_title:'EPL',home_team:'Home',away_team:'Away',commence_time:'2099-01-01T00:00:00Z',bookmakers:['betano_ca_on','betmgm_ca_on','betrivers_ca_on','pointsbetca','proline_ca_on','sportsinteraction_ca_on'].map(key=>({key,last_update:'2026-01-01T00:00:00Z',markets:[{key:'h2h',outcomes:[{name:'Home',price:2},{name:'Away',price:2}]}]}))};
test('Ontario destination option values match canonical provider names; labels retain province',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const book of normalizeToSnapshot([raw]).markets[0].books) assert.match(html,new RegExp(`<option value="${book.name}">${book.name==='Proline'?'PROLINE':book.name} \\(CA-ON\\) · not verified for BC</option>`));
});

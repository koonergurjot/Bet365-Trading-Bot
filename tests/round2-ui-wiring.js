import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');

test('manual fetch goes through manager with selected sport, and deployment is checked before fetching',()=>{
  assert.match(app,/fetchLiveSnapshot\(\{[^}]*sports:\s*\[\$\("selectedSport"\)\.value\][^}]*manual:\s*true/);
  const functionBody=app.slice(app.indexOf('async function fetchAndRunLive()'),app.indexOf('function togglePolling()'));
  assert.match(functionBody,/connectionStatus\?\.liveEnabled !== true/);
  assert.ok(functionBody.indexOf('connectionStatus?.liveEnabled') < functionBody.indexOf('fetchLiveSnapshot'));
});

test('connections checklist and footer link to the repository, roadmap and setup without browser key fields',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(html.includes('id="connectionChecklist"'),'connections checklist exists');
  assert.match(html,/<footer[\s\S]*href="https:\/\/github.com\/koonergurjot\/Bet365-Trading-Bot"/);
  assert.match(html,/<footer[\s\S]*href="https:\/\/github.com\/koonergurjot\/Bet365-Trading-Bot\/blob\/main\/docs\/ROADMAP.md"/);
  assert.match(html,/<footer[\s\S]*href="https:\/\/github.com\/koonergurjot\/Bet365-Trading-Bot\/blob\/main\/docs\/CONNECTION_SETUP.md"/);
  assert.doesNotMatch(html,/<input[^>]*(?:password|apiKey)/i);
});

test('local-only expiry tick ages verification evidence without automatically verifying it',()=>{
  const tick=app.slice(app.indexOf('setInterval(() =>'),app.indexOf('}, 30000)'));
  assert.ok(tick.includes('renderConnections()'),'verification coverage must age out without a provider request');
  assert.ok(!tick.includes('verifySelectedFeed()'));
});

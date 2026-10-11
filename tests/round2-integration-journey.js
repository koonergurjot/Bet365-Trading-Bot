// TEST-ONLY: local HTTP fixture + hosted-function emulation. No authenticated provider call; no live coverage claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createLocalServer} from '../server/local-server.js';
import {createOddsProxy} from '../server/odds-proxy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const SECRET = 'TEST-ONLY-journey-secret';

test('TEST-ONLY journey: configured != verified; one uncached ca/h2h credit; selected sport forwarded; observations match fixture only', async () => {
  const upstream = [];
  const fixtureBooks = ['playnow_ca', 'betano_ca_on'];
  const proxy = createOddsProxy({
    env: { ODDS_API_KEY: SECRET }, ledgerPath: null,
    fetchImpl: async (url) => {
      upstream.push(new URL(url));
      return new Response(JSON.stringify([{
        id: 'test-only-1', sport_key: 'soccer_epl', home_team: 'Test Home', away_team: 'Test Away',
        commence_time: new Date(Date.now() + 36e5).toISOString(),
        bookmakers: fixtureBooks.map((key) => ({ key, title: key.toUpperCase(), last_update: new Date().toISOString(),
          markets: [{ key: 'h2h', last_update: new Date().toISOString(), outcomes: [{ name: 'Test Home', price: 2 }, { name: 'Test Away', price: 2 }] }] }))
      }]), { headers: { 'x-requests-remaining': '99', 'x-requests-used': '1' } });
    }
  });
  const server = createLocalServer({ root, proxy });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const status1 = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status1.providers.oddsApi.configured, true);
    assert.equal(status1.providers.oddsApi.verification.state, 'not_checked', 'configured must not imply verified');
    assert.equal(upstream.length, 0, 'status spends no credit');

    const v = await (await fetch(`${base}/api/odds/verify?sport=soccer_epl`, { headers: { 'X-Odds-Manual': '1' } })).json();
    assert.equal(v.verification.state, 'verified');
    assert.equal(v.verification.sport, 'soccer_epl');
    assert.deepEqual([...v.verification.books].map((b) => b.key ?? b).sort(), [...fixtureBooks].sort(), 'no fabricated books');
    assert.equal(upstream.length, 1);
    const u = upstream[0];
    assert.match(u.pathname, /\/sports\/soccer_epl\/odds\/?$/);
    assert.equal(u.searchParams.get('regions'), 'ca');
    assert.equal(u.searchParams.get('markets'), 'h2h');
    assert.ok(!JSON.stringify(v).includes(SECRET));

    const odds = await fetch(`${base}/api/odds/soccer_epl`, { headers: { 'X-Odds-Manual': '1' } });
    await odds.text();
    assert.equal(upstream.length, 1, 'ordinary manual fetch after verification reuses the single cached credit');

    const status2 = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status2.providers.oddsApi.verification.state, 'verified');
    assert.equal(upstream.length, 1);
    assert.ok(!JSON.stringify(status2).includes(SECRET));
  } finally { await new Promise((r) => server.close(r)); }
});

test('TEST-ONLY hosted-function emulation: no secret, no upstream, never live, and no key in shipped browser files', async () => {
  const fnSource = readFileSync(new URL('../functions/api/status.js', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\s*\(|process\.env|apiKey|api_key/i.test(fnSource.replace('Boolean(env.ODDS_API_KEY)','')), 'hosted status must not call upstream or read raw secret values');
  const { onRequest } = await import('../functions/api/status.js');
  const old = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = () => { upstreamCalls++; throw new Error('no upstream'); };
  try {
    const res = await onRequest({ request: new Request('https://example.pages.dev/api/status'), env: { ODDS_API_KEY: SECRET } });
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.liveEnabled, false);
    assert.equal(body.providers.oddsApi.verification.state, 'not_checked', 'configured secret on a static host is still unverified');
    assert.ok(!text.includes(SECRET));
    assert.equal(upstreamCalls, 0);
  } finally { globalThis.fetch = old; }
  for (const f of ['index.html', 'src/app.js', 'src/data/liveDataManager.js', 'src/data/connectionCoverage.js']) {
    assert.ok(!/ODDS_API_KEY\s*=|apiKey=|[?&]api_?key=/i.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')), `${f} has no browser key`);
  }
});

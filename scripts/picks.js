// Refresh free fixtures (football-data.co.uk), scan for value vs sharp/consensus no-vig, append to paper ledger,
// settle finished picks, and write src/data/picks.json for the UI.
// Usage: node scripts/picks.js [--bankroll 1000] [--offline]
import fs from 'node:fs';
import { parseCsv, normaliseFixtures, scanFixtures, evaluateGate } from '../src/research/picks.js';
import { power } from '../src/research/devig.js';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const bankroll = Number(args[args.indexOf('--bankroll') + 1]) || 1000;
const offline = args.includes('--offline');
const ledgerPath = `${root}data/ledger.json`;
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : [];

async function get(url, dest) {
  if (offline) return fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  try { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(r.status); const t = await r.text(); fs.writeFileSync(dest, t); return t; }
  catch (e) { console.error(`WARN ${url}: ${e.message}; using cached copy if any`); return fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : ''; }
}

// 1. settle pending ledger entries from season result files
const season = args.includes('--season') ? args[args.indexOf('--season') + 1] : '2627';
const pending = ledger.filter((e) => !e.settled && e.div);
for (const div of new Set(pending.map((e) => e.div))) {
  const text = await get(`https://www.football-data.co.uk/mmz4281/${season}/${div}.csv`, `${root}data/football-data/${div}_${season}.csv`);
  if (!text) continue;
  for (const r of parseCsv(text)) {
    for (const e of pending.filter((x) => x.div === div && x.home === r.HomeTeam && x.away === r.AwayTeam && x.kickoff.startsWith(r.Date))) {
      if (!['H', 'D', 'A'].includes(r.FTR)) continue;
      const total = Number(r.FTHG) + Number(r.FTAG);
      const win = e.market === '1X2' ? r.FTR === 'HDA'[e.idx] : (e.idx === 0 ? total > 2.5 : total < 2.5);
      const pc = ['PSCH', 'PSCD', 'PSCA'].map((k) => parseFloat(r[k]));
      const oc = ['PC>2.5', 'PC<2.5'].map((k) => parseFloat(r[k]));
      const close = e.market === '1X2' ? (pc.every((x) => x > 1) ? power(pc)[e.idx] : null) : (oc.every((x) => x > 1) ? power(oc)[e.idx] : null);
      Object.assign(e, { settled: true, win, pl: win ? e.bet365Odds - 1 : -1, clv: close == null ? null : close * e.bet365Odds - 1, score: `${r.FTHG}-${r.FTAG}` });
    }
  }
}

// 2. scan fresh fixtures
const f1 = await get('https://www.football-data.co.uk/fixtures.csv', `${root}data/fixtures.csv`);
const f2 = await get('https://www.football-data.co.uk/new_league_fixtures.csv', `${root}data/new_league_fixtures.csv`);
const fixtures = [...normaliseFixtures(parseCsv(f1 || 'a\n')), ...normaliseFixtures(parseCsv(f2 || 'a\n'))];
const picks = scanFixtures(fixtures, { bankroll });
let added = 0;
for (const p of picks) if (!ledger.some((e) => e.key === p.key)) { ledger.push({ ...p, loggedAt: new Date().toISOString(), settled: false }); added++; }
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));

const gate = evaluateGate(ledger);
const out = { generatedAt: new Date().toISOString(), bankroll, fixturesScanned: fixtures.length, gate, picks, recent: ledger.filter((e) => e.settled).slice(-20).reverse() };
fs.writeFileSync(`${root}src/data/picks.json`, JSON.stringify(out, null, 1));
console.log(`Fixtures scanned: ${fixtures.length} | picks: ${picks.length} (new in ledger: ${added}) | ${gate.message}`);
for (const p of picks.slice(0, 10)) console.log(`  ${p.kickoff} ${p.home} v ${p.away} | ${p.market} ${p.selection} @ ${p.bet365Odds} (fair ${p.fairOdds}, EV ${(p.ev * 100).toFixed(1)}%, ref ${p.reference})`);

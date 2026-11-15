// Where is Bet365 softest? Per-league value test vs Pinnacle, plus a two-source consensus filter.
// Ranking is by CLV (less noisy than ROI). Many leagues are tested, so treat any single winner with suspicion.
// Usage: node scripts/backtest-leagues.js
import { loadFootballData } from '../src/research/footballData.js';
import { power } from '../src/research/devig.js';

const dir = new URL('../data/football-data/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const all = loadFootballData(dir);
const OUT = ['H', 'D', 'A'];

function bets(ms, thr, consensus) {
  const out = [];
  for (const m of ms) {
    if (!m.b365 || !m.pin) continue;
    const p = power(m.pin); const a = m.avg ? power(m.avg) : null; const cl = m.pinClose ? power(m.pinClose) : null;
    for (let i = 0; i < 3; i++) {
      const o = m.b365[i]; if (o > 6) continue;
      if (p[i] * o - 1 < thr) continue;
      if (consensus && !(a && a[i] * o - 1 >= thr / 2)) continue; // second independent-ish source must at least half-agree
      out.push({ o, win: m.result === OUT[i], clv: cl ? cl[i] * o - 1 : null, season: m.season, date: m.date });
    }
  }
  return out;
}
function stats(b) {
  const n = b.length; if (!n) return null;
  const pl = b.map((x) => (x.win ? x.o - 1 : -1)); const roi = pl.reduce((a, c) => a + c, 0) / n;
  let s = 99; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); const bs = [];
  for (let k = 0; k < 800; k++) { let t = 0; for (let j = 0; j < n; j++) t += pl[Math.floor(rnd() * n)]; bs.push(t / n); } bs.sort((x, y) => x - y);
  const c = b.filter((x) => x.clv != null); const clv = c.length ? c.reduce((a, x) => a + x.clv, 0) / c.length : null;
  return { n, roi, lo: bs[20], hi: bs[779], clv };
}
const f = (x) => (x == null ? '  n/a' : `${(x * 100).toFixed(1).padStart(6)}%`);
const line = (l, s) => s ? `${l.padEnd(8)} n=${String(s.n).padStart(5)} ROI=${f(s.roi)} CI=[${f(s.lo)},${f(s.hi)}] CLV=${f(s.clv)}` : `${l.padEnd(8)} none`;

const leagues = [...new Set(all.map((m) => m.league))].sort();
for (const thr of [0.02, 0.04]) {
  console.log(`\n== Per league, Bet365 vs Pinnacle, EV>=${thr * 100}% (sorted by CLV) ==`);
  const rows = leagues.map((l) => ({ l, s: stats(bets(all.filter((m) => m.league === l), thr)) })).filter((r) => r.s && r.s.n >= 40).sort((a, b) => (b.s.clv ?? -9) - (a.s.clv ?? -9));
  rows.forEach((r) => console.log(line(r.l, r.s)));
}
console.log('\n== Consensus filter (Pinnacle EV>=2% AND market-average EV>=1%) vs plain, all leagues ==');
console.log(line('plain', stats(bets(all, 0.02, false))));
console.log(line('consens', stats(bets(all, 0.02, true))));
const small = all.filter((m) => !['E0', 'SP1', 'I1', 'D1', 'F1'].includes(m.league));
console.log(line('plain-sm', stats(bets(small, 0.02, false))), '(non-top-5 leagues)');
console.log(line('cons-sm', stats(bets(small, 0.02, true))));
console.log('\n== Home / Draw / Away split (all leagues, EV>=2%) ==');
const bi = (k) => { const out = []; for (const m of all) { if (!m.b365 || !m.pin) continue; const p = power(m.pin), cl = m.pinClose ? power(m.pinClose) : null; const o = m.b365[k]; if (o <= 6 && p[k] * o - 1 >= 0.02) out.push({ o, win: m.result === OUT[k], clv: cl ? cl[k] * o - 1 : null }); } return out; };
['Home', 'Draw', 'Away'].forEach((n, k) => console.log(line(n, stats(bi(k)))));
const early = bets(all, 0.02).filter((b) => b.season < '2122'), late = bets(all, 0.02).filter((b) => b.season >= '2122');
console.log('\n== Stability: seasons <2122 vs >=2122 =='); console.log(line('early', stats(early))); console.log(line('late', stats(late)));

// Proof report: walk-forward bet streams (1X2 + Over/Under 2.5 vs Pinnacle) and Monte Carlo of monthly bankroll results.
// Rules are FIXED in advance (no tuning on the results shown). Usage: node scripts/prove.js [--betsPerMonth 20] [--sims 20000]
import fs from 'node:fs';
import { loadFootballData } from '../src/research/footballData.js';
import { power } from '../src/research/devig.js';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(`--${k}`) ? Number(args[args.indexOf(`--${k}`) + 1]) : d);
const PER_MONTH = arg('betsPerMonth', 20), SIMS = arg('sims', 20000);
const EDGE = 0.02, MAXO = 6;
const all = loadFootballData(`${root}data/football-data/`);
const OUT = ['H', 'D', 'A'];

// Each bet: odds, win, pClose (best estimate of true probability = Pinnacle CLOSING no-vig), clv, season, month
const bets = [];
for (const m of all) {
  const month = m.date.toISOString().slice(0, 7);
  if (m.b365 && m.pin) {
    const p = power(m.pin), c = m.pinClose ? power(m.pinClose) : null;
    for (let i = 0; i < 3; i++) if (m.b365[i] <= MAXO && p[i] * m.b365[i] - 1 >= EDGE)
      bets.push({ kind: '1X2', league: m.league, season: m.season, month, o: m.b365[i], win: m.result === OUT[i] ? 1 : 0, pc: c ? c[i] : null });
  }
  if (m.ouB365 && m.ouPin) {
    const p = power(m.ouPin), c = m.ouPinClose ? power(m.ouPinClose) : null, tot = m.hg + m.ag;
    for (let i = 0; i < 2; i++) if (p[i] * m.ouB365[i] - 1 >= EDGE) {
      const win = i === 0 ? tot > 2.5 : tot < 2.5;
      bets.push({ kind: 'O/U', league: m.league, season: m.season, month, o: m.ouB365[i], win: win ? 1 : 0, pc: c ? c[i] : null });
    }
  }
}
let seed = 20261115; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pl = (b) => (b.win ? b.o - 1 : -1);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function ci(b) { const v = b.map(pl), n = v.length, bs = []; for (let k = 0; k < 1000; k++) { let t = 0; for (let j = 0; j < n; j++) t += v[Math.floor(rnd() * n)]; bs.push(t / n); } bs.sort((x, y) => x - y); return [bs[25], bs[974]]; }
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
function summary(label, b) {
  if (b.length < 30) return { label, n: b.length };
  const withC = b.filter((x) => x.pc); const [lo, hi] = ci(b);
  const clv = withC.length ? mean(withC.map((x) => x.pc * x.o - 1)) : null;
  const months = new Map(); b.forEach((x) => months.set(x.month, (months.get(x.month) || 0) + pl(x)));
  const mv = [...months.values()];
  return { label, n: b.length, hit: mean(b.map((x) => x.win)), roi: mean(b.map(pl)), lo, hi, clv, losingMonths: mv.filter((x) => x < 0).length / mv.length };
}
const rows = [summary('1X2', bets.filter((b) => b.kind === '1X2')), summary('O/U 2.5', bets.filter((b) => b.kind === 'O/U')), summary('Combined', bets)];
for (const s of ['2223', '2324', '2425', '2526']) rows.push(summary(`Combined ${s}`, bets.filter((b) => b.season === s)));
console.log(`Bet pool (fixed rule: edge>=${pct(EDGE, 0)} vs Pinnacle, odds<=${MAXO}):`);
for (const r of rows) console.log(r.n < 30 ? `${r.label.padEnd(16)} n=${r.n} (too few)` : `${r.label.padEnd(16)} n=${String(r.n).padStart(5)} hit=${pct(r.hit)} ROI=${pct(r.roi)} CI95=[${pct(r.lo)},${pct(r.hi)}] CLV=${r.clv == null ? 'n/a' : pct(r.clv)}`);

// Monte Carlo: PER_MONTH bets/month, 1u = 1% of bankroll (flat). Three worlds for the true edge.
const pool = bets.filter((b) => b.pc);
const worlds = {
  'A: history repeats (actual outcomes)': (b) => b.win,
  'B: edge = closing-line value (outcome ~ Pinnacle close prob)': (b) => (rnd() < b.pc ? 1 : 0),
  'C: no edge (outcome ~ Bet365 no-vig prob, i.e. only margin)': (b) => (rnd() < 1 / b.o * 0.95 ? 1 : 0),
};
const horizons = [1, 3, 6, 12];
const result = {};
console.log(`\nMonte Carlo: ${PER_MONTH} bets/month, 1 unit = 1% of bankroll, ${SIMS} sims. Result in % of bankroll.`);
for (const [name, outcome] of Object.entries(worlds)) {
  console.log(`\n${name}`);
  result[name] = {};
  for (const h of horizons) {
    const fin = []; let ruin = 0;
    for (let s = 0; s < SIMS; s++) {
      let bank = 100, peak = 100, dd = 0;
      for (let k = 0; k < PER_MONTH * h; k++) { const b = pool[Math.floor(rnd() * pool.length)]; bank += outcome(b) ? b.o - 1 : -1; if (bank > peak) peak = bank; dd = Math.max(dd, peak - bank); }
      fin.push(bank - 100); if (dd >= 25) ruin++;
    }
    fin.sort((x, y) => x - y);
    const r = { pProfit: fin.filter((x) => x > 0).length / SIMS, median: fin[SIMS >> 1], p5: fin[Math.floor(SIMS * 0.05)], p95: fin[Math.floor(SIMS * 0.95)], pDrawdown25: ruin / SIMS };
    result[name][h] = r;
    console.log(`  ${String(h).padStart(2)} mo: P(profit)=${pct(r.pProfit, 0)} median ${r.median.toFixed(1)}% | 5th ${r.p5.toFixed(1)}% 95th ${r.p95.toFixed(1)}% | P(25% drawdown)=${pct(r.pDrawdown25, 0)}`);
  }
}
fs.writeFileSync(`${root}src/data/proof.json`, JSON.stringify({ generatedAt: new Date().toISOString(), rule: { edge: EDGE, maxOdds: MAXO }, perMonth: PER_MONTH, sims: SIMS, pool: rows, monteCarlo: result }, null, 1));

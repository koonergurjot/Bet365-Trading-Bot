// Walk-forward-style historical test: does "Bet365 price vs sharp (Pinnacle) no-vig price" make money?
// Usage: node scripts/backtest.js [--ref pin|avg] [--maxOdds 6]
// Data: data/football-data/*.csv (free, football-data.co.uk). Flat 1-unit stakes.
import { loadFootballData } from '../src/research/footballData.js';
import { power } from '../src/research/devig.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const REF = args.ref || 'pin';
const MAX_ODDS = Number(args.maxOdds || 6);
const matches = loadFootballData(new URL('../data/football-data/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = ['H', 'D', 'A'];

function candidates(m, minEv) {
  const ref = m[REF]; if (!ref || !m.b365) return [];
  const p = power(ref);
  const close = m.pinClose ? power(m.pinClose) : null;
  const res = [];
  for (let i = 0; i < 3; i++) {
    const o = m.b365[i];
    const ev = p[i] * o - 1;
    if (ev >= minEv && o <= MAX_ODDS) {
      res.push({ m, i, o, p: p[i], ev, clv: close ? close[i] * o - 1 : null, win: m.result === OUT[i] });
    }
  }
  return res;
}

function summarize(bets) {
  const n = bets.length; if (!n) return { n: 0 };
  const pl = bets.map((b) => (b.win ? b.o - 1 : -1));
  const roi = pl.reduce((a, b) => a + b, 0) / n;
  // bootstrap 95% CI on ROI (seeded LCG for reproducibility)
  let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const boots = [];
  for (let k = 0; k < 1000; k++) { let t = 0; for (let j = 0; j < n; j++) t += pl[Math.floor(rnd() * n)]; boots.push(t / n); }
  boots.sort((a, b) => a - b);
  const clvs = bets.filter((b) => b.clv != null);
  return {
    n, hit: bets.filter((b) => b.win).length / n, avgOdds: bets.reduce((a, b) => a + b.o, 0) / n,
    roi, lo: boots[25], hi: boots[974], clv: clvs.length ? clvs.reduce((a, b) => a + b.clv, 0) / clvs.length : null,
    profit: pl.reduce((a, b) => a + b, 0),
  };
}
const pct = (x) => (x == null ? '   n/a' : `${(x * 100).toFixed(1).padStart(6)}%`);
const row = (label, s) => s.n ? `${label.padEnd(14)} n=${String(s.n).padStart(5)} hit=${pct(s.hit)} odds=${s.avgOdds.toFixed(2)} ROI=${pct(s.roi)} CI95=[${pct(s.lo)},${pct(s.hi)}] CLV=${pct(s.clv)} P/L=${s.profit.toFixed(1)}u` : `${label.padEnd(14)} no bets`;

console.log(`Matches loaded: ${matches.length}  | reference: ${REF}  | maxOdds: ${MAX_ODDS}`);
console.log('\n== Control: bet every Bet365 outcome (shows the margin you start against) ==');
console.log(row('all outcomes', summarize(matches.flatMap((m) => candidates(m, -1)))));

console.log('\n== Value rule: bet when ref no-vig p * B365 odds - 1 >= threshold (all seasons) ==');
for (const t of [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.07]) console.log(row(`EV>=${(t * 100).toFixed(0)}%`, summarize(matches.flatMap((m) => candidates(m, t)))));

const seasons = [...new Set(matches.map((m) => m.season))].sort();
const split = seasons[Math.floor(seasons.length / 2)];
console.log(`\n== Out-of-sample: pick threshold on seasons < ${split}, apply to seasons >= ${split} ==`);
let best = { t: 0, roi: -Infinity };
for (const t of [0.01, 0.02, 0.03, 0.04, 0.05, 0.07]) {
  const s = summarize(matches.filter((m) => m.season < split).flatMap((m) => candidates(m, t)));
  if (s.n >= 300 && s.roi > best.roi) best = { t, roi: s.roi };
}
console.log(`chosen threshold (train): EV>=${(best.t * 100).toFixed(0)}%  train ROI ${pct(best.roi)}`);
console.log(row('TEST', summarize(matches.filter((m) => m.season >= split).flatMap((m) => candidates(m, best.t)))));

console.log(`\n== Per season at EV>=${(best.t * 100).toFixed(0)}% ==`);
for (const s of seasons) console.log(row(s, summarize(matches.filter((m) => m.season === s).flatMap((m) => candidates(m, best.t)))));

console.log('\n== Per league at same threshold ==');
for (const l of [...new Set(matches.map((m) => m.league))]) console.log(row(l, summarize(matches.filter((m) => m.league === l).flatMap((m) => candidates(m, best.t)))));

// Monthly P/L distribution: how often is a calendar month negative?
const byMonth = new Map();
for (const b of matches.flatMap((m) => candidates(m, best.t))) {
  const k = b.m.date.toISOString().slice(0, 7); byMonth.set(k, (byMonth.get(k) || 0) + (b.win ? b.o - 1 : -1));
}
const months = [...byMonth.values()];
console.log(`\nCalendar months with bets: ${months.length}; losing months: ${months.filter((x) => x < 0).length} (${pct(months.filter((x) => x < 0).length / months.length)}); worst month ${Math.min(...months).toFixed(1)}u; best ${Math.max(...months).toFixed(1)}u`);

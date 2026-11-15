// Which reference gives the most accurate probability? Log-loss/Brier of pre-close no-vig sources and blends vs real results.
// Same matches for every row (only matches where all sources exist). Lower is better. Usage: node scripts/reference-accuracy.js
import { loadFootballData } from '../src/research/footballData.js';
import { power } from '../src/research/devig.js';
const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const all = loadFootballData(`${root}data/football-data/`).filter((m) => m.pin && m.bfe && m.avg && m.pinClose && m.b365);
const OUT = ['H', 'D', 'A'];
const ll = (p, m) => -Math.log(Math.max(p[OUT.indexOf(m.result)], 1e-9));
const br = (p, m) => p.reduce((a, x, i) => a + (x - (OUT[i] === m.result ? 1 : 0)) ** 2, 0);
const blend = (ps, ws) => { const s = ws.reduce((a, b) => a + b, 0); return ps[0].map((_, i) => ps.reduce((a, p, k) => a + ws[k] * p[i], 0) / s); };
const cands = {
  'Bet365 itself (no-vig)': (m) => power(m.b365),
  'Market average': (m) => power(m.avg),
  'Betfair exchange': (m) => power(m.bfe),
  'Pinnacle': (m) => power(m.pin),
  'Pin 70 / Betfair 30': (m) => blend([power(m.pin), power(m.bfe)], [0.7, 0.3]),
  'Pin 50 / Betfair 50': (m) => blend([power(m.pin), power(m.bfe)], [0.5, 0.5]),
  'Pin 50 / Betfair 25 / Avg 25': (m) => blend([power(m.pin), power(m.bfe), power(m.avg)], [0.5, 0.25, 0.25]),
  'Pinnacle CLOSE (benchmark)': (m) => power(m.pinClose),
};
console.log(`Matches with all sources: ${all.length}`);
const res = Object.entries(cands).map(([k, f]) => ({ k, ll: all.reduce((a, m) => a + ll(f(m), m), 0) / all.length, br: all.reduce((a, m) => a + br(f(m), m), 0) / all.length }));
for (const r of res.sort((a, b) => a.ll - b.ll)) console.log(`${r.k.padEnd(32)} logloss ${r.ll.toFixed(4)}  brier ${r.br.toFixed(4)}`);
// Bootstrap: is Pin50/Bf50 better than Pinnacle alone? (paired difference)
let s = 5; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const d = all.map((m) => ll(cands['Pinnacle'](m), m) - ll(cands['Pin 50 / Betfair 50'](m), m)); const bs = [];
for (let k = 0; k < 1000; k++) { let t = 0; for (let j = 0; j < d.length; j++) t += d[Math.floor(rnd() * d.length)]; bs.push(t / d.length); } bs.sort((a, b) => a - b);
console.log(`\nPinnacle minus Pin50/Betfair50 log-loss: ${(d.reduce((a, b) => a + b, 0) / d.length).toFixed(5)}  95% CI [${bs[25].toFixed(5)}, ${bs[974].toFixed(5)}] (positive = blend better)`);

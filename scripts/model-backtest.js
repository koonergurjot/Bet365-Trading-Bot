// Walk-forward test of the goals model: accuracy vs Pinnacle, and betting vs Bet365 (1X2 and Over/Under 2.5).
// Usage: node scripts/model-backtest.js
import { loadFootballData } from '../src/research/footballData.js';
import { power } from '../src/research/devig.js';
import { fitRatings, predict } from '../src/research/model.js';

const dir = new URL('../data/football-data/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const all = loadFootballData(dir);
const leagues = [...new Set(all.map((m) => m.league))];
const OUT = ['H', 'D', 'A'];
const rows = [];
for (const lg of leagues) {
  const ms = all.filter((m) => m.league === lg);
  let r = null, lastFit = 0;
  for (const m of ms) {
    if (!r || (m.date - lastFit) / 864e5 >= 7) { r = fitRatings(ms, m.date); lastFit = m.date; }
    const pr = predict(r, m.home, m.away); if (pr) rows.push({ m, pr });
  }
}
console.log(`Predicted ${rows.length} of ${all.length} matches walk-forward (needs prior history)`);

const ll = (p, i) => -Math.log(Math.max(p[i], 1e-9));
const idx = (m) => OUT.indexOf(m.result);
const sub = rows.filter(({ m }) => m.pin);
const avg = (f) => sub.reduce((a, x) => a + f(x), 0) / sub.length;
const blend = (a, b, w) => a.map((x, i) => w * x + (1 - w) * b[i]);
console.log('\n== 1X2 log-loss (lower is better), same matches ==');
console.log('Model alone       ', avg(({ m, pr }) => ll(pr.p1x2, idx(m))).toFixed(4));
console.log('Pinnacle no-vig   ', avg(({ m }) => ll(power(m.pin), idx(m))).toFixed(4));
const subC = sub.filter(({ m }) => m.pinClose);
console.log('Pinnacle CLOSE    ', (subC.reduce((a, { m }) => a + ll(power(m.pinClose), idx(m)), 0) / subC.length).toFixed(4));
for (const w of [0.1, 0.2, 0.3]) console.log(`Blend ${w} model   `, avg(({ m, pr }) => ll(blend(pr.p1x2, power(m.pin), w), idx(m))).toFixed(4));

function sim(label, pick) {
  const bets = [];
  for (const x of rows) for (const b of pick(x)) bets.push(b);
  const n = bets.length; if (!n) return console.log(label, 'no bets');
  const pl = bets.map((b) => (b.win ? b.o - 1 : -1)); const roi = pl.reduce((a, b) => a + b, 0) / n;
  let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); const bs = [];
  for (let k = 0; k < 1000; k++) { let t = 0; for (let j = 0; j < n; j++) t += pl[Math.floor(rnd() * n)]; bs.push(t / n); } bs.sort((a, b) => a - b);
  const clv = bets.filter((b) => b.clv != null); const c = clv.length ? clv.reduce((a, b) => a + b.clv, 0) / clv.length : NaN;
  console.log(`${label.padEnd(38)} n=${String(n).padStart(5)} ROI=${(roi * 100).toFixed(1).padStart(6)}% CI95=[${(bs[25] * 100).toFixed(1)}%,${(bs[974] * 100).toFixed(1)}%] CLV=${(c * 100).toFixed(1)}%`);
}
const bet1x2 = (wModel, thr) => ({ m, pr }) => {
  if (!m.b365 || !m.pin) return [];
  const p = blend(pr.p1x2, power(m.pin), wModel); const cl = m.pinClose ? power(m.pinClose) : null; const out = [];
  for (let i = 0; i < 3; i++) if (p[i] * m.b365[i] - 1 >= thr && m.b365[i] <= 6) out.push({ o: m.b365[i], win: m.result === OUT[i], clv: cl ? cl[i] * m.b365[i] - 1 : null });
  return out;
};
console.log('\n== Betting Bet365 1X2 (flat 1u) ==');
for (const thr of [0.03, 0.05, 0.08]) sim(`model only, EV>=${thr * 100}%`, bet1x2(1, thr));
for (const thr of [0.02, 0.03, 0.05]) sim(`blend 30% model/70% pin, EV>=${thr * 100}%`, bet1x2(0.3, thr));
sim('pin only EV>=2% (baseline)', bet1x2(0, 0.02));

const betOU = (wModel, thr) => ({ m, pr }) => {
  if (!m.ouB365 || !m.ouPin) return [];
  const total = m.hg + m.ag; const pinP = power(m.ouPin); const cl = m.ouPinClose ? power(m.ouPinClose) : null;
  const p = [wModel * pr.pOver + (1 - wModel) * pinP[0], 0]; p[1] = 1 - p[0]; const out = [];
  for (let i = 0; i < 2; i++) if (p[i] * m.ouB365[i] - 1 >= thr) out.push({ o: m.ouB365[i], win: i === 0 ? total > 2.5 : total < 2.5, clv: cl ? cl[i] * m.ouB365[i] - 1 : null });
  return out;
};
console.log('\n== Betting Bet365 Over/Under 2.5 (flat 1u) ==');
sim('pin only EV>=2%', betOU(0, 0.02)); sim('pin only EV>=4%', betOU(0, 0.04));
sim('model only EV>=5%', betOU(1, 0.05)); sim('blend 30% EV>=3%', betOU(0.3, 0.03));

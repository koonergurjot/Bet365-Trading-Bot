// Variance study: does restricting odds / adding O/U raise P(profit over 3 months) under the CLV-implied world?
// Pre-registered grid, reported in full (no cherry-picking). Usage: node scripts/sweep.js
import { loadFootballData } from '../src/research/footballData.js';
import { power } from '../src/research/devig.js';
const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const all = loadFootballData(`${root}data/football-data/`);
const OUT = ['H', 'D', 'A'];
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

function pool(edge, maxO, minO, kinds) {
  const b = [];
  for (const m of all) {
    if (kinds.includes('1X2') && m.b365 && m.pin && m.pinClose) {
      const p = power(m.pin), c = power(m.pinClose);
      for (let i = 0; i < 3; i++) { const o = m.b365[i]; if (o <= maxO && o >= minO && p[i] * o - 1 >= edge) b.push({ o, win: m.result === OUT[i] ? 1 : 0, pc: c[i], season: m.season }); }
    }
    if (kinds.includes('OU') && m.ouB365 && m.ouPin && m.ouPinClose) {
      const p = power(m.ouPin), c = power(m.ouPinClose), t = m.hg + m.ag;
      for (let i = 0; i < 2; i++) { const o = m.ouB365[i]; if (o <= maxO && o >= minO && p[i] * o - 1 >= edge) b.push({ o, win: (i === 0 ? t > 2.5 : t < 2.5) ? 1 : 0, pc: c[i], season: m.season }); }
    }
  }
  return b;
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function sim(b, perMonth, months, sims = 4000) {
  let up = 0; const fin = [];
  for (let s = 0; s < sims; s++) { let bank = 0; for (let k = 0; k < perMonth * months; k++) { const x = b[Math.floor(rnd() * b.length)]; bank += rnd() < x.pc ? x.o - 1 : -1; } fin.push(bank); if (bank > 0) up++; }
  fin.sort((x, y) => x - y); return { p: up / sims, med: fin[sims >> 1], p5: fin[Math.floor(sims * 0.05)] };
}
const grid = [];
for (const kinds of [['1X2'], ['OU'], ['1X2', 'OU']]) for (const maxO of [2.2, 3, 6]) for (const edge of [0.02, 0.03, 0.05]) {
  const b = pool(edge, maxO, 1.01, kinds); if (b.length < 150) { continue; }
  const clv = mean(b.map((x) => x.pc * x.o - 1)); const roi = mean(b.map((x) => (x.win ? x.o - 1 : -1)));
  const r3 = sim(b, 20, 3), r6 = sim(b, 20, 6);
  grid.push({ kinds: kinds.join('+'), maxO, edge, n: b.length, hit: mean(b.map((x) => x.win)), clv, roi, p3: r3.p, p6: r6.p, med3: r3.med, p5_3: r3.p5 });
}
console.log('markets  maxOdds edge   n     hit    CLV    ROI(hist)  P(up 3mo) P(up 6mo)  median3mo(units) 5th pct 3mo');
for (const g of grid.sort((a, b) => b.p3 - a.p3)) console.log(`${g.kinds.padEnd(8)} ${String(g.maxO).padEnd(7)} ${(g.edge * 100).toFixed(0).padStart(2)}%  ${String(g.n).padStart(5)}  ${(g.hit * 100).toFixed(0).padStart(3)}%  ${(g.clv * 100).toFixed(1).padStart(5)}%  ${(g.roi * 100).toFixed(1).padStart(6)}%     ${(g.p3 * 100).toFixed(0).padStart(3)}%      ${(g.p6 * 100).toFixed(0).padStart(3)}%     ${g.med3.toFixed(1).padStart(6)}        ${g.p5_3.toFixed(1)}`);
console.log(`\n${grid.length} combinations tested (20 bets/month, flat 1u, outcomes drawn from Pinnacle closing probabilities). Pick one a priori; the top row is the most optimistic of ${grid.length}.`);

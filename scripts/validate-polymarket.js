// Is Polymarket a trustworthy reference? Score recent SETTLED games: its price ~1h before the start vs the actual result.
// Usage: node scripts/validate-polymarket.js [--per 60] [--minutes 60]
// Output: log-loss/Brier vs a coin flip, and a calibration table. Also written to src/data/polymarket-validation.json.
import fs from 'node:fs';
import { LEAGUES, listEvents, parseGame, priceBefore } from '../src/research/polymarket.js';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const per = Number(args[args.indexOf('--per') + 1]) || 60;
const minutes = Number(args[args.indexOf('--minutes') + 1]) || 60;
const rows = [];
for (const sport of Object.keys(LEAGUES)) {
  let ev = [];
  try { ev = await listEvents(sport, { closed: true, limit: per }); } catch (e) { console.error('WARN', sport, e.message); continue; }
  for (const e of ev) {
    const g = parseGame(e, sport, { requirePregame: false }); if (!g || !g.start) continue;
    const market = (e.markets || []).filter((m) => m.sportsMarketType === 'moneyline');
    const finals = g.kind === '2way' ? JSON.parse(market[0].outcomePrices).map(Number) : market.map((m) => Number(JSON.parse(m.outcomePrices)[0]));
    if (!finals.some((x) => x >= 0.99) || finals.filter((x) => x >= 0.99).length !== 1) continue; // unresolved or void
    const pre = [];
    try { for (const o of g.outcomes) pre.push(await priceBefore(o.token, new Date(g.start).getTime(), minutes)); } catch { continue; }
    if (pre.some((p) => p == null)) continue;
    const s = pre.reduce((a, b) => a + b, 0); if (s < 0.9 || s > 1.1) continue;
    pre.forEach((p, i) => rows.push({ sport, game: g.title, p: p / s, win: finals[i] >= 0.99 ? 1 : 0, liquidity: g.liquidity }));
  }
  console.log(sport.padEnd(5), 'scored outcomes so far:', rows.length);
}
const ll = (r) => -Math.log(Math.max(r.win ? r.p : 1 - r.p, 1e-6));
const br = (r) => (r.p - r.win) ** 2;
const stat = (rs, label) => {
  if (!rs.length) return `${label}: none`;
  const n = rs.length; const k = Math.log(2);
  const base3 = rs.filter((r) => LEAGUES[r.sport].kind === '3way').length / n;
  return `${label.padEnd(10)} outcomes=${String(n).padStart(4)} logloss=${(rs.reduce((a, r) => a + ll(r), 0) / n).toFixed(4)} brier=${(rs.reduce((a, r) => a + br(r), 0) / n).toFixed(4)} mean p=${(rs.reduce((a, r) => a + r.p, 0) / n).toFixed(3)} actual win rate=${(rs.reduce((a, r) => a + r.win, 0) / n).toFixed(3)}`;
};
console.log('\n' + stat(rows, 'ALL'));
const bySport = {};
for (const sp of new Set(rows.map((r) => r.sport))) { bySport[sp] = rows.filter((r) => r.sport === sp); console.log(stat(bySport[sp], sp)); }
console.log('\nCalibration (predicted vs actual):');
const bins = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]];
const cal = bins.map(([a, b]) => { const rs = rows.filter((r) => r.p >= a && r.p < b); return { range: `${a.toFixed(1)}-${Math.min(b, 1).toFixed(1)}`, n: rs.length, predicted: rs.length ? rs.reduce((x, r) => x + r.p, 0) / rs.length : null, actual: rs.length ? rs.reduce((x, r) => x + r.win, 0) / rs.length : null }; });
cal.forEach((c) => console.log(`${c.range}  n=${String(c.n).padStart(4)}  predicted ${c.predicted == null ? '  -  ' : c.predicted.toFixed(3)}  actual ${c.actual == null ? '  -  ' : c.actual.toFixed(3)}`));
fs.writeFileSync(`${root}src/data/polymarket-validation.json`, JSON.stringify({ generatedAt: new Date().toISOString(), minutesBeforeStart: minutes, outcomes: rows.length, games: new Set(rows.map((r) => r.game)).size, logloss: rows.reduce((a, r) => a + ll(r), 0) / rows.length, brier: rows.reduce((a, r) => a + br(r), 0) / rows.length, calibration: cal }, null, 1));

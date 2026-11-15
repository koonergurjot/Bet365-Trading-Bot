// Settle paper bets you logged from the Price check tab.
// 1. In the app click "Export paper bets", save the file as data/paper-bets.json
// 2. node scripts/settle-paper.js  -> settles finished games from Polymarket results, computes closing-line value,
//    writes data/paper-ledger.json and src/data/paper-summary.json (used by the Proof tab and the real-money gate).
import fs from 'node:fs';
import { getEvent, tokenResult, priceBefore } from '../src/research/polymarket.js';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const inPath = `${root}data/paper-bets.json`, ledPath = `${root}data/paper-ledger.json`;
const incoming = fs.existsSync(inPath) ? JSON.parse(fs.readFileSync(inPath, 'utf8')) : [];
const ledger = fs.existsSync(ledPath) ? JSON.parse(fs.readFileSync(ledPath, 'utf8')) : [];
for (const b of incoming) if (!ledger.some((x) => x.id === b.id)) ledger.push({ ...b, settled: false });

for (const b of ledger.filter((x) => !x.settled && new Date(x.start) < new Date())) {
  try {
    const ev = await getEvent(b.gameId); const res = tokenResult(ev, b.token);
    if (res == null) continue;
    let close = null; try { close = await priceBefore(b.token, new Date(b.start).getTime(), 2); } catch { /* no history */ }
    Object.assign(b, { settled: true, win: !!res, pl: res ? (b.odds - 1) * b.stakeUnits : -b.stakeUnits, closeProb: close, clv: close ? close * b.odds - 1 : null });
  } catch (e) { console.error('WARN', b.title, e.message); }
}
fs.writeFileSync(ledPath, JSON.stringify(ledger, null, 1));

const done = ledger.filter((x) => x.settled), withClv = done.filter((x) => x.clv != null);
const staked = done.reduce((a, x) => a + x.stakeUnits, 0);
const summary = {
  generatedAt: new Date().toISOString(), logged: ledger.length, settled: done.length, pending: ledger.length - done.length,
  profitUnits: done.reduce((a, x) => a + x.pl, 0), roi: staked ? done.reduce((a, x) => a + x.pl, 0) / staked : null,
  meanClv: withClv.length ? withClv.reduce((a, x) => a + x.clv, 0) / withClv.length : null, clvPositiveShare: withClv.length ? withClv.filter((x) => x.clv > 0).length / withClv.length : null,
  gate: { needSettled: 100, needClv: 0.005 },
};
summary.gateOpen = summary.settled >= 100 && summary.meanClv != null && summary.meanClv >= 0.005;
fs.writeFileSync(`${root}src/data/paper-summary.json`, JSON.stringify(summary, null, 1));
console.log(summary);

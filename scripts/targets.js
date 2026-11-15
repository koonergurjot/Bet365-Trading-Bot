// Build the target-price board from Polymarket (free, no key) and archive an immutable snapshot.
// Usage: node scripts/targets.js [--days 10]
import fs from 'node:fs';
import { fetchUpcoming } from '../src/research/polymarket.js';
import { buildBoard } from '../src/research/targets.js';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 10;
const { games, errors } = await fetchUpcoming(undefined, { horizonDays: days });
const rows = buildBoard(games);
const validationPath = `${root}src/data/polymarket-validation.json`;
const validation = fs.existsSync(validationPath) ? JSON.parse(fs.readFileSync(validationPath, 'utf8')) : null;
const out = { generatedAt: new Date().toISOString(), source: 'Polymarket public API (read-only)', gamesFound: games.length, rows, errors, validation: validation && { games: validation.games, outcomes: validation.outcomes, brier: validation.brier, logloss: validation.logloss, generatedAt: validation.generatedAt } };
fs.writeFileSync(`${root}src/data/targets.json`, JSON.stringify(out, null, 1));

// Append-only snapshot so later work can measure how the reference moved and replay decisions.
fs.mkdirSync(`${root}data/snapshots`, { recursive: true });
const day = out.generatedAt.slice(0, 10);
fs.appendFileSync(`${root}data/snapshots/polymarket-${day}.jsonl`, games.map((g) => JSON.stringify({ t: out.generatedAt, id: g.id, sport: g.sport, title: g.title, start: g.start, liquidity: g.liquidity, spread: g.spread, probs: g.outcomes.map((o) => [o.name, Math.round(o.prob * 1e4) / 1e4]) })).join('\n') + (games.length ? '\n' : ''));

const bySport = {}; for (const r of rows) bySport[r.league] = (bySport[r.league] || 0) + 1;
console.log(`Games parsed: ${games.length} | board rows: ${rows.length} | errors: ${errors.length}`); console.log(bySport);
for (const e of errors) console.log('  WARN', e);
for (const r of rows.slice(0, 6)) console.log(`  ${r.start.slice(0, 16)} ${r.title} -> ${r.selection}: fair ${r.fairOdds} (${r.fairAmerican > 0 ? '+' : ''}${r.fairAmerican}), take at >= ${r.minOdds} (${r.minAmerican > 0 ? '+' : ''}${r.minAmerican}) grade ${r.grade}`);

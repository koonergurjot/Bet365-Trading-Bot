// Target-price board + price-check verdicts. Pure functions, shared by Node scripts and the browser UI.
// Idea: we do not need Bet365's live feed. The reference gives a fair price; Bet365 only needs to show a price above it.

export const GRADES = [
  { grade: 'A', minLiquidity: 500000, maxSpread: 0.02, minEdge: 0.02 },
  { grade: 'B', minLiquidity: 100000, maxSpread: 0.04, minEdge: 0.03 },
  { grade: 'C', minLiquidity: 25000, maxSpread: 0.08, minEdge: 0.05 }, // thin market: reference is noisier, demand a bigger gap
];
export const MAX_ODDS = 6;
export const KELLY_FRACTION = 0.25;
export const MAX_STAKE_PCT = 0.01;

export function gradeGame(g) {
  const spread = g.spread ?? 0;
  return GRADES.find((x) => g.liquidity >= x.minLiquidity && spread <= x.maxSpread) || null;
}

export const decimalToAmerican = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
export function parseOdds(text) {
  const s = String(text ?? '').trim().replace(/^\+/, '');
  if (!s) return null;
  const n = Number(s); if (!Number.isFinite(n)) return null;
  if (/^-?\d+$/.test(s) && Math.abs(n) >= 100) return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n); // American
  return n > 1 ? n : null; // decimal
}

export function buildBoard(games) {
  const rows = [];
  for (const g of games) {
    const grade = gradeGame(g); if (!grade) continue;
    for (const o of g.outcomes) {
      const fairOdds = 1 / o.prob; const minOdds = (1 + grade.minEdge) / o.prob;
      if (o.prob < 0.03 || minOdds > MAX_ODDS) continue; // hopeless longshots
      rows.push({
        gameId: g.id, token: o.token, league: g.league, sport: g.sport, start: g.start, home: g.title, selection: o.name, title: g.title,
        fairProb: round(o.prob, 4), fairOdds: round(fairOdds, 3), minOdds: round(minOdds, 3), minAmerican: decimalToAmerican(minOdds),
        fairAmerican: decimalToAmerican(fairOdds), grade: grade.grade, minEdge: grade.minEdge, liquidity: Math.round(g.liquidity), spread: g.spread,
      });
    }
  }
  return rows.sort((a, b) => new Date(a.start) - new Date(b.start) || a.title.localeCompare(b.title));
}

export function verdict(row, offeredDecimal, bankroll = 1000) {
  if (!offeredDecimal || offeredDecimal <= 1) return { status: 'invalid', text: 'Enter the odds Bet365 shows.' };
  const ev = row.fairProb * offeredDecimal - 1;
  if (offeredDecimal > MAX_ODDS) return { status: 'pass', ev, text: 'Odds above 6.0: skipped, variance too high.' };
  if (offeredDecimal >= row.minOdds) {
    const f = (row.fairProb * offeredDecimal - 1) / (offeredDecimal - 1);
    const stake = Math.round(Math.min(f * KELLY_FRACTION, MAX_STAKE_PCT) * bankroll * 100) / 100;
    return { status: 'bet', ev, stake, text: `Value: +${(ev * 100).toFixed(1)}% estimated edge (needed ${(row.minEdge * 100).toFixed(0)}% for grade ${row.grade}).` };
  }
  return { status: 'pass', ev, text: ev > 0 ? `Edge +${(ev * 100).toFixed(1)}% is below the ${(row.minEdge * 100).toFixed(0)}% needed for a grade ${row.grade} reference.` : 'No edge at this price.' };
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

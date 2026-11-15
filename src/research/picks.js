// Value scanner: Bet365 price vs sharp/consensus no-vig probability, with evidence gates.
// Pure functions so they can be unit-tested. No network, no betting.
import { power } from './devig.js';

export const RULES = {
  minEv: 0.02,          // minimum estimated edge on 1X2 (backtest: EV>=1-2% vs Pinnacle had positive CLV)
  minEvOU: 0.03,
  maxOdds: 6,           // longshots excluded: backtest variance dominates
  kellyFraction: 0.25,
  maxStakePct: 0.01,    // never more than 1% of bankroll per bet
  gateMinSettled: 100,  // real-money gate: prospective paper picks settled...
  gateMinClv: 0.005,    // ...with mean closing-line value >= +0.5%
};

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 1 ? n : null; };
const take = (r, ...keys) => { const t = keys.map((k) => num(r[k])); return t.every(Boolean) ? t : null; };

export function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => { const c = l.split(','); return Object.fromEntries(head.map((h, i) => [h, c[i]])); });
}

export function normaliseFixtures(rows) {
  return rows.map((r) => {
    const isNew = 'Home' in r;
    return {
      league: isNew ? `${r.Country} ${r.League}` : r.Div,
      div: isNew ? null : r.Div,
      date: r.Date, time: r.Time, home: isNew ? r.Home : r.HomeTeam, away: isNew ? r.Away : r.AwayTeam,
      b365: take(r, 'B365H', 'B365D', 'B365A'),
      pin: take(r, 'PSH', 'PSD', 'PSA'),
      avg: take(r, 'AvgH', 'AvgD', 'AvgA'),
      bfe: take(r, 'BFEH', 'BFED', 'BFEA'),
      ouB365: take(r, 'B365>2.5', 'B365<2.5'),
      ouAvg: take(r, 'Avg>2.5', 'Avg<2.5'),
    };
  }).filter((f) => f.home && f.away);
}

export function kellyStake(p, o, bankroll, rules = RULES) {
  const f = (p * o - 1) / (o - 1);
  if (f <= 0) return 0;
  return Math.round(Math.min(f * rules.kellyFraction, rules.maxStakePct) * bankroll * 100) / 100;
}

const LABELS = ['Home win', 'Draw', 'Away win'];

export function scanFixtures(fixtures, { bankroll = 1000, rules = RULES } = {}) {
  const picks = [];
  for (const f of fixtures) {
    if (f.b365) {
      // Reference priority: Pinnacle (sharp) > market average. Averages include Bet365 itself, so they are weaker.
      const refName = f.pin ? 'Pinnacle' : f.avg ? 'Market average' : null;
      const ref = f.pin || f.avg;
      if (ref) {
        const p = power(ref);
        for (let i = 0; i < 3; i++) {
          const o = f.b365[i]; const ev = p[i] * o - 1;
          if (ev >= rules.minEv && o <= rules.maxOdds) picks.push(build(f, '1X2', LABELS[i], i, o, p[i], ev, refName, rules, bankroll));
        }
      }
    }
    if (f.ouB365 && f.ouAvg) {
      const p = power(f.ouAvg);
      [['Over 2.5 goals', 0], ['Under 2.5 goals', 1]].forEach(([name, i]) => {
        const o = f.ouB365[i]; const ev = p[i] * o - 1;
        if (ev >= rules.minEvOU) picks.push(build(f, 'O/U 2.5', name, i, o, p[i], ev, 'Market average', rules, bankroll));
      });
    }
  }
  return picks.sort((a, b) => b.ev - a.ev);
}

function build(f, market, selection, idx, odds, p, ev, refName, rules, bankroll) {
  return {
    key: `${f.league}|${f.date}|${f.home}|${f.away}|${market}|${selection}`,
    league: f.league, div: f.div, kickoff: `${f.date} ${f.time || ''}`.trim(), home: f.home, away: f.away,
    market, selection, idx, bet365Odds: odds, fairProb: round(p, 4), fairOdds: round(1 / p, 2),
    ev: round(ev, 4), minOdds: round((1 + rules.minEv) / p, 2), reference: refName,
    paperStake: kellyStake(p, odds, bankroll, rules),
    why: `${refName} no-vig puts this at ${(p * 100).toFixed(1)}% (fair odds ${(1 / p).toFixed(2)}). Bet365 offers ${odds.toFixed(2)}, an estimated ${(ev * 100).toFixed(1)}% edge. Take it only if Bet365 still shows ${((1 + rules.minEv) / p).toFixed(2)} or better.`,
  };
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// Real-money gate: only opens when prospective paper results justify it.
export function evaluateGate(ledger, rules = RULES) {
  const settled = ledger.filter((e) => e.settled);
  const withClv = settled.filter((e) => e.clv != null);
  const n = settled.length;
  const roi = n ? settled.reduce((a, e) => a + e.pl, 0) / n : null;
  const clv = withClv.length ? withClv.reduce((a, e) => a + e.clv, 0) / withClv.length : null;
  const open = n >= rules.gateMinSettled && clv != null && clv >= rules.gateMinClv;
  return {
    open, settled: n, pending: ledger.length - n, paperRoi: roi, meanClv: clv,
    need: { settled: rules.gateMinSettled, clv: rules.gateMinClv },
    message: open ? 'Gate open: prospective paper picks show positive closing-line value. Use small stakes only.'
      : `Gate closed: ${n}/${rules.gateMinSettled} paper picks settled${clv == null ? '' : `, mean CLV ${(clv * 100).toFixed(1)}%`}. Paper-trade only.`,
  };
}

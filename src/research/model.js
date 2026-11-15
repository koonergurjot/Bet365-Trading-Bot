// Time-decayed Poisson team-strength model with Dixon-Coles low-score correction.
// Pure functions. Fit only on matches strictly before the prediction date (walk-forward safe).
const MAXG = 10;
const poissonPmf = (lam, k) => { let p = Math.exp(-lam); for (let i = 1; i <= k; i++) p *= lam / i; return p; };

export function fitRatings(matches, asOf, { halfLifeDays = 365, windowDays = 1100, iters = 25, prior = 3 } = {}) {
  const xi = Math.log(2) / halfLifeDays;
  const train = matches.filter((m) => m.date < asOf && (asOf - m.date) / 864e5 <= windowDays);
  if (train.length < 150) return null;
  const w = train.map((m) => Math.exp(-xi * (asOf - m.date) / 864e5));
  const teams = new Map(); const count = new Map();
  for (const m of train) for (const t of [m.home, m.away]) { if (!teams.has(t)) teams.set(t, { a: 1, d: 1 }); count.set(t, (count.get(t) || 0) + 1); }
  let hg = 0, ag = 0, W = 0;
  train.forEach((m, i) => { hg += w[i] * m.hg; ag += w[i] * m.ag; W += w[i]; });
  const muH = hg / W, muA = ag / W; // league mean goals home/away (home advantage baked in)
  for (let it = 0; it < iters; it++) {
    const aN = new Map(), aD = new Map(), dN = new Map(), dD = new Map();
    for (const [t] of teams) { aN.set(t, prior * muH); aD.set(t, prior * muH); dN.set(t, prior * muH); dD.set(t, prior * muH); }
    train.forEach((m, i) => {
      const H = teams.get(m.home), A = teams.get(m.away);
      aN.set(m.home, aN.get(m.home) + w[i] * m.hg); aD.set(m.home, aD.get(m.home) + w[i] * muH * A.d);
      aN.set(m.away, aN.get(m.away) + w[i] * m.ag); aD.set(m.away, aD.get(m.away) + w[i] * muA * H.d);
      dN.set(m.away, dN.get(m.away) + w[i] * m.hg); dD.set(m.away, dD.get(m.away) + w[i] * muH * H.a);
      dN.set(m.home, dN.get(m.home) + w[i] * m.ag); dD.set(m.home, dD.get(m.home) + w[i] * muA * A.a);
    });
    for (const [t, v] of teams) { v.a = aN.get(t) / aD.get(t); v.d = dN.get(t) / dD.get(t); }
    let ma = 0; for (const [, v] of teams) ma += v.a; ma /= teams.size;
    for (const [, v] of teams) { v.a /= ma; v.d *= ma; }
  }
  return { teams, muH, muA, count, n: train.length };
}

const tau = (x, y, lh, la, rho) => {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
};

export function predict(r, home, away, { rho = -0.06, minGames = 8 } = {}) {
  const H = r?.teams.get(home), A = r?.teams.get(away);
  if (!H || !A || r.count.get(home) < minGames || r.count.get(away) < minGames) return null;
  const lh = r.muH * H.a * A.d, la = r.muA * A.a * H.d;
  let ph = 0, pd = 0, pa = 0, over = 0, tot = 0;
  for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) {
    const p = poissonPmf(lh, x) * poissonPmf(la, y) * tau(x, y, lh, la, rho);
    tot += p; if (x > y) ph += p; else if (x === y) pd += p; else pa += p; if (x + y > 2.5) over += p;
  }
  return { p1x2: [ph / tot, pd / tot, pa / tot], pOver: over / tot, lh, la };
}

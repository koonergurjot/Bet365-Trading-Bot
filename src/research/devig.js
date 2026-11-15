// Margin-removal methods for a complete, mutually exclusive market.
export function proportional(odds) {
  const inv = odds.map((o) => 1 / o);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
}

// Power method: find k so sum((1/o)^k) = 1. Corrects favourite-longshot bias better than proportional.
export function power(odds) {
  const inv = odds.map((o) => 1 / o);
  let lo = 0.5; let hi = 2; // k>=1 when overround>0
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const s = inv.reduce((a, x) => a + x ** k, 0);
    if (s > 1) lo = k; else hi = k;
  }
  const k = (lo + hi) / 2;
  return inv.map((x) => x ** k);
}

export const overround = (odds) => odds.reduce((a, o) => a + 1 / o, 0) - 1;

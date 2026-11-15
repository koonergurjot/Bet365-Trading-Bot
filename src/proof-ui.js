// Proof tab: backtest evidence, Monte Carlo odds of finishing a period ahead, and live paper-bet gate. Display only.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const get = async (u) => { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } };

async function init() {
  const root = document.getElementById('proofRoot'); if (!root) return;
  const [proof, paper] = await Promise.all([get('./src/data/proof.json'), get('./src/data/paper-summary.json')]);
  if (!proof) { root.innerHTML = '<div class="no-bet"><h2>No proof report yet</h2><p>Run <code>node scripts/prove.js</code>.</p></div>'; return; }
  const worlds = Object.entries(proof.monteCarlo);
  const poolRows = proof.pool.filter((r) => r.n >= 30);
  // Safe: all dynamic strings pass through esc(); numbers are formatted locally.
  root.innerHTML = `
    <section class="gate gate-closed"><strong>Bottom line</strong>
      <p>The edge found is real but thin (about +1.7% closing-line value). Over ${proof.perMonth} bets a month the simulated chance of being ahead is roughly 52–56% after 3 months, 54–61% after 6. Profit is possible, not reliable month to month. Judge it over 6–12 months and 100+ settled paper bets.</p></section>
    <section class="evidence"><h3>Backtest (fixed rule: edge ≥ ${pct(proof.rule.edge, 0)} vs Pinnacle, odds ≤ ${proof.rule.maxOdds})</h3>
      <div class="table-wrap"><table class="check-table"><thead><tr><th>Slice</th><th>Bets</th><th>ROI</th><th>95% range</th><th>Closing-line value</th></tr></thead><tbody>
      ${poolRows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.n}</td><td>${pct(r.roi)}</td><td>${pct(r.lo)} to ${pct(r.hi)}</td><td>${pct(r.clv)}</td></tr>`).join('')}</tbody></table></div>
      <small>Every 95% range includes zero: the profit is not statistically proven. Closing-line value is the steadier signal.</small></section>
    <section class="evidence"><h3>Simulated results (1 unit = 1% of bankroll, ${proof.sims.toLocaleString()} runs)</h3>
      ${worlds.map(([name, hs]) => `<h4>${esc(name)}</h4><div class="table-wrap"><table class="check-table"><thead><tr><th>Months</th><th>Chance ahead</th><th>Median</th><th>Bad case (5th pct)</th><th>Good case (95th)</th><th>Chance of 25% drawdown</th></tr></thead><tbody>
        ${Object.entries(hs).map(([h, r]) => `<tr><td>${esc(h)}</td><td>${pct(r.pProfit, 0)}</td><td>${r.median.toFixed(1)}%</td><td>${r.p5.toFixed(1)}%</td><td>${r.p95.toFixed(1)}%</td><td>${pct(r.pDrawdown25, 0)}</td></tr>`).join('')}</tbody></table></div>`).join('')}
      <small>Row A replays history. B assumes the true edge equals the closing-line value. C assumes no edge: that is what luck alone looks like (-1% to -12%).</small></section>
    <section class="evidence"><h3>Your live paper results</h3>${paper ? `
      <p>${paper.settled} settled of ${paper.logged} logged · ROI ${pct(paper.roi)} · mean closing-line value ${pct(paper.meanClv)} · beat the close on ${pct(paper.clvPositiveShare, 0)} of bets.</p>
      <p><b>Gate: ${paper.gateOpen ? 'OPEN' : 'CLOSED'}</b> (needs ${paper.gate.needSettled} settled and mean CLV ≥ ${pct(paper.gate.needClv)}).</p>` : '<p>No paper bets yet. In Price check, enter Bet365 odds, click <b>Log paper bet</b>, export, save as <code>data/paper-bets.json</code>, then run <code>node scripts/settle-paper.js</code>.</p>'}</section>`;
}
init();

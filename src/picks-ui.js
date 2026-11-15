// "Today's picks" tab: renders src/data/picks.json (written by scripts/picks.js). No betting, display only.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`);

function ageLabel(iso) {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  return h < 1 ? 'under 1 hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`;
}

function card(p, gateOpen) {
  const stake = gateOpen ? `$${p.paperStake.toFixed(2)}` : `$0 (paper $${p.paperStake.toFixed(2)})`;
  return `<article class="pick-card">
    <header><span class="pick-league">${esc(p.league)} · ${esc(p.kickoff)}</span><span class="pick-ev">+${pct(p.ev)} edge</span></header>
    <h3>${esc(p.selection)} — ${esc(p.home)} v ${esc(p.away)}</h3>
    <div class="pick-grid">
      <div><b>${p.bet365Odds.toFixed(2)}</b><small>Bet365 odds</small></div>
      <div><b>${p.minOdds.toFixed(2)}</b><small>Minimum odds to take</small></div>
      <div><b>${pct(p.fairProb)}</b><small>Fair win chance</small></div>
      <div><b>${stake}</b><small>Suggested stake</small></div>
    </div>
    <p class="pick-why">${esc(p.why)}</p>
    <small class="pick-meta">${esc(p.market)} · reference: ${esc(p.reference)}</small>
  </article>`;
}

// Safe: every dynamic string passes through esc(); the rest are numbers formatted locally.
function render(root, d) {
  const g = d.gate;
  const gateCls = g.open ? 'gate-open' : 'gate-closed';
  const prog = Math.min(100, Math.round((g.settled / g.need.settled) * 100));
  const picks = d.picks.length
    ? d.picks.map((p) => card(p, g.open)).join('')
    : `<div class="no-bet"><h2>No bet today</h2><p>${d.fixturesScanned} fixtures scanned; none cleared the edge threshold. Skipping is the correct output most days: only about 4% of matches show a price edge.</p></div>`;
  root.innerHTML = `
    <section class="gate ${gateCls}">
      <strong>${g.open ? 'Real-money gate: OPEN' : 'Real-money gate: CLOSED (paper only)'}</strong>
      <p>${esc(g.message)}</p>
      <div class="gate-bar"><span style="width:${prog}%"></span></div>
      <small>Opens after ${g.need.settled} settled paper picks with average closing-line value of at least ${pct(g.need.clv)}. Pending: ${g.pending}. Paper ROI: ${pct(g.paperRoi)}.</small>
    </section>
    <section class="picks-list">${picks}</section>
    <section class="evidence">
      <h3>What the evidence says</h3>
      <ul>
        <li>24,137 matches, six leagues, 10 seasons: betting every Bet365 outcome loses 5.3%.</li>
        <li>Price-vs-Pinnacle value rule: about +6% ROI but the 95% range spans −5% to +16%. Closing-line value is only +0.6%.</li>
        <li>A goals model built from public data lost to Pinnacle (log-loss 0.998 vs 0.981) and lost 9% when bet. It is <b>not</b> used for picks.</li>
        <li>About half of calendar months lose even when the rule works. Judge results over 6+ months, not one.</li>
      </ul>
      <small>Fixtures scanned ${esc(ageLabel(d.generatedAt))}. Source odds can be stale: before betting, confirm Bet365 still shows at least the minimum odds. Run <code>node scripts/picks.js</code> to refresh.</small>
    </section>`;
  const badge = document.getElementById('picksBadge'); if (badge) badge.textContent = String(d.picks.length);
}

async function init() {
  const root = document.getElementById('picksRoot'); if (!root) return;
  try {
    const res = await fetch('./src/data/picks.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(root, await res.json());
  } catch (e) {
    root.innerHTML = `<div class="no-bet"><h2>No picks file yet</h2><p>Run <code>node scripts/picks.js</code> to generate today's scan. (${esc(e.message)})</p></div>`;
  }
}
init();

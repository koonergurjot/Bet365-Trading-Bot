// "Price check" tab: free reference prices (Polymarket) -> minimum Bet365 odds to take. Display only; never places bets.
import { verdict, parseOdds } from './research/targets.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const us = (n) => (n > 0 ? `+${n}` : String(n));
const state = { data: null, sport: 'all', q: '', bankroll: Number(localStorage.getItem('bankroll')) || 1000, gateOpen: false };

function when(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function rowHtml(r, i) {
  return `<tr data-i="${i}">
    <td>${esc(when(r.start))}<br><small>${esc(r.league)}</small></td>
    <td><b>${esc(r.selection)}</b><br><small>${esc(r.title)}</small></td>
    <td>${(r.fairProb * 100).toFixed(1)}%<br><small>fair ${r.fairOdds.toFixed(2)} (${us(r.fairAmerican)})</small></td>
    <td class="take"><b>${r.minOdds.toFixed(2)}</b><br><small>${us(r.minAmerican)}</small></td>
    <td><span class="grade g${esc(r.grade)}" title="Reference market depth: A deep, C thin">${esc(r.grade)}</span></td>
    <td><input class="odds-in" inputmode="decimal" placeholder="e.g. 2.45 or +145" aria-label="Bet365 odds for ${esc(r.selection)}"></td>
    <td class="verdict" aria-live="polite">—</td></tr>`;
}

function draw() {
  const root = document.getElementById('checkRoot'); if (!root || !state.data) return;
  const d = state.data;
  const sports = [...new Set(d.rows.map((r) => r.league))].sort();
  const rows = d.rows.filter((r) => new Date(r.start) > new Date() && (state.sport === 'all' || r.league === state.sport) && (!state.q || (r.title + r.selection).toLowerCase().includes(state.q)));
  const v = d.validation;
  const age = Math.round((Date.now() - new Date(d.generatedAt).getTime()) / 36e5);
  // Safe: all dynamic text is escaped via esc(); numbers are formatted locally.
  root.innerHTML = `
    <section class="how"><b>How to use:</b> find the game in Bet365. If it shows odds at or above the <b>Take at</b> column, it is a value price; type the odds in the box to confirm. Below it, pass. Odds move: always check live.</section>
    <section class="filters">
      <label>Sport <select id="chkSport"><option value="all">All</option>${sports.map((s) => `<option ${s === state.sport ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label>Search <input id="chkQ" placeholder="team" value="${esc(state.q)}"></label>
      <label>Bankroll $ <input id="chkBank" type="number" min="0" value="${state.bankroll}"></label>
      <small>${rows.length} of ${d.rows.length} lines · reference refreshed ${age < 1 ? 'under 1 hour' : age + ' hours'} ago (run <code>node scripts/targets.js</code>)</small>
    </section>
    <div class="table-wrap"><table class="check-table"><thead><tr><th>Kickoff</th><th>Selection</th><th>Fair chance</th><th>Take at ≥</th><th>Grade</th><th>Bet365 shows</th><th>Verdict</th></tr></thead>
    <tbody>${rows.map((r, i) => rowHtml(r, i)).join('') || '<tr><td colspan="7">No lines match.</td></tr>'}</tbody></table></div>
    <section class="evidence"><h3>How much to trust this reference</h3><ul>
      <li>Source: Polymarket public order books. Prices are crowd probabilities with almost no margin, so fair odds are tight.</li>
      <li>${v ? `Check on ${v.games} settled games (${v.outcomes} outcomes): Brier ${v.brier.toFixed(3)}, calibration looked fair. This is a small sample, not proof it beats Bet365.` : 'No validation file yet: run node scripts/validate-polymarket.js.'}</li>
      <li>Grade A needs +2% edge, B +3%, C +5%, because thin markets are noisier. Soccer lines are mostly grade C.</li>
      <li>Bet365 limits winning accounts and shades popular sides. Real stakes stay at $0 until the paper gate on the Today's picks tab opens.</li></ul></section>`;
  const tbody = root.querySelector('tbody');
  tbody.addEventListener('input', (ev) => {
    const tr = ev.target.closest('tr'); if (!tr || !ev.target.classList.contains('odds-in')) return;
    const r = rows[Number(tr.dataset.i)]; const cell = tr.querySelector('.verdict');
    const odds = parseOdds(ev.target.value);
    if (!ev.target.value.trim()) { cell.textContent = '—'; cell.className = 'verdict'; return; }
    const res = verdict(r, odds, state.bankroll);
    cell.className = `verdict v-${res.status}`;
    const stake = res.status === 'bet' ? `<br><b>${state.gateOpen ? '$' + res.stake.toFixed(2) : 'Paper stake $' + res.stake.toFixed(2)}</b>` : '';
    cell.innerHTML = `${res.status === 'bet' ? 'BET' : res.status === 'pass' ? 'PASS' : '?'} · ${esc(res.text)}${stake}`;
  });
  root.querySelector('#chkSport').onchange = (e) => { state.sport = e.target.value; draw(); };
  root.querySelector('#chkQ').onchange = (e) => { state.q = e.target.value.toLowerCase().trim(); draw(); };
  root.querySelector('#chkBank').onchange = (e) => { state.bankroll = Math.max(0, Number(e.target.value) || 0); localStorage.setItem('bankroll', state.bankroll); draw(); };
}

async function init() {
  const root = document.getElementById('checkRoot'); if (!root) return;
  try {
    const [t, p] = await Promise.all([fetch('./src/data/targets.json', { cache: 'no-store' }), fetch('./src/data/picks.json', { cache: 'no-store' }).catch(() => null)]);
    if (!t.ok) throw new Error(`HTTP ${t.status}`);
    state.data = await t.json();
    try { state.gateOpen = !!(await p.json()).gate.open; } catch { /* gate unknown: stay closed */ }
    draw();
  } catch (e) { root.innerHTML = `<div class="no-bet"><h2>No reference prices yet</h2><p>Run <code>node scripts/targets.js</code>. (${esc(e.message)})</p></div>`; }
}
init();

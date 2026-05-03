/**
 * Bet365 Edge Brain — App v0.2
 * Tabs: Signals | Calculator | Tracker | Data
 */
import { analyzeSnapshot } from "./engine/recommendationEngine.js";
import {
  decimalToImpliedProbability,
  americanToDecimal,
  decimalToAmerican,
  expectedValue,
  kellyFraction,
  clamp
} from "./engine/oddsMath.js";

// ── State ────────────────────────────────────────────────────
let currentReport   = null;
let currentSnapshot = null;
let betLog          = [];        // in-memory bet tracker
let nextBetId       = 1;
let activeSport     = "all";
let activeRisk      = "all";
let sortKey         = "score";

// ── DOM refs ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  // topbar
  statAge:       $("statAge"),
  statMarkets:   $("statMarkets"),
  statSignals:   $("statSignals"),
  statBankroll:  $("statBankroll"),
  signalsBadge:  $("signalsBadge"),
  trackerBadge:  $("trackerBadge"),
  // signals
  signalsBody:   $("signalsBody"),
  signalsSummary:$("signalsSummary"),
  mMarkets:      $("mMarkets"),
  mCandidates:   $("mCandidates"),
  mTopEv:        $("mTopEv"),
  mAvgConf:      $("mAvgConf"),
  mTotalStake:   $("mTotalStake"),
  mAvgQuality:   $("mAvgQuality"),
  sportFilters:  $("sportFilters"),
  sortSelect:    $("sortSelect"),
  // calculator
  calcOdds:      $("calcOdds"),
  calcProb:      $("calcProb"),
  calcBankroll:  $("calcBankroll"),
  calcKellyFrac: $("calcKellyFrac"),
  calcImplied:   $("calcImplied"),
  calcYourProb:  $("calcYourProb"),
  calcEdge:      $("calcEdge"),
  calcEV:        $("calcEV"),
  calcFullKelly: $("calcFullKelly"),
  calcFracKelly: $("calcFracKelly"),
  calcStakeAmt:  $("calcStakeAmt"),
  calcReturn:    $("calcReturn"),
  calcVerdict:   $("calcVerdict"),
  calcVerdictText: $("calcVerdictText"),
  calcVerdictSub:  $("calcVerdictSub"),
  // converter
  convDecimal:   $("convDecimal"),
  convAmerican:  $("convAmerican"),
  convImplied:   $("convImplied"),
  // tracker
  tStatTotal:    $("tStatTotal"),
  tStatWon:      $("tStatWon"),
  tStatLost:     $("tStatLost"),
  tStatPending:  $("tStatPending"),
  tStatPnl:      $("tStatPnl"),
  tStatRoi:      $("tStatRoi"),
  tStatWinRate:  $("tStatWinRate"),
  tStatAvgEv:    $("tStatAvgEv"),
  trackerBody:   $("trackerBody"),
  betDesc:       $("betDesc"),
  betOdds:       $("betOdds"),
  betStake:      $("betStake"),
  betEv:         $("betEv"),
  betStatus:     $("betStatus"),
  // data
  snapshotEditor: $("snapshotEditor"),
};

// ── Boot ─────────────────────────────────────────────────────
loadSample();
bindEvents();
updateCalculator();
renderTrackerSummary();

// ── Events ───────────────────────────────────────────────────
function bindEvents() {
  // Tab switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Engine
  $("btnRun").addEventListener("click", runEngineFromEditor);
  $("btnRunFromData").addEventListener("click", runEngineFromEditor);
  $("btnReloadSample").addEventListener("click", loadSample);
  $("btnReloadSample2").addEventListener("click", loadSample);

  // Export
  $("btnExportCsv").addEventListener("click", exportSignalsCsv);

  // Sort
  els.sortSelect.addEventListener("change", () => {
    sortKey = els.sortSelect.value;
    renderSignals();
  });

  // Sport filter chips (dynamically built)
  els.sportFilters.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip[data-filter-sport]");
    if (!chip) return;
    activeSport = chip.dataset.filterSport;
    els.sportFilters.querySelectorAll(".filter-chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.filterSport === activeSport)
    );
    renderSignals();
  });

  // Risk filter chips
  $("riskFilters").addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip[data-filter-risk]");
    if (!chip) return;
    activeRisk = chip.dataset.filterRisk;
    $("riskFilters").querySelectorAll(".filter-chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.filterRisk === activeRisk)
    );
    renderSignals();
  });

  // Calculator live update
  ["calcOdds","calcProb","calcBankroll","calcKellyFrac"].forEach((id) => {
    $(id).addEventListener("input", updateCalculator);
  });

  // Odds converter — each field drives the others
  els.convDecimal.addEventListener("input",  () => syncConverterFromDecimal());
  els.convAmerican.addEventListener("input", () => syncConverterFromAmerican());
  els.convImplied.addEventListener("input",  () => syncConverterFromImplied());

  // Tracker
  $("btnAddBet").addEventListener("click", addBet);
  $("btnClearTracker").addEventListener("click", () => {
    if (confirm("Clear all recorded bets?")) { betLog = []; nextBetId = 1; renderTracker(); }
  });
  $("btnExportTracker").addEventListener("click", exportTrackerCsv);

  // JSON editor helpers
  $("btnFormatJson").addEventListener("click", () => {
    try {
      const parsed = JSON.parse(els.snapshotEditor.value);
      els.snapshotEditor.value = JSON.stringify(parsed, null, 2);
    } catch { /* ignore */ }
  });
}

// ── Tab switching ────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.setAttribute("aria-selected", b.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-content").forEach((s) => {
    s.classList.toggle("active", s.id === `tab-${tab}`);
  });
}

// ── Sample data ──────────────────────────────────────────────
async function loadSample() {
  try {
    const res = await fetch("./src/data/sample-markets.json", { cache: "no-store" });
    const snapshot = await res.json();
    els.snapshotEditor.value = JSON.stringify(snapshot, null, 2);
    runEngine(snapshot);
  } catch (err) {
    els.signalsSummary.textContent = `Failed to load sample: ${err.message}`;
  }
}

// ── Run engine ───────────────────────────────────────────────
function runEngineFromEditor() {
  try {
    const snapshot = JSON.parse(els.snapshotEditor.value);
    runEngine(snapshot);
    switchTab("signals");
  } catch (err) {
    els.signalsSummary.textContent = `JSON error: ${err.message}`;
  }
}

function readEngineConfig() {
  // Derive bankroll from topbar bankroll display (or default)
  const banStr = els.statBankroll.textContent.replace(/[^0-9.]/g, "");
  return {
    bankroll: parseFloat(banStr) || 1000,
    minExpectedValue: 0.03,
    minConfidence:    0.55,
    maxBankrollStake: 0.02,
    fractionalKelly:  0.25,
  };
}

function runEngine(snapshot) {
  try {
    currentSnapshot = snapshot;
    const report = analyzeSnapshot(snapshot, readEngineConfig());
    currentReport = report;

    // Build sport filter chips
    buildSportFilters(report.recommendations);
    renderMetrics(report);
    renderSignals();
    updateTopbarStats(report, snapshot);
  } catch (err) {
    els.signalsSummary.textContent = `Engine error: ${err.message}`;
    console.error(err);
  }
}

// ── Metrics ──────────────────────────────────────────────────
function renderMetrics(report) {
  const recs = report.recommendations;
  els.mMarkets.textContent    = report.totalMarkets;
  els.mCandidates.textContent = recs.length;
  els.mTopEv.textContent      = recs.length > 0 ? `+${pct(recs[0].expectedValue)}` : "—";
  els.mAvgConf.textContent    = recs.length > 0 ? pct(avg(recs.map(r => r.confidence))) : "—";
  els.mTotalStake.textContent = recs.length > 0 ? `$${recs.reduce((s,r) => s + r.stakeAmount, 0).toFixed(0)}` : "—";
  els.mAvgQuality.textContent = recs.length > 0 ? pct(avg(recs.map(r => r.dataQuality))) : "—";
}

function updateTopbarStats(report, snapshot) {
  els.statMarkets.textContent  = report.totalMarkets;
  els.statSignals.textContent  = report.recommendations.length;
  els.signalsBadge.textContent = report.recommendations.length;
  const age = snapshot?.snapshotAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(snapshot.snapshotAt)) / 60000))
    : null;
  els.statAge.textContent = age === null ? "—" : age <= 1 ? "fresh" : `${age}m ago`;
}

// ── Sport filters ─────────────────────────────────────────────
function buildSportFilters(recs) {
  const sports = ["all", ...new Set(recs.map(r => r.sport).filter(Boolean))];
  els.sportFilters.innerHTML = sports.map(s =>
    `<button class="filter-chip ${activeSport === s ? "active" : ""}" data-filter-sport="${s}">
      ${sportEmoji(s)} ${capitalize(s)}
    </button>`
  ).join("");
}

// ── Render signals ────────────────────────────────────────────
function renderSignals() {
  if (!currentReport) return;

  let recs = [...currentReport.recommendations];

  // Sport filter
  if (activeSport !== "all") {
    recs = recs.filter(r => r.sport === activeSport);
  }
  // Risk filter
  if (activeRisk !== "all") {
    recs = recs.filter(r => r.risk.label === activeRisk);
  }
  // Sort
  recs.sort((a, b) => {
    if (sortKey === "ev")         return b.expectedValue - a.expectedValue;
    if (sortKey === "confidence") return b.confidence - a.confidence;
    if (sortKey === "stake")      return b.stakeAmount - a.stakeAmount;
    return b.score - a.score;
  });

  els.signalsSummary.textContent = `${recs.length} of ${currentReport.recommendations.length} signals shown`;

  if (recs.length === 0) {
    els.signalsBody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">No signals match your filters</div>
          <div class="empty-sub">Try relaxing the sport or risk filters</div>
        </div>
      </td></tr>`;
    return;
  }

  els.signalsBody.innerHTML = recs.map((rec, idx) => {
    const evPct      = (rec.expectedValue * 100).toFixed(1);
    const evClass    = rec.expectedValue >= 0.08 ? "pill-green" : rec.expectedValue >= 0.03 ? "pill-amber" : "pill-gray";
    const riskClass  = { Low: "pill-green", Medium: "pill-amber", High: "pill-red" }[rec.risk.label] || "pill-gray";
    const qLevel     = rec.dataQuality >= 0.8 ? "high" : rec.dataQuality >= 0.6 ? "medium" : "low";
    const evBarWidth = Math.min(100, rec.expectedValue * 500);
    const commenceStr = rec.commenceTime
      ? new Date(rec.commenceTime).toLocaleString(undefined, { weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })
      : "";

    return `
    <tr data-rec-idx="${idx}">
      <td>
        <div class="td-primary">${esc(rec.selection)}</div>
        <div class="td-secondary">${sportEmoji(rec.sport)} ${esc(rec.event)}</div>
        <div class="td-muted">${esc(rec.league)} · ${esc(rec.marketType)}${commenceStr ? ` · ${commenceStr}` : ""}</div>
        ${rec.notes.length ? `<div class="td-muted" style="color:var(--amber)">${rec.notes.map(esc).join(", ")}</div>` : ""}
      </td>
      <td class="right">
        <div class="font-mono font-bold">${rec.bet365Decimal.toFixed(2)}</div>
        <div class="td-muted">${pct(rec.bet365ImpliedProbability)} implied</div>
      </td>
      <td class="right">
        <div class="font-mono font-bold">${rec.fairDecimal.toFixed(2)}</div>
        <div class="td-muted">${pct(rec.modelProbability)} model</div>
      </td>
      <td class="right">
        <div class="ev-bar-wrap" style="justify-content:flex-end">
          <div class="ev-bar"><div class="ev-bar-fill" style="width:${evBarWidth}%"></div></div>
          <span class="pill ${evClass}">+${evPct}%</span>
        </div>
      </td>
      <td class="right">
        <div class="font-mono font-bold">$${rec.stakeAmount.toFixed(2)}</div>
        <div class="td-muted">${pct(rec.stakeFraction)} bankroll</div>
      </td>
      <td class="center"><span class="pill ${riskClass}">${rec.risk.label}</span></td>
      <td class="right">
        <div class="quality-bar-wrap" style="justify-content:flex-end">
          <div class="quality-bar"><div class="quality-bar-fill ${qLevel}" style="width:${(rec.dataQuality*100).toFixed(0)}%"></div></div>
          <span>${pct(rec.dataQuality)}</span>
        </div>
        <div class="td-muted">${rec.peerBookCount} peers${rec.staleBookCount > 0 ? `, ${rec.staleBookCount} stale` : ""}</div>
      </td>
      <td class="center">
        <button class="btn btn-sm btn-green" onclick="window.trackSignal(${idx})" title="Record this bet in Tracker">Track</button>
      </td>
    </tr>`;
  }).join("");
}

// Called from table button
window.trackSignal = function(recIdx) {
  if (!currentReport) return;
  const recs = currentReport.recommendations;
  const rec  = recs[recIdx < recs.length ? recIdx : 0];
  if (!rec) return;
  els.betDesc.value  = `${rec.selection} — ${rec.event}`;
  els.betOdds.value  = rec.bet365Decimal.toFixed(2);
  els.betStake.value = rec.stakeAmount.toFixed(2);
  els.betEv.value    = rec.expectedValue.toFixed(4);
  els.betStatus.value = "pending";
  switchTab("tracker");
};

// ── Probability Calculator ────────────────────────────────────
function updateCalculator() {
  const odds   = parseFloat(els.calcOdds.value);
  const probPct = parseFloat(els.calcProb.value);
  const br     = parseFloat(els.calcBankroll.value);
  const kf     = parseFloat(els.calcKellyFrac.value);

  if (!isFinite(odds) || odds <= 1 || !isFinite(probPct) || probPct <= 0 || probPct >= 100) return;

  const myProb  = probPct / 100;
  const implied = decimalToImpliedProbability(odds);
  const edge    = myProb - implied;
  const ev      = expectedValue(myProb, odds);
  const fk      = kellyFraction(myProb, odds);
  const fractK  = clamp(fk * kf, 0, 0.1);
  const stakeAmt = isFinite(br) ? br * fractK : 0;
  const ret     = stakeAmt * odds;

  els.calcImplied.textContent   = `${pct(implied)} (${odds.toFixed(2)}x)`;
  els.calcYourProb.textContent  = `${probPct.toFixed(1)}%`;
  els.calcEdge.textContent      = `${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(2)}%`;
  els.calcEdge.style.color      = edge >= 0 ? "var(--green)" : "var(--red)";
  els.calcEV.textContent        = `${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(2)}¢ per $1`;
  els.calcEV.style.color        = ev >= 0 ? "var(--green)" : "var(--red)";
  els.calcFullKelly.textContent = `${(fk * 100).toFixed(2)}%`;
  els.calcFracKelly.textContent = `${(fractK * 100).toFixed(2)}% (${(kf*100).toFixed(0)}% Kelly)`;
  els.calcStakeAmt.textContent  = isFinite(br) ? `$${stakeAmt.toFixed(2)}` : "—";
  els.calcReturn.textContent    = isFinite(br) ? `$${ret.toFixed(2)} (profit: $${(ret - stakeAmt).toFixed(2)})` : "—";

  // Verdict
  const verdict = els.calcVerdict;
  verdict.className = `verdict-box ${ev >= 0.05 ? "positive" : ev >= 0 ? "neutral" : "negative"}`;

  if (ev >= 0.10) {
    els.calcVerdictText.textContent = "🔥 Strong Edge";
    els.calcVerdictSub.textContent  = `+${(ev*100).toFixed(1)}% EV — high-confidence value bet if data is solid`;
  } else if (ev >= 0.05) {
    els.calcVerdictText.textContent = "✅ Positive Edge";
    els.calcVerdictSub.textContent  = `+${(ev*100).toFixed(1)}% EV — worth considering, check data quality`;
  } else if (ev >= 0) {
    els.calcVerdictText.textContent = "🟡 Marginal Edge";
    els.calcVerdictSub.textContent  = `+${(ev*100).toFixed(1)}% EV — thin edge, model confidence matters here`;
  } else {
    els.calcVerdictText.textContent = "❌ No Edge";
    els.calcVerdictSub.textContent  = `${(ev*100).toFixed(1)}% EV — negative expected value, avoid`;
  }
}

// ── Odds Converter ────────────────────────────────────────────
let _convUpdating = false;

function syncConverterFromDecimal() {
  if (_convUpdating) return; _convUpdating = true;
  try {
    const d = parseFloat(els.convDecimal.value);
    if (isFinite(d) && d > 1) {
      els.convAmerican.value = decimalToAmerican(d);
      els.convImplied.value  = (decimalToImpliedProbability(d) * 100).toFixed(2);
    }
  } finally { _convUpdating = false; }
}

function syncConverterFromAmerican() {
  if (_convUpdating) return; _convUpdating = true;
  try {
    const a = parseFloat(els.convAmerican.value);
    if (isFinite(a) && a !== 0) {
      const d = americanToDecimal(a);
      els.convDecimal.value  = d.toFixed(3);
      els.convImplied.value  = (decimalToImpliedProbability(d) * 100).toFixed(2);
    }
  } finally { _convUpdating = false; }
}

function syncConverterFromImplied() {
  if (_convUpdating) return; _convUpdating = true;
  try {
    const i = parseFloat(els.convImplied.value) / 100;
    if (isFinite(i) && i > 0 && i < 1) {
      const d = 1 / i;
      els.convDecimal.value  = d.toFixed(3);
      els.convAmerican.value = decimalToAmerican(d);
    }
  } finally { _convUpdating = false; }
}

// ── Bet Tracker ───────────────────────────────────────────────
function addBet() {
  const desc   = els.betDesc.value.trim();
  const odds   = parseFloat(els.betOdds.value);
  const stake  = parseFloat(els.betStake.value);
  const evVal  = parseFloat(els.betEv.value);
  const status = els.betStatus.value;

  if (!desc) { alert("Please enter a selection / event description."); return; }
  if (!isFinite(odds) || odds <= 1) { alert("Enter valid decimal odds (> 1.0)."); return; }
  if (!isFinite(stake) || stake <= 0) { alert("Enter a valid stake."); return; }

  betLog.push({
    id:      nextBetId++,
    desc,
    odds,
    stake,
    ev:      isFinite(evVal) ? evVal : null,
    status,
    addedAt: new Date().toISOString()
  });

  els.betDesc.value  = "";
  renderTracker();
}

window.updateBetStatus = function(id, status) {
  const bet = betLog.find(b => b.id === id);
  if (bet) { bet.status = status; renderTracker(); }
};

window.removeBet = function(id) {
  betLog = betLog.filter(b => b.id !== id);
  renderTracker();
};

function renderTracker() {
  renderTrackerSummary();
  els.trackerBadge.textContent = betLog.length;

  if (betLog.length === 0) {
    els.trackerBody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-title">No bets recorded</div>
          <div class="empty-sub">Add a bet above or click "Track" on a signal</div>
        </div>
      </td></tr>`;
    return;
  }

  els.trackerBody.innerHTML = [...betLog].reverse().map((bet) => {
    const pnl  = calcPnl(bet);
    const pnlStr = pnl === null ? "—" : (pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`);
    const pnlCol = pnl === null ? "" : pnl >= 0 ? "color:var(--green)" : "color:var(--red)";
    const statusPill = {
      pending: "pill-amber",
      won:     "pill-green",
      lost:    "pill-red",
      void:    "pill-gray",
    }[bet.status] || "pill-gray";

    return `
    <tr>
      <td class="td-muted">#${bet.id}</td>
      <td>
        <div class="td-primary">${esc(bet.desc)}</div>
        <div class="td-muted">${new Date(bet.addedAt).toLocaleDateString()}</div>
      </td>
      <td class="right font-mono">${bet.odds.toFixed(2)}</td>
      <td class="right font-mono">$${bet.stake.toFixed(2)}</td>
      <td class="right font-mono font-bold" style="${pnlCol}">${pnlStr}</td>
      <td class="right text-muted">${bet.ev !== null ? `+${(bet.ev*100).toFixed(1)}%` : "—"}</td>
      <td class="center">
        <select class="filter-select" style="font-size:12px;padding:2px 6px" onchange="window.updateBetStatus(${bet.id}, this.value)">
          <option value="pending" ${bet.status==="pending" ? "selected" : ""}>⏳ Pending</option>
          <option value="won"     ${bet.status==="won"     ? "selected" : ""}>✅ Won</option>
          <option value="lost"    ${bet.status==="lost"    ? "selected" : ""}>❌ Lost</option>
          <option value="void"    ${bet.status==="void"    ? "selected" : ""}>◌ Void</option>
        </select>
      </td>
      <td class="center">
        <button class="btn btn-sm btn-red" onclick="window.removeBet(${bet.id})">✕</button>
      </td>
    </tr>`;
  }).join("");
}

function calcPnl(bet) {
  if (bet.status === "won")  return bet.stake * (bet.odds - 1);
  if (bet.status === "lost") return -bet.stake;
  if (bet.status === "void") return 0;
  return null; // pending
}

function renderTrackerSummary() {
  const total    = betLog.length;
  const won      = betLog.filter(b => b.status === "won").length;
  const lost     = betLog.filter(b => b.status === "lost").length;
  const pending  = betLog.filter(b => b.status === "pending").length;
  const settled  = betLog.filter(b => b.status !== "pending" && b.status !== "void");
  const totalStaked = betLog.reduce((s, b) => s + b.stake, 0);
  const pnl      = betLog.reduce((s, b) => s + (calcPnl(b) ?? 0), 0);
  const winRate  = settled.length > 0 ? won / settled.length : null;
  const evs      = betLog.filter(b => b.ev !== null).map(b => b.ev);
  const avgEv    = evs.length > 0 ? avg(evs) : null;
  const roi      = totalStaked > 0 ? pnl / totalStaked : null;

  els.tStatTotal.textContent   = total;
  els.tStatWon.textContent     = won;
  els.tStatLost.textContent    = lost;
  els.tStatPending.textContent = pending;
  els.tStatPnl.textContent     = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
  els.tStatPnl.style.color     = pnl >= 0 ? "var(--green)" : "var(--red)";
  els.tStatRoi.textContent     = roi !== null ? `${roi >= 0 ? "+" : ""}${(roi*100).toFixed(1)}%` : "—";
  els.tStatRoi.style.color     = roi !== null && roi >= 0 ? "var(--green)" : "var(--red)";
  els.tStatWinRate.textContent = winRate !== null ? `${(winRate*100).toFixed(0)}%` : "—";
  els.tStatAvgEv.textContent   = avgEv !== null ? `+${(avgEv*100).toFixed(1)}%` : "—";
}

// ── CSV Export ────────────────────────────────────────────────
function exportSignalsCsv() {
  if (!currentReport?.recommendations?.length) return;
  const rows = [
    ["Selection","Event","League","Sport","MarketType","Bet365Odds","FairDecimal","ModelProb","EV","Confidence","Stake","RiskLabel","DataQuality","PeerBooks"]
  ];
  currentReport.recommendations.forEach((r) => {
    rows.push([r.selection, r.event, r.league, r.sport, r.marketType,
      r.bet365Decimal, r.fairDecimal, r.modelProbability, r.expectedValue,
      r.confidence, r.stakeAmount, r.risk.label, r.dataQuality, r.peerBookCount]);
  });
  downloadCsv(rows, "edge-signals.csv");
}

function exportTrackerCsv() {
  if (!betLog.length) return;
  const rows = [["ID","Description","Odds","Stake","EV","Status","PnL","AddedAt"]];
  betLog.forEach((b) => {
    rows.push([b.id, b.desc, b.odds, b.stake, b.ev ?? "", b.status, calcPnl(b) ?? "", b.addedAt]);
  });
  downloadCsv(rows, "bet-tracker.csv");
}

function downloadCsv(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────
function pct(v)        { return `${(v * 100).toFixed(1)}%`; }
function avg(arr)      { return arr.reduce((s,v) => s+v, 0) / arr.length; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function esc(v)        {
  return String(v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function sportEmoji(sport) {
  const map = {
    basketball: "🏀", soccer: "⚽", football: "🏈",
    tennis: "🎾", cricket: "🏏", baseball: "⚾",
    hockey: "🏒", golf: "⛳", rugby: "🏉", mma: "🥊",
    boxing: "🥊", esports: "🎮"
  };
  return map[String(sport).toLowerCase()] ?? "🎯";
}

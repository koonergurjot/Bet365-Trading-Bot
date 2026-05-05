/**
 * Bet365 Edge Brain — App v0.3
 * Tabs: Signals | Calculator | Tracker | Data
 * Live data wired: The Odds API + OddsBlaze + TheSportsDB
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
import * as liveData from "./data/liveDataManager.js";

// ── State ────────────────────────────────────────────────────
let currentReport   = null;
let currentSnapshot = null;
let betLog          = [];        // persisted to localStorage
let nextBetId       = 1;
let activeSport     = "all";
let activeRisk      = "all";
let sortKey         = "score";
let isLiveMode      = false;     // true once live data has been loaded
let pendingTrackedSignal = null;
let currentVisibleRecommendations = [];

// ── Restore bet tracker from localStorage ────────────────────
try {
  const saved = localStorage.getItem("betLog");
  if (saved) {
    betLog    = JSON.parse(saved);
    nextBetId = betLog.length > 0 ? Math.max(...betLog.map((b) => b.id)) + 1 : 1;
  }
} catch { /* ignore corrupt storage */ }

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
  diagSummary:   $("diagSummary"),
  diagAccepted:  $("diagAccepted"),
  diagRejected:  $("diagRejected"),
  diagMissingBet365: $("diagMissingBet365"),
  diagNoModel:   $("diagNoModel"),
  diagReasons:   $("diagReasons"),
  portfolioSummary: $("portfolioSummary"),
  pPlannedStake: $("pPlannedStake"),
  pBudgetUsed:   $("pBudgetUsed"),
  pActiveSignals:$("pActiveSignals"),
  pReducedStake: $("pReducedStake"),
  portfolioReasons: $("portfolioReasons"),
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
  // live
  btnFetchLive:    $("btnFetchLive"),
  btnFetchLive2:   $("btnFetchLive2"),
  btnTogglePoll:   $("btnTogglePoll"),
  btnTogglePoll2:  $("btnTogglePoll2"),
  chipQuota:       $("chipQuota"),
  statQuota:       $("statQuota"),
  statLiveStatus:  $("statLiveStatus"),
  chipLiveStatus:  $("chipLiveStatus"),
  liveStatusBar:   $("liveStatusBar"),
  liveStatusMsg:   $("liveStatusMsg"),
  sampleDisclaimer:$("sampleDisclaimer"),
  dataStatQuota:   $("dataStatQuota"),
  dataStatLastFetch: $("dataStatLastFetch"),
  dataStatMarkets:   $("dataStatMarkets"),
  dataStatPolling:   $("dataStatPolling"),
  dataStatSource:    $("dataStatSource"),
  dataStatFetchesLeft: $("dataStatFetchesLeft"),
};

// ── Boot ─────────────────────────────────────────────────────
bindEvents();
updateCalculator();
renderTracker();
boot();

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
    if (confirm("Clear all recorded bets?")) { betLog = []; nextBetId = 1; persistBetLog(); renderTracker(); }
  });
  $("btnExportTracker").addEventListener("click", exportTrackerCsv);

  // JSON editor helpers
  $("btnFormatJson").addEventListener("click", () => {
    try {
      const parsed = JSON.parse(els.snapshotEditor.value);
      els.snapshotEditor.value = JSON.stringify(parsed, null, 2);
    } catch { /* ignore */ }
  });

  // ── Live data ─────────────────────────────────────────────
  els.btnFetchLive.addEventListener("click",   fetchAndRunLive);
  els.btnFetchLive2.addEventListener("click",  fetchAndRunLive);
  els.btnTogglePoll.addEventListener("click",  togglePolling);
  els.btnTogglePoll2.addEventListener("click", togglePolling);
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

async function boot() {
  const cachedSnapshot = liveData.restoreCachedSnapshot();
  if (cachedSnapshot) {
    isLiveMode = true;
    els.snapshotEditor.value = JSON.stringify(cachedSnapshot, null, 2);
    runEngine(cachedSnapshot);
    showToast("Loaded cached snapshot from local storage", "info");
  } else {
    await loadSample();
  }
  updateLiveStatus();
}

// ── Sample data ──────────────────────────────────────────────
async function loadSample() {
  try {
    const res = await fetch("./src/data/sample-markets.json", { cache: "no-store" });
    const snapshot = await res.json();
    isLiveMode = false;
    els.snapshotEditor.value = JSON.stringify(snapshot, null, 2);
    runEngine(snapshot);
    updateLiveStatus();
  } catch (err) {
    els.signalsSummary.textContent = `Failed to load sample: ${err.message}`;
  }
}

// ── Live data fetch ───────────────────────────────────────────
function applyLiveSnapshot(snapshot, { switchToSignals = false, notify = true } = {}) {
  els.snapshotEditor.value = JSON.stringify(snapshot, null, 2);
  const report = runEngine(snapshot);
  isLiveMode = true;
  updateLiveStatus();
  if (switchToSignals) {
    switchTab("signals");
  }
  if (report && notify) {
    maybeNotifySignals(report);
  }
  return report;
}

async function fetchAndRunLive() {
  const btns = [els.btnFetchLive, els.btnFetchLive2];
  btns.forEach((b) => { if (b) { b.disabled = true; b.textContent = "Fetching..."; } });
  showToast("Fetching live odds across all sports...", "info");

  try {
    const snapshot = await liveData.fetchLiveSnapshot();
    applyLiveSnapshot(snapshot, { switchToSignals: true });

    const status = liveData.getFullStatus();
    showToast(
      `Live data loaded: ${snapshot.markets.length} markets, ${status.quota.remaining ?? "?"} requests left`,
      "success"
    );
  } catch (err) {
    const fallback = liveData.getLastSnapshot() ?? liveData.restoreCachedSnapshot();
    if (fallback) {
      applyLiveSnapshot(fallback, { switchToSignals: true, notify: false });
      showToast(`Live fetch failed, showing cached snapshot: ${err.message}`, "info");
    } else {
      showToast(`Live fetch failed: ${err.message}`, "error");
    }
    console.error("[App] fetchAndRunLive:", err);
    updateLiveStatus();
  } finally {
    btns.forEach((b) => {
      if (b) { b.disabled = false; b.textContent = "Fetch Live"; }
    });
  }
}

function togglePolling() {
  if (liveData.isPolling()) {
    liveData.stopPolling();
    showToast("Auto-refresh stopped", "info");
  } else {
    const status = liveData.getFullStatus();
    liveData.startPolling(
      (snapshot) => {
        applyLiveSnapshot(snapshot);
        showToast(`Auto-refreshed: ${snapshot.markets.length} markets`, "info");
      },
      undefined,
      (safety) => {
        showToast(safety.message, safety.level === "warn" ? "info" : "error");
      }
    );
    showToast(`Auto-refresh started (${status.pollingIntervalLabel})`, "success");
  }
  updateLiveStatus();
}

function updateLiveStatus() {
  const status = liveData.getFullStatus();
  const polling = status.isPolling;

  if (els.statQuota) {
    els.statQuota.textContent = status.quota.remaining !== null
      ? status.quota.remaining.toLocaleString()
      : "-";
  }
  if (els.chipQuota) {
    els.chipQuota.className = `stat-chip${status.quota.level === "warn" ? " warn" : status.quota.level === "stop" ? " live-error" : ""}`;
    els.chipQuota.title = status.quota.remaining === null
      ? "Odds API quota unknown"
      : `${status.quota.remaining}/${status.quota.monthly} requests remaining (${status.quota.estFetchesLeft ?? 0} safe fetches left)`;
  }

  if (polling) {
    els.statLiveStatus.textContent = "polling";
    els.chipLiveStatus.className = "stat-chip live-polling";
  } else if (status.isCached) {
    els.statLiveStatus.textContent = "cached";
    els.chipLiveStatus.className = "stat-chip warn";
  } else if (isLiveMode) {
    els.statLiveStatus.textContent = status.snapshotAge ?? status.lastFetchAge ?? "loaded";
    els.chipLiveStatus.className = "stat-chip live-active";
  } else {
    els.statLiveStatus.textContent = "off";
    els.chipLiveStatus.className = "stat-chip live-off";
  }

  const pollLabel = polling ? "Auto ON" : "Auto";
  [els.btnTogglePoll, els.btnTogglePoll2].forEach((b) => {
    if (!b) return;
    b.textContent = pollLabel;
    b.classList.toggle("btn-green", polling);
    b.classList.toggle("btn-secondary", !polling);
  });

  if (isLiveMode) {
    if (els.liveStatusBar) { els.liveStatusBar.style.display = ""; }
    if (els.sampleDisclaimer) { els.sampleDisclaimer.style.display = "none"; }
    if (els.liveStatusMsg) {
      els.liveStatusMsg.textContent = liveData.getStatusSummary();
    }
  } else {
    if (els.liveStatusBar) { els.liveStatusBar.style.display = "none"; }
    if (els.sampleDisclaimer) { els.sampleDisclaimer.style.display = ""; }
  }

  if (els.dataStatQuota) {
    els.dataStatQuota.textContent = status.quota.remaining !== null
      ? status.quota.remaining.toLocaleString()
      : "-";
  }
  if (els.dataStatLastFetch) {
    els.dataStatLastFetch.textContent = status.snapshotAge ?? status.lastFetchAge ?? "-";
    els.dataStatLastFetch.title = status.snapshotDisplay ?? status.lastFetchDisplay ?? "No live fetch yet";
  }
  if (els.dataStatMarkets) {
    els.dataStatMarkets.textContent = status.markets ? status.markets.toLocaleString() : "-";
  }
  if (els.dataStatPolling) {
    els.dataStatPolling.textContent = polling ? "ON" : "OFF";
    els.dataStatPolling.style.color = polling ? "var(--green)" : "var(--text-muted)";
    els.dataStatPolling.title = `Default cadence: ${status.pollingIntervalLabel}`;
  }
  if (els.dataStatSource) {
    els.dataStatSource.textContent = isLiveMode ? (status.isCached ? "Cached" : "Live") : "Sample";
  }
  if (els.dataStatFetchesLeft) {
    els.dataStatFetchesLeft.textContent = status.quota.estFetchesLeft ?? "-";
  }
}

function showToast(message, type = "info") {
  const container = $("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity .3s";
    setTimeout(() => toast.remove(), 300);
  }, type === "error" ? 6000 : 3500);
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
  const baseConfig = {
    bankroll: parseFloat(banStr) || 1000,
    minExpectedValue: 0.03,
    minConfidence:    0.55,
    maxBankrollStake: 0.02,
    fractionalKelly:  0.25,
    dynamicThresholds: true,
  };
  return liveData.getAdaptiveEngineConfig(baseConfig);
}

function runEngine(snapshot) {
  try {
    currentSnapshot = snapshot;
    const report = analyzeSnapshot(snapshot, readEngineConfig());
    const shouldRegisterLearning = isLiveMode || snapshot?.provider !== "manual-sample";
    if (shouldRegisterLearning) {
      liveData.registerSignalReport(report, snapshot, { persist: isLiveMode });
    }
    currentReport = report;

    // Build sport filter chips
    buildSportFilters(report.recommendations);
    renderMetrics(report);
    renderDiagnostics(report);
    renderPortfolio(report);
    renderSignals();
    updateTopbarStats(report, snapshot);
    return report;
  } catch (err) {
    els.signalsSummary.textContent = `Engine error: ${err.message}`;
    console.error(err);
    return null;
  }
}

// ── Metrics ──────────────────────────────────────────────────
function renderMetrics(report) {
  const recs = report.recommendations;
  els.mMarkets.textContent    = report.totalMarkets;
  els.mCandidates.textContent = report.totalCandidates;
  els.mTopEv.textContent      = recs.length > 0 ? `+${pct(recs[0].expectedValue)}` : "—";
  els.mAvgConf.textContent    = recs.length > 0 ? pct(avg(recs.map(r => r.confidence))) : "—";
  els.mTotalStake.textContent = recs.length > 0 ? `$${recs.reduce((s,r) => s + r.stakeAmount, 0).toFixed(0)}` : "—";
  els.mAvgQuality.textContent = recs.length > 0 ? pct(avg(recs.map(r => r.dataQuality))) : "—";
}

function renderPortfolio(report) {
  const portfolio = report.portfolioSummary;
  if (!portfolio) return;

  const capPct = pct(portfolio.caps?.maxTotalExposure ?? 0);
  const plannedPct = pct(portfolio.plannedExposureFraction ?? 0);
  const topEvent = portfolio.topEventExposures?.[0];
  const eventPart = topEvent
    ? ` Top event: ${shortExposureKey(topEvent.key)} at ${pct(topEvent.fraction)}.`
    : "";

  if (els.portfolioSummary) {
    els.portfolioSummary.textContent = `${portfolio.activeCount} active, ${portfolio.watchlistCount} watchlist. Planned ${plannedPct} of bankroll vs ${capPct} cap.${eventPart}`;
  }
  if (els.pPlannedStake) {
    els.pPlannedStake.textContent = `$${portfolio.plannedStakeAmount.toFixed(2)}`;
  }
  if (els.pBudgetUsed) {
    els.pBudgetUsed.textContent = plannedPct;
    els.pBudgetUsed.style.color = portfolio.plannedExposureFraction >= (portfolio.caps?.maxTotalExposure ?? 1) * 0.9
      ? "var(--amber)"
      : "var(--green)";
  }
  if (els.pActiveSignals) {
    els.pActiveSignals.textContent = `${portfolio.activeCount}`;
  }
  if (els.pReducedStake) {
    els.pReducedStake.textContent = `$${portfolio.reducedStakeAmount.toFixed(2)}`;
  }
  if (els.portfolioReasons) {
    const chips = [
      `<span class="pill pill-blue">Total cap ${pct(portfolio.caps.maxTotalExposure)}</span>`,
      `<span class="pill pill-blue">Event cap ${pct(portfolio.caps.maxEventExposure)}</span>`,
      `<span class="pill pill-blue">Sport cap ${pct(portfolio.caps.maxSportExposure)}</span>`,
      portfolio.reducedCount > 0 ? `<span class="pill pill-amber">${portfolio.reducedCount} reduced</span>` : "",
      portfolio.watchlistCount > 0 ? `<span class="pill pill-gray">${portfolio.watchlistCount} watchlist</span>` : "",
    ].filter(Boolean);
    els.portfolioReasons.innerHTML = chips.join("");
  }
}

function renderDiagnostics(report) {
  const diagnostics = report.diagnostics ?? {};
  const learningSummary = liveData.getLearningSummary?.() ?? null;
  const reasonPills = (diagnostics.topReasons ?? []).map(({ code, count }) =>
    `<span class="pill pill-gray">${esc(prettyReason(code))}: ${count}</span>`
  ).join("");

  if (els.diagSummary) {
    const learningPart = learningSummary?.closedSamples
      ? ` · CLV ${pct(learningSummary.avgClv ?? 0)} on ${learningSummary.closedSamples} closes`
      : "";
    els.diagSummary.textContent = `${diagnostics.acceptedSelections ?? 0} accepted, ${diagnostics.rejectedSelections ?? 0} blocked${learningPart}`;
  }
  if (els.diagAccepted) {
    els.diagAccepted.textContent = `${diagnostics.acceptedSelections ?? 0}`;
  }
  if (els.diagRejected) {
    els.diagRejected.textContent = `${diagnostics.rejectedSelections ?? 0}`;
  }
  if (els.diagMissingBet365) {
    els.diagMissingBet365.textContent = `${diagnostics.marketsMissingBet365 ?? 0}`;
  }
  if (els.diagNoModel) {
    els.diagNoModel.textContent = `${diagnostics.reasonCounts?.no_reliable_model ?? 0}`;
  }
  if (els.diagReasons) {
    els.diagReasons.innerHTML = reasonPills || `<span class="pill pill-green">No blocking reasons detected</span>`;
  }
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
  currentVisibleRecommendations = recs;

  els.signalsSummary.textContent = `${recs.length} of ${currentReport.recommendations.length} signals shown`;

  if (recs.length === 0) {
    const topReason = currentReport.diagnostics?.topReasons?.[0];
    els.signalsBody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">No signals match your filters</div>
          <div class="empty-sub">${topReason ? `Most common blocker: ${esc(prettyReason(topReason.code))}` : "Try relaxing the sport or risk filters"}</div>
        </div>
      </td></tr>`;
    return;
  }

  els.signalsBody.innerHTML = recs.map((rec, idx) => {
    const evPct      = (rec.expectedValue * 100).toFixed(1);
    const evClass    = rec.expectedValue >= 0.08 ? "pill-green" : rec.expectedValue >= 0.03 ? "pill-amber" : "pill-gray";
    const riskClass  = { Low: "pill-green", Medium: "pill-amber", High: "pill-red" }[rec.risk.label] || "pill-gray";
    const portfolioClass = { active: "pill-green", reduced: "pill-amber", watchlist: "pill-gray" }[rec.portfolio?.status] || "pill-gray";
    const portfolioLabel = rec.portfolio?.status === "watchlist" ? "Watch" : rec.portfolio?.status === "reduced" ? "Reduced" : "Active";
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
        <div class="td-muted">${pct(rec.stakeFraction)} bankroll${rec.unadjustedStakeAmount > rec.stakeAmount ? ` from $${rec.unadjustedStakeAmount.toFixed(2)}` : ""}</div>
        <div class="mt-3"><span class="pill ${portfolioClass}">${portfolioLabel}</span></div>
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
        <button class="btn btn-sm ${rec.stakeAmount > 0 ? "btn-green" : "btn-secondary"}" onclick="window.trackSignal(${idx})" title="${rec.stakeAmount > 0 ? "Record this bet in Tracker" : "Portfolio cap reached; review before tracking"}">Track</button>
      </td>
    </tr>`;
  }).join("");
}

// Called from table button
window.trackSignal = function(recIdx) {
  if (!currentReport) return;
  const recs = currentVisibleRecommendations.length ? currentVisibleRecommendations : currentReport.recommendations;
  const rec  = recs[recIdx < recs.length ? recIdx : 0];
  if (!rec) return;
  pendingTrackedSignal = rec;
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
    addedAt: new Date().toISOString(),
    signalId: pendingTrackedSignal?.id ?? null,
    signalSelection: pendingTrackedSignal?.selection ?? null,
    signalEvent: pendingTrackedSignal?.event ?? null,
  });

  els.betDesc.value  = "";
  pendingTrackedSignal = null;
  persistBetLog();
  renderTracker();
}

window.updateBetStatus = function(id, status) {
  const bet = betLog.find(b => b.id === id);
  if (bet) { bet.status = status; persistBetLog(); renderTracker(); }
};

window.removeBet = function(id) {
  betLog = betLog.filter(b => b.id !== id);
  persistBetLog();
  renderTracker();
};

function renderTracker() {
  liveData.syncTrackedBets(betLog, { persist: isLiveMode || betLog.some((bet) => bet.signalId) });
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
        <div class="td-muted">${new Date(bet.addedAt).toLocaleDateString()}${bet.signalId ? " · linked signal" : ""}</div>
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
    ["Selection","Event","League","Sport","MarketType","Bet365Odds","FairDecimal","ModelProb","EV","Confidence","Stake","UnadjustedStake","PortfolioStatus","RiskLabel","DataQuality","PeerBooks"]
  ];
  currentReport.recommendations.forEach((r) => {
    rows.push([r.selection, r.event, r.league, r.sport, r.marketType,
      r.bet365Decimal, r.fairDecimal, r.modelProbability, r.expectedValue,
      r.confidence, r.stakeAmount, r.unadjustedStakeAmount ?? r.stakeAmount,
      r.portfolio?.status ?? "", r.risk.label, r.dataQuality, r.peerBookCount]);
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

// ── localStorage persistence ──────────────────────────────────
function persistBetLog() {
  try {
    localStorage.setItem("betLog", JSON.stringify(betLog));
  } catch { /* storage full / private mode */ }
  liveData.syncTrackedBets(betLog, { persist: true });
}

// ── Helpers ───────────────────────────────────────────────────
function maybeNotifySignals(report) {
  const topSignals = (report.recommendations ?? []).slice(0, 3);
  if (!topSignals.length) return;

  const storageKey = "bet365EdgeBrain:notifiedSignals";
  let seen = {};
  try {
    seen = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    seen = {};
  }

  const freshSignals = topSignals.filter((signal) => {
    const previousEv = seen[signal.id];
    return previousEv == null || signal.expectedValue > previousEv + 0.01;
  });

  for (const signal of freshSignals) {
    seen[signal.id] = signal.expectedValue;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(seen));
  } catch {
    // Ignore storage failures.
  }

  if (!freshSignals.length) return;

  const message = freshSignals
    .map((signal) => `${signal.selection} ${pct(signal.expectedValue)}`)
    .join(" | ");

  showToast(`New value signals: ${message}`, "success");

  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
    return;
  }
  if (Notification.permission === "granted") {
    new Notification("Bet365 Edge Brain", { body: message });
  }
}

function pct(v)        { return `${(v * 100).toFixed(1)}%`; }
function avg(arr)      { return arr.reduce((s,v) => s+v, 0) / arr.length; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function prettyReason(code) { return String(code).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function shortExposureKey(key) {
  const parts = String(key).split("::").filter(Boolean);
  return parts.length >= 3 ? parts[2] : (parts.at(-1) ?? "Unknown");
}
function esc(v)        {
  return String(v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function sportEmoji(sport) {
  const map = {
    basketball: "🏀", soccer: "⚽", americanfootball: "🏈", football: "🏈",
    tennis: "🎾", cricket: "🏏", baseball: "⚾",
    icehockey: "🏒", hockey: "🏒", golf: "⛳", rugby: "🏉", mma: "🥊",
    boxing: "🥊", esports: "🎮"
  };
  return map[String(sport).toLowerCase()] ?? "🎯";
}


/**
 * Bet365 Edge Brain — App v0.3
 * Tabs: Signals | Calculator | Tracker | Data
 * Live data wired: The Odds API + OddsBlaze + TheSportsDB
 */
import { analyzeSnapshot } from "./engine/recommendationEngine.js";
import { attachResearchEvidence } from "./engine/reliabilityGate.js";
import {
  decimalToImpliedProbability,
  americanToDecimal,
  decimalToAmerican,
  expectedValue,
  kellyFraction,
  clamp
} from "./engine/oddsMath.js";
import * as liveData from "./data/liveDataManager.js";
import { summarizeConnectionCoverage } from "./data/connectionCoverage.js";

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
let connectionStatus = null;
let verificationBusy = false;
let liveFetchBusy = false;

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
  $("btnCheckConnections").addEventListener("click", checkConnections);
  $("btnVerifyFeed").addEventListener("click", verifySelectedFeed);
  $("selectedSport").addEventListener("change", renderConnections);
  $("targetBookSelect").addEventListener("change", () => { if (currentSnapshot) runEngine(currentSnapshot); });
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

function renderConnections() {
  const coverage = summarizeConnectionCoverage(connectionStatus, { sport:$("selectedSport").value });
  const descriptions = {
    unconfigured:"Disconnected · configure a provider in server-side secrets; no feed verified",
    not_checked:"Provider configured · selected feed not verified",
    verified:coverage.eventCount === 0 ? "Feed verified · no events returned; no book coverage established" : "Feed verified · observed quotes only; eligibility and model not verified",
    failed:"Verification failed · no book coverage established",
    stale:"Verification stale · no current coverage verified; repeat manual verification if needed",
    invalid:"Invalid verification evidence · no current coverage verified"
  };
  const message = connectionStatus ? descriptions[coverage.state] : "Disconnected · /api/status unavailable. Start the local backend or use a private same-origin backend; server-side secrets only.";
  $("connectionStatus").textContent = message;
  $("checkBackend").textContent = coverage.liveEnabled ? "Backend readiness · available for manual requests" : "Backend readiness · unavailable for live requests";
  $("checkSecret").textContent = coverage.configured ? "Server-side provider configuration · configured, NOT proof of feed coverage" : "Server-side provider configuration · unconfigured; set secrets on the backend only";
  $("checkFeed").textContent = `Selected EPL / ca / h2h feed · ${coverage.state}${coverage.feedVerified ? ` · ${coverage.eventCount} events returned` : " · no current verification"}`;
  $("coverageSummary").textContent = `${message}${coverage.checkedAt ? ` · Checked: ${coverage.checkedAt}` : ""}${coverage.error ? ` · ${typeof coverage.error === "string" ? coverage.error : coverage.error.message ?? "Provider error"}` : ""}`;
  // All external strings pass through esc(); numeric ages are locally computed.
  $("coverageInventory").innerHTML = coverage.books.length ? coverage.books.map(book => `<article class="coverage-book"><h3>${esc(book.title)}</h3><p>${esc(book.key)} · ${esc(book.quoteCount)} observed quotes · ${esc(book.freshQuoteCount)} fresh quotes</p><p>${esc(book.freshness)} · ${book.ageMinutes === null ? "Age unknown" : `${Math.floor(book.ageMinutes)} minutes old`} · Last quote: ${esc(book.lastUpdate ?? "Missing")}</p><p>Eligibility: ${esc(book.eligibility)}</p></article>`).join("") : "No observed bookmaker quotes. No coverage established.";
  $("btnVerifyFeed").disabled = verificationBusy || liveFetchBusy || !coverage.liveEnabled || !coverage.configured;
  $("btnCheckConnections").disabled = verificationBusy;
  $("selectedSport").disabled = verificationBusy || liveFetchBusy;
  [els.btnFetchLive, els.btnFetchLive2].forEach(button => { button.disabled = !coverage.liveEnabled || !coverage.configured || verificationBusy || liveFetchBusy; });
  $("deploymentNotice").textContent = connectionStatus?.deploymentMode === "hosted-static"
    ? "Hosted-static demo: live fetching and verification are disabled. Use localhost or an authenticated private backend with server-side secrets. Demo and calculator remain available."
    : !connectionStatus || !coverage.liveEnabled
    ? "Live backend unavailable: use localhost or an authenticated private backend. Demo and calculator remain available; never enter a provider key in the browser."
    : "Local backend ready. Live data and verification are explicit manual actions; credentials stay server-side. No automatic bets or paid data.";
}

async function checkConnections() {
  if (verificationBusy) return;
  $("connectionStatus").textContent = "Checking server-side connection readiness…";
  try {
    const response = await fetch("/api/status", { cache:"no-store" });
    if (!response.ok) throw new Error("Backend unavailable");
    connectionStatus = await response.json();
  } catch { connectionStatus = null; }
  renderConnections();
}

async function verifySelectedFeed() {
  if (verificationBusy || liveFetchBusy || connectionStatus?.liveEnabled !== true || connectionStatus?.providers?.oddsApi?.configured !== true) return;
  verificationBusy = true;
  renderConnections();
  $("btnVerifyFeed").textContent = "Verifying selected feed…";
  const sport = $("selectedSport").value;
  try {
    const response = await fetch(`/api/odds/verify?sport=${encodeURIComponent(sport)}`, {method:"GET", cache:"no-store", headers:{"X-Odds-Manual":"1"}});
    const result = await response.json();
    if (!result?.verification || typeof result.verification !== "object") throw new Error("Invalid verification response");
    connectionStatus.providers.oddsApi.verification = result.verification;
    if (!response.ok && result.verification.state !== "failed") throw new Error("Verification request failed");
  } catch (err) {
    connectionStatus.providers.oddsApi.verification = {state:"failed", sport, error:err.message};
  } finally {
    verificationBusy = false;
    $("btnVerifyFeed").textContent = "Verify selected feed";
    renderConnections();
  }
}

async function boot() {
  // Research starts empty. Loading a demonstration is always an explicit choice.
  $("researchStatus").textContent = "Research workspace · Not validated";
  updateLiveStatus();
  await checkConnections();
  // Local clock-only expiry refresh; never fetch provider odds on a timer.
  setInterval(() => {
    updateLiveStatus();
    renderConnections();
    if (currentReport) { renderSignals(); renderMetrics(currentReport); renderPortfolio(currentReport); }
  }, 30000);
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
  isLiveMode = true;
  const report = runEngine(snapshot);
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
  if (connectionStatus?.liveEnabled !== true || connectionStatus?.providers?.oddsApi?.configured !== true || verificationBusy || liveFetchBusy) return;
  liveFetchBusy = true;
  renderConnections();
  const btns = [els.btnFetchLive, els.btnFetchLive2];
  btns.forEach((b) => { if (b) { b.disabled = true; b.textContent = "Fetching..."; } });
  showToast("Fetching live odds for the selected EPL feed (ca / h2h)…", "info");

  try {
    const snapshot = await liveData.fetchLiveSnapshot({ sports:[$("selectedSport").value], manual: true });
    applyLiveSnapshot(snapshot, { switchToSignals: true });

    const status = liveData.getFullStatus();
    showToast(
      snapshot.totalEvents === 0
        ? "Provider request completed: no events returned. No quotes or actionable research available."
        : `Research data loaded: ${snapshot.markets.length} markets, ${status.quota.remaining ?? "?"} requests left; coverage and model validation not verified`,
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
    liveFetchBusy = false;
    btns.forEach((b) => {
      if (b) b.textContent = "Fetch Live";
    });
    renderConnections();
  }
}

function togglePolling() {
  liveData.stopPolling();
  showToast("Automatic odds refresh is disabled. Use a manual fetch to protect the free-tier budget.", "info");
  updateLiveStatus();
}

function updateLiveStatus() {
  const status = liveData.getFullStatus();
  const polling = status.isPolling;
  const demo = currentSnapshot?.provider === "manual-sample";
  $("researchStatus").textContent = demo ? "Demo · non-actionable · not validated" : currentSnapshot ? "Research snapshot · Not validated" : "Research workspace · Not validated";
  const captured = Date.parse(currentSnapshot?.snapshotAt ?? "");
  const minutes = (Date.now() - captured) / 60000;
  $("freshnessStatus").textContent = !currentSnapshot ? "No snapshot loaded. No-bet until evidence is verified." : !Number.isFinite(minutes) || minutes < 0 ? "Unknown / invalid timestamp · No bet; verify quote timestamps." : `${minutes > 8 ? "Stale snapshot · No bet" : "Snapshot captured recently · verify every quote"} · ${Math.floor(minutes)} minutes old. ${demo ? "Demo prices are not live." : "Provider fetch time is not necessarily quote time."}`;
  if (els.sampleDisclaimer) els.sampleDisclaimer.textContent = demo ? "DEMO ONLY · Historical example prices. All results are paper-only, non-actionable and not validated." : "No live source loaded. Imported snapshots are research only; verify provenance, freshness, settlement and eligibility.";

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

  [els.btnTogglePoll, els.btnTogglePoll2].forEach((b) => {
    if (!b) return;
    b.textContent = "Manual only";
    b.disabled = true;
    b.title = "Automatic odds refresh is disabled to protect the free-tier budget.";
    b.classList.toggle("btn-green", false);
    b.classList.toggle("btn-secondary", true);
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
    els.dataStatSource.textContent = isLiveMode ? (status.isCached ? "Cached" : "Fetched") : currentSnapshot?.provider === "manual-sample" ? "Demo" : currentSnapshot ? "Imported" : "None";
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
    isLiveMode = false; // Editor imports have unverified provenance.
    runEngine(snapshot);
    updateLiveStatus();
    switchTab("signals");
  } catch (err) {
    els.signalsSummary.textContent = `JSON error: ${err.message}`;
  }
}

function readEngineConfig() {
  // Derive bankroll from topbar bankroll display (or default)
  const banStr = els.statBankroll.textContent.replace(/[^0-9.]/g, "");
  const baseConfig = {
    targetBook: $("targetBookSelect")?.value || "PlayNow",
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
  els.mAvgConf.textContent    = recs.length > 0 ? `${numberText(avg(recs.map(researchScore)),0)}/100` : "—";
  els.mTotalStake.textContent = `$${recs.reduce((s,r) => s + researchActionAmount(r), 0).toFixed(0)}`;
  els.mAvgQuality.textContent = recs.length > 0 ? pct(avg(recs.map(r => r.dataQuality))) : "—";
}

function renderPortfolio(report) {
  const raw = report.portfolioSummary;
  const actionAmount = report.recommendations.reduce((sum,rec) => sum + researchActionAmount(rec),0);
  const portfolio = raw ? { ...raw, activeCount:report.recommendations.filter(rec => researchActionAmount(rec)>0).length, plannedStakeAmount:actionAmount, plannedExposureFraction:actionAmount / readEngineConfig().bankroll } : null;
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
  if (activeSport !== "all") recs = recs.filter(r => r.sport === activeSport);
  if (activeRisk !== "all") recs = recs.filter(r => r.risk?.label === activeRisk);
  recs.sort((a,b) => sortKey === "ev" ? b.expectedValue-a.expectedValue : sortKey === "confidence" ? b.confidence-a.confidence : sortKey === "stake" ? researchActionAmount(b)-researchActionAmount(a) : researchScore(b)-researchScore(a));
  currentVisibleRecommendations = recs;
  els.signalsSummary.textContent = `${recs.length} research candidates · ${recs.filter(r => researchActionAmount(r) > 0).length} cleared for manual review`;
  if (!recs.length) {
    const reason = currentReport.diagnostics?.topReasons?.[0];
    const emptyMessage = currentSnapshot?.provider === "manual-sample" && $("targetBookSelect")?.value !== "Bet365"
      ? "The bundled demo contains Bet365 quotes, not the selected Canadian book. Select Bet365 to inspect this non-actionable example. No live coverage is implied."
      : currentSnapshot?.totalEvents === 0 ? "Provider request completed: no events returned. No quotes are available; this is not verified destination coverage."
      : reason?.code === "missing_bet365" ? `${$("targetBookSelect")?.value || "Selected book"} quotes unavailable in this snapshot. No other book's prices are substituted; live coverage remains unverified.`
      : reason ? prettyReason(reason.code) : "No candidates passed this screen. Check quote coverage, timestamps, or reset filters. Do not lower safety gates to force a pick.";
    els.signalsBody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">◎</div><div class="empty-title">No-bet is a valid research result</div><div class="empty-sub">${esc(emptyMessage)}</div></div></td></tr>`;
    return;
  }
  els.signalsBody.innerHTML = recs.map((rec,idx) => {
    const evidence = rec.evidence ?? {};
    const offered = rec.offeredDecimal ?? rec.bet365Decimal;
    const probability = evidence.modelProbability ?? rec.modelProbability;
    const consensus = evidence.consensusProbability ?? rec.consensusProbability;
    const source = evidence.modelSource ?? rec.modelSource ?? "unknown";
    const score = researchScore(rec);
    const amount = researchActionAmount(rec);
    const blocked = amount === 0;
    const reasons = rec.blockReasons?.length ? rec.blockReasons.map(prettyReason).join(" · ") : blocked ? "Validation / eligibility not established" : "Recheck the price and eligibility before any manual decision";
    const peers = Array.isArray(evidence.peers) ? evidence.peers : [];
    const peerRows = peers.map(peer => `<li><strong>${esc(peer.book ?? "Unknown book")}</strong> · decimal ${numberText(peer.decimal)} · no-vig ${probabilityText(peer.noVigProbability)} · ${esc(peer.updatedAt ?? "Timestamp missing")}</li>`).join("");
    const components = evidence.scoreComponents && typeof evidence.scoreComponents === "object" ? Object.entries(evidence.scoreComponents).map(([key,value]) => `${esc(prettyReason(key))}: ${esc(Number.isFinite(value) ? value.toFixed(1) : typeof value === "object" ? JSON.stringify(value) : value)}`).join(" · ") : "Legacy heuristic; score components unavailable";
    return `<tr data-rec-idx="${idx}" class="research-row"><td colspan="8">
      <article class="research-card" aria-label="Research candidate ${idx+1}">
        <div class="candidate-heading"><div><div class="eyebrow">${esc(rec.sport ?? "Sport unknown")} / ${esc(rec.league ?? "League unknown")}</div><h3>${esc(rec.selection)}</h3><p>${esc(rec.event)} · ${esc(rec.marketType)}</p></div><span class="pill ${blocked ? "pill-amber" : "pill-blue"}">${blocked ? "Paper only · No bet" : "Manual review only"}</span></div>
        <div class="candidate-metrics">
          <div><span>Research score</span><strong>${Number.isFinite(score) ? Math.round(score)+"/100" : "—"}</strong><small>Heuristic, not chance of winning</small></div>
          <div><span>${esc(rec.targetBook ?? "Offered book")} quote</span><strong>${numberText(offered)}</strong><small>${probabilityText(evidence.impliedProbability ?? rec.bet365ImpliedProbability)} implied</small></div>
          <div><span>Estimated probability</span><strong>${probabilityText(probability)}</strong><small>${source.includes("consensus") ? "Peer-consensus estimate" : "Model estimate · uncalibrated unless proven"}</small></div>
          <div><span>Estimated EV</span><strong>${Number.isFinite(rec.expectedValue) ? (rec.expectedValue >= 0 ? "+" : "")+pct(rec.expectedValue) : "—"}</strong><small>Depends on probability estimate</small></div>
          <div><span>Action amount</span><strong>$${amount.toFixed(2)}</strong><small>${blocked ? "No real stake suggested" : "Not an instruction to bet"}</small></div>
        </div>
        <div class="candidate-warning">${esc(reasons)}${rec.staleBookCount ? ` · ${esc(rec.staleBookCount)} stale peers` : ""}</div>
        <details class="evidence-disclosure"><summary>Inspect evidence &amp; assumptions</summary><div class="evidence-content">
          <p><strong>Peer consensus vs model:</strong> No-vig consensus ${probabilityText(consensus)}; estimate ${probabilityText(probability)}. Source: ${esc(source)}. Consensus is a market reference, not an independently validated prediction.</p>
          <p><strong>EV formula:</strong> <code>p * decimal - 1</code>, where p is estimated probability as a fraction. ${numberText(probability,3)} × ${numberText(offered)} − 1. Positive estimated EV does not demonstrate predictive accuracy or guarantee profit.</p>
          <p><strong>Validation:</strong> ${esc(typeof evidence.validationStatus === "string" ? evidence.validationStatus : "Not established; inspect model validation in source snapshot")}. Canadian quote availability does not verify BC or Ontario eligibility.</p>
          <p><strong>Score components:</strong> ${components}. Research score ranks evidence quality; it is not a percentage probability.</p>
          <p><strong>Quote timestamps / peer prices:</strong> ${esc(rec.peerBookCount ?? peers.length)} peers reported. Freshness must be checked per quote.</p><ul>${peerRows || "<li>Peer quote evidence unavailable. Do not treat as actionable.</li>"}</ul>
          ${(rec.notes ?? []).length ? `<p>Notes: ${rec.notes.map(esc).join(" · ")}</p>` : ""}
        </div></details>
      </article>
    </td></tr>`;
  }).join("");
}

function researchScore(rec) {
  if (Number.isFinite(rec.researchScore)) return clamp(rec.researchScore,0,100);
  // Legacy ranking score is only a heuristic, never a win probability.
  return Number.isFinite(rec.score) ? clamp(rec.score,0,100) : NaN;
}
function researchActionAmount(rec) {
  if (!isLiveMode || rec.actionable !== true) return 0;
  if (!currentSnapshot?.markets?.some(market => market.id === rec.marketId)) return 0;
  try {
    attachResearchEvidence(currentSnapshot, [rec], {...currentReport?.settings, staleMinutes:currentReport?.settings?.staleMinutes ?? 8, targetBook:rec.targetBook ?? currentReport?.settings?.targetBook ?? $("targetBookSelect")?.value, now:new Date(Date.now()).toISOString()});
  } catch { return 0; }
  return isLiveMode && rec.actionable === true && Number.isFinite(rec.actionableStakeAmount) && rec.actionableStakeAmount > 0 ? rec.actionableStakeAmount : 0;
}
function numberText(value, digits=2) { return Number.isFinite(value) ? value.toFixed(digits) : "—"; }
function probabilityText(value) { return Number.isFinite(value) && value >= 0 && value <= 1 ? pct(value) : "Unknown"; }

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

  if (ev >= 0) {
    els.calcVerdictText.textContent = ev >= .05 ? "Positive hypothetical EV" : "Marginal hypothetical EV";
    els.calcVerdictSub.textContent = `${(ev*100).toFixed(1)}% EV — hypothetical calculation only. Your probability estimate is not validated; this is not a recommendation.`;
  } else {
    els.calcVerdictText.textContent = "Negative hypothetical EV";
    els.calcVerdictSub.textContent = `${(ev*100).toFixed(1)}% EV — this input estimate does not support a bet.`;
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
    ["Selection","Event","League","Sport","MarketType","OfferedOdds","ConsensusFairDecimal","EstimatedProb","EstimatedEV","ConfidenceHeuristic","PaperStake","UnadjustedPaperStake","PortfolioStatus","RiskLabel","DataQuality","PeerBooks","TargetBook","ResearchScore","Actionable","ActionAmount","BlockReasons","DataMode"]
  ];
  currentReport.recommendations.forEach((r) => {
    const actionAmount = researchActionAmount(r);
    rows.push([r.selection, r.event, r.league, r.sport, r.marketType,
      r.offeredDecimal ?? r.bet365Decimal, r.fairDecimal, r.modelProbability, r.expectedValue,
      r.confidence, r.stakeAmount, r.unadjustedStakeAmount ?? r.stakeAmount,
      r.portfolio?.status ?? "", r.risk?.label ?? "Unknown", r.dataQuality, r.peerBookCount,
      r.targetBook ?? "Unknown", researchScore(r), actionAmount > 0,
      actionAmount, (r.blockReasons ?? []).join("; "),
      currentSnapshot?.provider === "manual-sample" ? "Demo non-actionable" : isLiveMode ? "Fetched research" : "Imported research"]);
  });
  downloadCsv(rows, "research-shortlist.csv");
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
  const topSignals = (report.recommendations ?? []).filter(signal => researchActionAmount(signal) > 0).slice(0, 3);
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


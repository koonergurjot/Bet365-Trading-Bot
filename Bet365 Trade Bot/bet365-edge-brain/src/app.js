import { analyzeSnapshot } from "./engine/recommendationEngine.js";

const elements = {
  editor: document.querySelector("#snapshotEditor"),
  runButton: document.querySelector("#runButton"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  resultsBody: document.querySelector("#resultsBody"),
  engineSummary: document.querySelector("#engineSummary"),
  snapshotAge: document.querySelector("#snapshotAge"),
  marketCount: document.querySelector("#marketCount"),
  signalCount: document.querySelector("#signalCount"),
  bankrollInput: document.querySelector("#bankrollInput"),
  minEvInput: document.querySelector("#minEvInput"),
  minConfidenceInput: document.querySelector("#minConfidenceInput"),
  maxStakeInput: document.querySelector("#maxStakeInput")
};

loadSample();

elements.runButton.addEventListener("click", runEngine);
elements.loadSampleButton.addEventListener("click", loadSample);

async function loadSample() {
  const response = await fetch("./src/data/sample-markets.json", { cache: "no-store" });
  const snapshot = await response.json();
  elements.editor.value = JSON.stringify(snapshot, null, 2);
  runEngine();
}

function runEngine() {
  try {
    const snapshot = JSON.parse(elements.editor.value);
    const report = analyzeSnapshot(snapshot, readConfig());
    renderReport(report);
  } catch (error) {
    elements.engineSummary.textContent = error.message;
    elements.resultsBody.innerHTML = "";
  }
}

function readConfig() {
  return {
    bankroll: Number(elements.bankrollInput.value),
    minExpectedValue: Number(elements.minEvInput.value),
    minConfidence: Number(elements.minConfidenceInput.value),
    maxBankrollStake: Number(elements.maxStakeInput.value)
  };
}

function renderReport(report) {
  elements.snapshotAge.textContent = `Snapshot: ${formatAge(report.sourceSnapshotAt)}`;
  elements.marketCount.textContent = `Markets: ${report.totalMarkets}`;
  elements.signalCount.textContent = `Signals: ${report.recommendations.length}`;
  elements.engineSummary.textContent = `${report.totalCandidates} candidates scored`;

  if (report.recommendations.length === 0) {
    elements.resultsBody.innerHTML = `<tr><td colspan="7" class="muted">No bets passed the current edge, confidence, and risk filters.</td></tr>`;
    return;
  }

  elements.resultsBody.innerHTML = report.recommendations.map((rec) => `
    <tr>
      <td>
        <strong>${escapeHtml(rec.selection)}</strong>
        <div class="muted">${escapeHtml(rec.event)} | ${escapeHtml(rec.marketType)} | ${escapeHtml(rec.league)}</div>
        <div class="muted">${rec.notes.length ? rec.notes.map(escapeHtml).join(", ") : "clean signal"}</div>
      </td>
      <td>${rec.bet365Decimal.toFixed(2)}<div class="muted">${formatPercent(rec.bet365ImpliedProbability)} implied</div></td>
      <td>${rec.fairDecimal.toFixed(2)}<div class="muted">${formatPercent(rec.modelProbability)} model</div></td>
      <td><span class="pill ${rec.expectedValue >= 0.08 ? "good" : "watch"}">${formatPercent(rec.expectedValue)}</span></td>
      <td>$${rec.stakeAmount.toFixed(2)}<div class="muted">${formatPercent(rec.stakeFraction)} bankroll</div></td>
      <td><span class="pill ${riskClass(rec.risk.label)}">${rec.risk.label}</span></td>
      <td>${formatPercent(rec.dataQuality)}<div class="muted">${rec.peerBookCount} peers, ${rec.staleBookCount} stale</div></td>
    </tr>
  `).join("");
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatAge(timestamp) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60000));
  return minutes <= 1 ? "fresh" : `${minutes}m old`;
}

function riskClass(label) {
  if (label === "Low") return "good";
  if (label === "Medium") return "watch";
  return "bad";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Live Data Manager - orchestrates all API adapters.
 * Adds quota safety, cached snapshot fallback, and baseline model enrichment.
 */

import {
  fetchAllLiveOdds,
  quota as oddsApiQuota,
  checkQuotaSafety,
  estimateFetchCost,
} from "./oddsApiAdapter.js";
import { fetchSupplementaryBooks, mergeIntoSnapshot } from "./oddsBlazeAdapter.js";
import { prewarmTeamCache } from "./sportsDbAdapter.js";
import { clamp, removeVig } from "../engine/oddsMath.js";
import { POLL_CONFIG, API_CONFIG, QUOTA } from "../config.js";

const SNAPSHOT_CACHE_KEY = "bet365EdgeBrain:lastSnapshot";
const BASELINE_STALE_MINUTES = 12;

let pollingTimer = null;
let lastSnapshot = null;
let lastFetchAt = null;
let fetchCount = 0;
let errorCount = 0;
let useOddsBlaze = true;
let oddsBlazeErrors = 0;
let snapshotSource = "idle";

export async function fetchLiveSnapshot({
  maxSports = POLL_CONFIG.maxSports,
  markets = API_CONFIG.theOddsApi.markets,
  sports = null,
  withOddsBlaze = true,
  withSportsDb = true,
} = {}) {
  const estimatedCost = estimateFetchCost(maxSports, { markets });
  const safety = checkQuotaSafety(estimatedCost);

  if (!safety.ok) {
    throw new Error(safety.message);
  }

  console.log(`[LiveData] Fetching snapshot... (est. cost: ~${estimatedCost} requests)`);
  const startMs = Date.now();

  let snapshot;
  try {
    snapshot = await fetchAllLiveOdds({ maxSports, markets, sports });
  } catch (err) {
    errorCount++;
    throw new Error(`The Odds API fetch failed: ${err.message}`);
  }

  console.log(`[LiveData] Odds API: ${snapshot.markets.length} markets / ${snapshot.totalEvents} events`);

  if (withOddsBlaze && useOddsBlaze) {
    try {
      const entries = await fetchSupplementaryBooks({
        leagues: API_CONFIG.oddsBlaze.leagues,
        sportsbooks: API_CONFIG.oddsBlaze.sportsbooks,
      });
      mergeIntoSnapshot(snapshot, entries);
      oddsBlazeErrors = 0;
    } catch (err) {
      oddsBlazeErrors++;
      console.warn(`[LiveData] OddsBlaze failed (streak ${oddsBlazeErrors}):`, err.message);
      if (oddsBlazeErrors >= 3) {
        useOddsBlaze = false;
        console.warn("[LiveData] OddsBlaze auto-disabled after 3 consecutive failures");
      }
    }
  }

  applyBaselineModels(snapshot);

  if (withSportsDb && snapshot.markets.length > 0) {
    prewarmTeamCache(snapshot.markets).catch((err) => {
      console.warn("[LiveData] SportsDB pre-warm failed:", err.message);
    });
  }

  snapshot.fetchDurationMs = Date.now() - startMs;
  lastSnapshot = snapshot;
  lastFetchAt = new Date();
  fetchCount++;
  snapshotSource = "live";
  persistSnapshotCache(snapshot);

  console.log(
    `[LiveData] Ready - ${snapshot.markets.length} markets, ` +
    `${snapshot.fetchDurationMs}ms, ` +
    `quota: ${oddsApiQuota.remaining ?? "?"} remaining`
  );

  return snapshot;
}

export function restoreCachedSnapshot() {
  const cached = readSnapshotCache();
  if (!cached?.snapshot) {
    return null;
  }

  lastSnapshot = cached.snapshot;
  lastFetchAt = cached.cachedAt ? new Date(cached.cachedAt) : new Date(cached.snapshot.snapshotAt ?? Date.now());
  snapshotSource = "cache";
  return lastSnapshot;
}

export function startPolling(onSnapshot, intervalMs = POLL_CONFIG.defaultIntervalMs, onQuotaWarning = null) {
  stopPolling();
  const safeInterval = Math.max(intervalMs, POLL_CONFIG.minIntervalMs);

  const tick = async () => {
    const safety = checkQuotaSafety(estimateFetchCost(POLL_CONFIG.maxSports));
    if (!safety.ok) {
      console.warn("[LiveData] Auto-polling paused - quota stop threshold reached:", safety.message);
      stopPolling();
      if (onQuotaWarning) onQuotaWarning(safety);
      return;
    }

    if (safety.level === "warn" && onQuotaWarning) {
      onQuotaWarning(safety);
    }

    try {
      const snapshot = await fetchLiveSnapshot();
      onSnapshot(snapshot);
    } catch (err) {
      console.error("[LiveData] Polling tick failed:", err.message);
    }
  };

  tick();
  pollingTimer = setInterval(tick, safeInterval);
  console.log(`[LiveData] Polling started - every ${formatPollingInterval(safeInterval)}`);
}

export function stopPolling() {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log("[LiveData] Polling stopped");
  }
}

export function isPolling() {
  return pollingTimer !== null;
}

export function getLastFetchAt() {
  return lastFetchAt;
}

export function getLastSnapshot() {
  return lastSnapshot;
}

export function getFetchCount() {
  return fetchCount;
}

export function getQuotaInfo() {
  return { ...oddsApiQuota };
}

export function getQuotaSafety() {
  return checkQuotaSafety();
}

export function getEstimatedFetchCost() {
  return estimateFetchCost(POLL_CONFIG.maxSports);
}

export function getStatusSummary() {
  return buildStatusSummary(getFullStatus());
}

export function getFullStatus() {
  const fetchAgeMs = lastFetchAt ? Date.now() - lastFetchAt.getTime() : null;
  const snapshotAgeMs = lastSnapshot?.snapshotAt
    ? Date.now() - Date.parse(lastSnapshot.snapshotAt)
    : null;
  const safety = checkQuotaSafety();
  const estCost = estimateFetchCost(POLL_CONFIG.maxSports);
  const estRemaining = oddsApiQuota.remaining !== null
    ? Math.floor(oddsApiQuota.remaining / estCost)
    : null;

  return {
    isPolling: pollingTimer !== null,
    source: snapshotSource,
    isCached: snapshotSource === "cache",
    lastFetchAt,
    lastFetchAge: formatRelativeAge(fetchAgeMs),
    lastFetchDisplay: formatTimestamp(lastFetchAt),
    snapshotAt: lastSnapshot?.snapshotAt ?? null,
    snapshotAge: formatRelativeAge(snapshotAgeMs),
    snapshotDisplay: lastSnapshot?.snapshotAt ? formatTimestamp(new Date(lastSnapshot.snapshotAt)) : null,
    markets: lastSnapshot?.markets.length ?? 0,
    totalEvents: lastSnapshot?.totalEvents ?? 0,
    fetchDurationMs: lastSnapshot?.fetchDurationMs ?? null,
    fetchCount,
    errorCount,
    quota: {
      used: oddsApiQuota.used,
      remaining: oddsApiQuota.remaining,
      monthly: QUOTA.monthlyLimit,
      level: safety.level,
      message: safety.message,
      estFetchCost: estCost,
      estFetchesLeft: estRemaining,
      warnThreshold: QUOTA.warnThreshold,
      stopThreshold: QUOTA.stopThreshold,
    },
    oddsBlazeEnabled: useOddsBlaze,
    pollingIntervalHrs: POLL_CONFIG.defaultIntervalMs / 3600000,
    pollingIntervalLabel: formatPollingInterval(POLL_CONFIG.defaultIntervalMs),
  };
}

export function resetOddsBlaze() {
  useOddsBlaze = true;
  oddsBlazeErrors = 0;
  console.log("[LiveData] OddsBlaze re-enabled");
}

function applyBaselineModels(snapshot) {
  for (const market of snapshot.markets ?? []) {
    if (market.model?.probabilities?.length) {
      continue;
    }

    const peerBooks = (market.books ?? []).filter((book) => normalizeBook(book.name) !== "bet365");
    const probabilityByName = new Map();
    let validPeerBooks = 0;
    let stalePeerBooks = 0;

    for (const book of peerBooks) {
      try {
        const noVigOutcomes = removeVig(book.outcomes ?? []);
        validPeerBooks++;
        if (isOlderThan(book.updatedAt, market.snapshotAt, BASELINE_STALE_MINUTES)) {
          stalePeerBooks++;
        }

        for (const outcome of noVigOutcomes) {
          const current = probabilityByName.get(outcome.name) ?? { sum: 0, count: 0 };
          current.sum += outcome.noVigProbability;
          current.count += 1;
          probabilityByName.set(outcome.name, current);
        }
      } catch {
        // Skip malformed or incomplete books.
      }
    }

    if (validPeerBooks === 0 || probabilityByName.size === 0) {
      continue;
    }

    const normalizedProbabilities = [];
    const preferredOrder = market.books?.find((book) => normalizeBook(book.name) === "bet365")?.outcomes ?? [];

    for (const outcome of preferredOrder) {
      const stats = probabilityByName.get(outcome.name);
      if (!stats) continue;
      normalizedProbabilities.push({
        name: outcome.name,
        probability: stats.sum / stats.count,
      });
    }

    for (const [name, stats] of probabilityByName.entries()) {
      if (normalizedProbabilities.some((entry) => entry.name === name)) continue;
      normalizedProbabilities.push({
        name,
        probability: stats.sum / stats.count,
      });
    }

    const totalProbability = normalizedProbabilities.reduce((sum, entry) => sum + entry.probability, 0);
    if (totalProbability <= 0) {
      continue;
    }

    const freshness = 1 - (stalePeerBooks / Math.max(validPeerBooks, 1));
    const confidence = clamp(
      0.42 + Math.min(validPeerBooks, 5) * 0.08 + freshness * 0.15 + (market.settlementRules ? 0.05 : 0),
      0.45,
      0.9
    );

    market.model = {
      version: "baseline-peer-consensus-v1",
      confidence: Number(confidence.toFixed(3)),
      probabilities: normalizedProbabilities.map((entry) => ({
        name: entry.name,
        probability: Number((entry.probability / totalProbability).toFixed(6)),
      })),
    };
  }
}

function persistSnapshotCache(snapshot) {
  const storage = getStorage();
  if (!storage || !snapshot) return;

  try {
    storage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({
      cachedAt: new Date().toISOString(),
      snapshot,
    }));
  } catch {
    // Ignore storage failures.
  }
}

function readSnapshotCache() {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(SNAPSHOT_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function buildStatusSummary(status) {
  if (!status.lastFetchAt) {
    return `Live data idle. Default auto-refresh is ${status.pollingIntervalLabel} to stay inside free-tier limits.`;
  }

  const freshness = status.snapshotAge ?? status.lastFetchAge ?? "unknown";
  const updatedAt = status.snapshotDisplay ?? status.lastFetchDisplay ?? "unknown";
  const quotaPart = status.quota.remaining === null
    ? "quota unknown"
    : `${status.quota.remaining}/${status.quota.monthly} requests left`;
  const sourcePart = status.isCached ? "using cached snapshot" : "using live snapshot";
  const cadencePart = status.isPolling
    ? `auto-refreshing every ${status.pollingIntervalLabel}`
    : "manual refresh only";

  return `Last updated ${updatedAt} (${freshness}); ${sourcePart}; ${quotaPart}; ${cadencePart}.`;
}

function getStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function normalizeBook(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isOlderThan(timestamp, referenceTimestamp, minutes) {
  const then = Date.parse(timestamp);
  const reference = Date.parse(referenceTimestamp);
  if (!Number.isFinite(then) || !Number.isFinite(reference)) return true;
  return reference - then > minutes * 60 * 1000;
}

function formatRelativeAge(ageMs) {
  if (ageMs === null || Number.isNaN(ageMs)) return null;
  if (ageMs < 60000) return "just now";
  if (ageMs < 3600000) return `${Math.round(ageMs / 60000)}m ago`;
  if (ageMs < 86400000) return `${Math.round((ageMs / 3600000) * 10) / 10}h ago`;
  return `${Math.round(ageMs / 86400000)}d ago`;
}

function formatTimestamp(date) {
  if (!date) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPollingInterval(intervalMs) {
  const hours = intervalMs / 3600000;
  if (hours >= 24) {
    return `${Math.round(hours / 24)}d`;
  }
  return `${Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10}h`;
}

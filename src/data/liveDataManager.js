/**
 * Live Data Manager - orchestrates all API adapters.
 * Quota-aware for The Odds API free tier and conservative by default.
 */

import {
  fetchAllLiveOdds,
  quota as oddsApiQuota,
  checkQuotaSafety,
  estimateFetchCost,
} from "./oddsApiAdapter.js";
import { fetchSupplementaryBooks, mergeIntoSnapshot } from "./oddsBlazeAdapter.js";
import { prewarmTeamCache } from "./sportsDbAdapter.js";
import { POLL_CONFIG, API_CONFIG, QUOTA } from "../config.js";

let pollingTimer = null;
let lastSnapshot = null;
let lastFetchAt = null;
let fetchCount = 0;
let errorCount = 0;
let useOddsBlaze = true;
let oddsBlazeErrors = 0;

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

  if (withSportsDb && snapshot.markets.length > 0) {
    prewarmTeamCache(snapshot.markets).catch((err) => {
      console.warn("[LiveData] SportsDB pre-warm failed:", err.message);
    });
  }

  snapshot.fetchDurationMs = Date.now() - startMs;
  lastSnapshot = snapshot;
  lastFetchAt = new Date();
  fetchCount++;

  console.log(
    `[LiveData] Ready - ${snapshot.markets.length} markets, ` +
    `${snapshot.fetchDurationMs}ms, ` +
    `quota: ${oddsApiQuota.remaining ?? "?"} remaining`
  );

  return snapshot;
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

function buildStatusSummary(status) {
  if (!status.lastFetchAt) {
    return `Live data idle. Default auto-refresh is ${status.pollingIntervalLabel} to stay inside free-tier limits.`;
  }

  const freshness = status.snapshotAge ?? status.lastFetchAge ?? "unknown";
  const updatedAt = status.snapshotDisplay ?? status.lastFetchDisplay ?? "unknown";
  const quotaPart = status.quota.remaining === null
    ? "quota unknown"
    : `${status.quota.remaining}/${status.quota.monthly} requests left`;
  const cadencePart = status.isPolling
    ? `auto-refreshing every ${status.pollingIntervalLabel}`
    : "manual refresh only";

  return `Last updated ${updatedAt} (${freshness}); ${quotaPart}; ${cadencePart}.`;
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

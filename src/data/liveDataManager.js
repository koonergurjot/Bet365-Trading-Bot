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
import { clamp } from "../engine/oddsMath.js";
import {
  buildWeightedConsensus,
  collectComparableOutcomes,
  describeMarketShape,
  normalizeBookName,
  normalizeOutcomeDescriptor,
} from "../engine/marketNormalizer.js";
import {
  annotateSnapshotWithHistory,
  createMarketHistoryStore,
  ingestSnapshotHistory,
} from "../engine/marketHistory.js";
import {
  annotateSnapshotWithFeedback,
  buildAdaptiveLearningContext,
  createFeedbackStore,
  observeSnapshotFeedback,
  registerRecommendations,
  syncTrackedBets as syncFeedbackTrackedBets,
} from "../engine/feedbackStore.js";
import { POLL_CONFIG, API_CONFIG, QUOTA } from "../config.js";

const SNAPSHOT_CACHE_KEY = "bet365EdgeBrain:lastSnapshot";
const MARKET_HISTORY_CACHE_KEY = "bet365EdgeBrain:marketHistory";
const FEEDBACK_STORE_CACHE_KEY = "bet365EdgeBrain:feedbackStore";
const BASELINE_STALE_MINUTES = 12;

let pollingTimer = null;
let lastSnapshot = null;
let lastFetchAt = null;
let fetchCount = 0;
let errorCount = 0;
let useOddsBlaze = true;
let oddsBlazeErrors = 0;
let snapshotSource = "idle";
let marketHistoryStore = createMarketHistoryStore();
let feedbackStore = createFeedbackStore();

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

  hydrateHistoryStore();
  hydrateFeedbackStore();
  applyBaselineModels(snapshot, marketHistoryStore);
  marketHistoryStore = ingestSnapshotHistory(snapshot, marketHistoryStore);
  annotateSnapshotWithHistory(snapshot, marketHistoryStore);
  feedbackStore = observeSnapshotFeedback(snapshot, feedbackStore);
  annotateSnapshotWithFeedback(snapshot, feedbackStore);

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
  persistMarketHistoryCache(marketHistoryStore);
  persistFeedbackStoreCache(feedbackStore);

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

  hydrateHistoryStore();
  hydrateFeedbackStore();
  lastSnapshot = cached.snapshot;
  lastFetchAt = cached.cachedAt ? new Date(cached.cachedAt) : new Date(cached.snapshot.snapshotAt ?? Date.now());
  if (!Object.keys(marketHistoryStore.markets ?? {}).length) {
    marketHistoryStore = ingestSnapshotHistory(lastSnapshot, marketHistoryStore);
  }
  annotateSnapshotWithHistory(lastSnapshot, marketHistoryStore);
  feedbackStore = observeSnapshotFeedback(lastSnapshot, feedbackStore);
  annotateSnapshotWithFeedback(lastSnapshot, feedbackStore);
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
    historyMarkets: Object.keys(marketHistoryStore.markets ?? {}).length,
    learningSignals: Object.keys(feedbackStore.signals ?? {}).length,
    learningSummary: buildAdaptiveLearningContext(feedbackStore).summary,
  };
}

export function registerSignalReport(report, snapshot = lastSnapshot, { persist = true } = {}) {
  hydrateFeedbackStore();
  feedbackStore = registerRecommendations(report, snapshot, feedbackStore);
  if (persist) {
    persistFeedbackStoreCache(feedbackStore);
  }
  return report;
}

export function syncTrackedBets(betLog, { persist = true } = {}) {
  hydrateFeedbackStore();
  feedbackStore = syncFeedbackTrackedBets(betLog, feedbackStore);
  if (persist) {
    persistFeedbackStoreCache(feedbackStore);
  }
}

export function getAdaptiveEngineConfig(baseConfig = {}) {
  hydrateFeedbackStore();
  const adaptiveLearning = buildAdaptiveLearningContext(feedbackStore);
  return {
    ...baseConfig,
    adaptiveLearning,
  };
}

export function getLearningSummary() {
  hydrateFeedbackStore();
  return buildAdaptiveLearningContext(feedbackStore).summary;
}

export function resetOddsBlaze() {
  useOddsBlaze = true;
  oddsBlazeErrors = 0;
  console.log("[LiveData] OddsBlaze re-enabled");
}

function applyBaselineModels(snapshot, historyStore) {
  for (const market of snapshot.markets ?? []) {
    if (market.model?.probabilities?.length && !shouldReplaceBaselineModel(market.model)) {
      continue;
    }

    const referenceBook = (market.books ?? []).find((book) => normalizeBookName(book.name) === "bet365")
      ?? market.books?.[0];
    if (!referenceBook?.outcomes?.length) {
      continue;
    }

    const normalizedProbabilities = [];
    const booksSeen = new Set();
    let stalePeerBooks = 0;
    let lineEquivalentCount = 0;
    let weightedFreshness = 0;
    let weightedAgreement = 0;
    let weightSum = 0;

    for (const outcome of referenceBook.outcomes) {
      const comparableOutcomes = collectComparableOutcomes(market, outcome, {
        sourceBook: referenceBook.name,
        staleMinutes: BASELINE_STALE_MINUTES,
      });
      if (!comparableOutcomes.length) {
        continue;
      }

      const consensus = buildWeightedConsensus(comparableOutcomes, {
        snapshotAt: market.snapshotAt,
        agreementHistory: historyStore,
        market,
        targetDescriptor: descriptor,
      });
      const descriptor = normalizeOutcomeDescriptor(market, outcome);
      const shape = describeMarketShape(market, outcome, comparableOutcomes);

      normalizedProbabilities.push({
        name: outcome.name,
        canonicalKey: descriptor.selectionKey,
        ...(descriptor.point !== null ? { line: descriptor.point } : {}),
        probability: consensus.noVigProbability,
      });

      for (const comparable of comparableOutcomes) {
        booksSeen.add(comparable.normalizedBook);
        if (comparable.isStale) {
          stalePeerBooks += 1;
        }
      }
      if (shape.usedLineNormalization) {
        lineEquivalentCount += shape.equivalentLineCount;
      }
      weightedFreshness += consensus.freshnessScore * consensus.weightSum;
      weightedAgreement += consensus.agreementScore * consensus.weightSum;
      weightSum += consensus.weightSum;
    }

    const totalProbability = normalizedProbabilities.reduce((sum, entry) => sum + entry.probability, 0);
    if (totalProbability <= 0) {
      continue;
    }

    const validPeerBooks = booksSeen.size;
    const freshness = 1 - clamp(stalePeerBooks / Math.max(validPeerBooks, 1), 0, 1);
    const agreement = weightSum > 0 ? weightedAgreement / weightSum : 0.92;
    const shapeBonus = lineEquivalentCount > 0 ? 0.04 : 0;
    const confidence = clamp(
      0.4
        + Math.min(validPeerBooks, 6) * 0.06
        + freshness * 0.14
        + clamp(agreement - 0.75, 0, 0.3) * 0.35
        + shapeBonus
        + (market.settlementRules ? 0.05 : 0),
      0.45,
      0.92
    );

    market.model = {
      version: "baseline-weighted-consensus-v2",
      confidence: Number(confidence.toFixed(3)),
      probabilities: normalizedProbabilities.map((entry) => ({
        name: entry.name,
        ...(entry.canonicalKey ? { canonicalKey: entry.canonicalKey } : {}),
        ...(entry.line != null ? { line: entry.line } : {}),
        probability: Number((entry.probability / totalProbability).toFixed(6)),
      })),
      meta: {
        peerBooks: validPeerBooks,
        stalePeerBooks,
        usedLineNormalization: lineEquivalentCount > 0,
        agreementScore: Number(agreement.toFixed(3)),
        freshnessScore: Number((weightSum > 0 ? weightedFreshness / weightSum : freshness).toFixed(3)),
      },
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

function persistMarketHistoryCache(historyStore) {
  const storage = getStorage();
  if (!storage || !historyStore) return;

  try {
    storage.setItem(MARKET_HISTORY_CACHE_KEY, JSON.stringify({
      cachedAt: new Date().toISOString(),
      history: historyStore,
    }));
  } catch {
    // Ignore storage failures.
  }
}

function readMarketHistoryCache() {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(MARKET_HISTORY_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.history ?? null;
  } catch {
    return null;
  }
}

function persistFeedbackStoreCache(store) {
  const storage = getStorage();
  if (!storage || !store) return;

  try {
    storage.setItem(FEEDBACK_STORE_CACHE_KEY, JSON.stringify({
      cachedAt: new Date().toISOString(),
      store,
    }));
  } catch {
    // Ignore storage failures.
  }
}

function readFeedbackStoreCache() {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(FEEDBACK_STORE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.store ?? null;
  } catch {
    return null;
  }
}

function hydrateHistoryStore() {
  if (Object.keys(marketHistoryStore.markets ?? {}).length > 0) {
    return;
  }

  marketHistoryStore = createMarketHistoryStore(readMarketHistoryCache());
}

function hydrateFeedbackStore() {
  if (Object.keys(feedbackStore.signals ?? {}).length > 0) {
    return;
  }

  feedbackStore = createFeedbackStore(readFeedbackStoreCache());
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

function shouldReplaceBaselineModel(model) {
  return !model?.version || String(model.version).startsWith("baseline-");
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

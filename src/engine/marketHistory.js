import { clamp, decimalToImpliedProbability } from "./oddsMath.js";
import {
  buildMarketIdentity,
  buildWeightedConsensus,
  collectComparableOutcomes,
  normalizeBookName,
  normalizeOutcomeDescriptor,
  buildOutcomeContextKey,
} from "./marketNormalizer.js";

const HISTORY_VERSION = 2;
const MAX_MARKETS = 240;
const MAX_SAMPLES_PER_POSITION = 18;
const HISTORY_STALE_HOURS = 72;
const LEAD_MOVE_THRESHOLD = 0.012;
const BET365_STATIC_THRESHOLD = 0.004;

export function createMarketHistoryStore(raw = null) {
  return {
    version: HISTORY_VERSION,
    bookStats: { ...(raw?.bookStats ?? {}) },
    contextBookStats: { ...(raw?.contextBookStats ?? {}) },
    leadLagStats: { ...(raw?.leadLagStats ?? {}) },
    markets: { ...(raw?.markets ?? {}) },
  };
}

export function ingestSnapshotHistory(snapshot, store) {
  const history = createMarketHistoryStore(store);
  const snapshotTimestamp = snapshot?.snapshotAt ?? new Date().toISOString();

  for (const market of snapshot?.markets ?? []) {
    const bet365Book = (market.books ?? []).find((book) => normalizeBookName(book.name) === "bet365");
    if (!bet365Book?.outcomes?.length) {
      continue;
    }

    const marketKey = buildMarketIdentity(market).marketKey;
    const marketState = history.markets[marketKey] ?? {
      sport: market.sport,
      marketType: market.marketType,
      commenceTime: market.commenceTime ?? null,
      positions: {},
      lastSeenAt: snapshotTimestamp,
    };

    for (const outcome of bet365Book.outcomes) {
      const descriptor = normalizeOutcomeDescriptor(market, outcome);
      const positionHistoryKey = getPositionHistoryKey(descriptor);
      const peers = collectComparableOutcomes(market, outcome, { staleMinutes: 12 });
      if (!peers.length) {
        continue;
      }

      const contextKey = buildOutcomeContextKey(market, descriptor);
      const consensus = buildWeightedConsensus(peers, {
        snapshotAt: market.snapshotAt ?? snapshotTimestamp,
        agreementHistory: history,
        market,
        targetDescriptor: descriptor,
      });
      const sample = buildHistorySample(market, outcome, descriptor, peers, consensus, snapshotTimestamp);

      if (!marketState.positions[positionHistoryKey]) {
        marketState.positions[positionHistoryKey] = {
          role: descriptor.role,
          canonicalName: descriptor.canonicalName,
          samples: [],
          pendingLeads: {},
        };
      }

      const positionState = marketState.positions[positionHistoryKey];
      const previousSample = positionState.samples.at(-1) ?? null;

      positionState.samples.push(sample);
      positionState.samples = positionState.samples.slice(-MAX_SAMPLES_PER_POSITION);

      if (previousSample) {
        updateLeadLagStats(history.leadLagStats, contextKey, positionState.pendingLeads, previousSample, sample);
      }

      for (const peer of peers) {
        updateBookStats(history, contextKey, peer, consensus.noVigProbability);
      }
    }

    marketState.lastSeenAt = snapshotTimestamp;
    history.markets[marketKey] = marketState;
  }

  pruneHistory(history, snapshotTimestamp);
  return history;
}

export function annotateSnapshotWithHistory(snapshot, store) {
  const history = createMarketHistoryStore(store);

  for (const market of snapshot?.markets ?? []) {
    const marketKey = buildMarketIdentity(market).marketKey;
    const marketState = history.markets[marketKey];
    if (!marketState) {
      continue;
    }

    const bet365Book = (market.books ?? []).find((book) => normalizeBookName(book.name) === "bet365");
    const positions = {};

    for (const outcome of bet365Book?.outcomes ?? []) {
      const descriptor = normalizeOutcomeDescriptor(market, outcome);
      const positionHistoryKey = getPositionHistoryKey(descriptor);
      const state = marketState.positions[positionHistoryKey];
      if (!state?.samples?.length) {
        continue;
      }

      const contextKey = buildOutcomeContextKey(market, descriptor);
      positions[descriptor.selectionKey] = buildPositionHistoryModel(
        state.samples,
        history,
        contextKey,
      );
    }

    if (Object.keys(positions).length > 0) {
      market.historyModel = {
        version: "line-history-v2",
        positions,
      };
    }
  }

  return snapshot;
}

function buildHistorySample(market, outcome, descriptor, peers, consensus, fallbackTimestamp) {
  const impliedProbability = safeImpliedProbability(outcome.price);
  const averagePeerLine = peers.length
    ? peers.reduce((sum, peer) => sum + Number(peer.matchedLine ?? descriptor.point ?? 0), 0) / peers.length
    : descriptor.point ?? null;
  const peerQuotes = Object.fromEntries(peers.map((peer) => [
    normalizeBookName(peer.normalizedBook ?? peer.book),
    {
      probability: Number(peer.probability.toFixed(6)),
      updatedAt: peer.updatedAt,
    },
  ]));

  return {
    recordedAt: market.snapshotAt ?? fallbackTimestamp,
    bet365Line: descriptor.point,
    bet365Price: Number(outcome.price),
    bet365ImpliedProbability: impliedProbability,
    marketProbability: Number(consensus.noVigProbability.toFixed(6)),
    consensusPrice: Number(consensus.fairDecimal.toFixed(4)),
    peerCount: peers.length,
    averagePeerLine: Number.isFinite(averagePeerLine) ? Number(averagePeerLine.toFixed(3)) : null,
    edge: Number((consensus.noVigProbability - impliedProbability).toFixed(6)),
    peerQuotes,
  };
}

function buildPositionHistoryModel(samples, history, contextKey) {
  const ordered = [...samples].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const latest = ordered.at(-1);
  const previous = ordered.at(-2) ?? latest;
  const first = ordered[0];
  const currentEdge = Number(latest.edge ?? 0);
  const previousEdge = Number(previous.edge ?? currentEdge);
  const trailingPositive = collectTrailingEdgeSamples(ordered, currentEdge);
  const persistenceMinutes = calculatePersistenceMinutes(trailingPositive);
  const snapbackDelta = previousEdge - currentEdge;
  const leadLag = summarizeLeadLag(history.leadLagStats, contextKey);

  return {
    sampleCount: ordered.length,
    lineDrift: calculateDrift(latest.bet365Line, previous.bet365Line),
    priceDrift: calculateDrift(latest.bet365Price, previous.bet365Price),
    marketProbabilityDrift: calculateDrift(latest.marketProbability, previous.marketProbability),
    edgeDrift: calculateDrift(currentEdge, previousEdge),
    longWindowLineDrift: calculateDrift(latest.bet365Line, first.bet365Line),
    longWindowPriceDrift: calculateDrift(latest.bet365Price, first.bet365Price),
    persistenceSamples: trailingPositive.length,
    persistenceMinutes,
    lagScore: clamp(
      currentEdge > 0
        ? currentEdge * 14
          + Math.max(0, currentEdge - previousEdge) * 8
          + Math.min(persistenceMinutes / 90, 0.28)
          + leadLag.lagRate * 0.18
        : 0,
      0,
      1
    ),
    snapbackRisk: clamp(
      snapbackDelta > 0
        ? snapbackDelta * 12 + (previousEdge > 0 && currentEdge <= 0 ? 0.35 : 0)
        : 0,
      0,
      1
    ),
    isLagging: currentEdge > 0.018 && (
      currentEdge >= previousEdge - 0.003
      || persistenceMinutes >= 20
      || leadLag.lagRate >= 0.45
    ),
    isSnappingBack: snapbackDelta > 0.012 || (previousEdge > 0.02 && currentEdge <= 0),
    edge: Number(currentEdge.toFixed(6)),
    marketProbability: latest.marketProbability,
    bet365ImpliedProbability: latest.bet365ImpliedProbability,
    lastRecordedAt: latest.recordedAt,
    selectionReliability: summarizeSelectionReliability(history, contextKey),
    leadLag,
  };
}

function collectTrailingEdgeSamples(samples, currentEdge) {
  if (!samples.length) return [];
  const sign = currentEdge >= 0 ? 1 : -1;
  const trailing = [];

  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    const edge = Number(sample.edge ?? 0);
    if (Math.sign(edge || 0) !== sign && Math.abs(edge) > 0.002) {
      break;
    }
    if (sign > 0 && edge < 0.01) {
      break;
    }
    trailing.unshift(sample);
  }

  return trailing;
}

function calculatePersistenceMinutes(samples) {
  if (samples.length < 2) {
    return 0;
  }

  const start = Date.parse(samples[0].recordedAt);
  const end = Date.parse(samples.at(-1).recordedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }

  return Math.max(0, Math.round((end - start) / 60000));
}

function updateBookStats(history, contextKey, peer, consensusProbability) {
  const bookKey = normalizeBookName(peer.normalizedBook ?? peer.book);
  const globalStats = history.bookStats[bookKey] ?? createBookStatsRecord();
  const contextCompositeKey = `${bookKey}::${contextKey}`;
  const contextStats = history.contextBookStats[contextCompositeKey] ?? createBookStatsRecord();
  const error = Math.abs(Number(peer.probability ?? 0.5) - Number(consensusProbability ?? 0.5));
  const stabilityValue = clamp(1 - error * 6 - Number(peer.lineDistance ?? 0) * 0.05, 0, 1);

  applyBookStatsUpdate(globalStats, error, stabilityValue, peer.updatedAt);
  applyBookStatsUpdate(contextStats, error, stabilityValue, peer.updatedAt);

  history.bookStats[bookKey] = globalStats;
  history.contextBookStats[contextCompositeKey] = contextStats;
}

function updateLeadLagStats(leadLagStats, contextKey, pendingLeads, previousSample, currentSample) {
  const bet365Delta = Number(currentSample.bet365ImpliedProbability ?? 0) - Number(previousSample.bet365ImpliedProbability ?? 0);
  const now = currentSample.recordedAt;
  const currentBooks = new Set([
    ...Object.keys(previousSample.peerQuotes ?? {}),
    ...Object.keys(currentSample.peerQuotes ?? {}),
  ]);

  for (const bookKey of currentBooks) {
    const previousQuote = previousSample.peerQuotes?.[bookKey];
    const currentQuote = currentSample.peerQuotes?.[bookKey];
    if (!previousQuote || !currentQuote) {
      delete pendingLeads[bookKey];
      continue;
    }

    const peerDelta = Number(currentQuote.probability ?? 0) - Number(previousQuote.probability ?? 0);
    const statKey = `${bookKey}::${contextKey}`;
    const stats = leadLagStats[statKey] ?? {
      book: bookKey,
      contextKey,
      leadSignals: 0,
      catchups: 0,
      averageLagMinutes: 0,
      averageLeadMove: 0,
    };

    const pending = pendingLeads[bookKey];

    if (pending && Math.sign(bet365Delta) === pending.direction && Math.abs(bet365Delta) >= pending.requiredMove) {
      stats.catchups += 1;
      stats.averageLagMinutes = runningAverage(
        stats.averageLagMinutes,
        stats.catchups,
        calculateMinutesBetween(pending.recordedAt, now),
      );
      delete pendingLeads[bookKey];
    } else if (pending && calculateMinutesBetween(pending.recordedAt, now) > 180) {
      delete pendingLeads[bookKey];
    }

    if (Math.abs(peerDelta) >= LEAD_MOVE_THRESHOLD && Math.abs(bet365Delta) <= BET365_STATIC_THRESHOLD) {
      stats.leadSignals += 1;
      stats.averageLeadMove = runningAverage(stats.averageLeadMove, stats.leadSignals, Math.abs(peerDelta));
      pendingLeads[bookKey] = {
        recordedAt: now,
        direction: Math.sign(peerDelta),
        requiredMove: Math.max(BET365_STATIC_THRESHOLD, Math.abs(peerDelta) * 0.45),
      };
    }

    leadLagStats[statKey] = stats;
  }
}

function summarizeSelectionReliability(history, contextKey) {
  const matching = Object.entries(history.contextBookStats)
    .filter(([key]) => key.endsWith(`::${contextKey}`))
    .map(([, value]) => value);

  if (!matching.length) {
    return {
      books: 0,
      averageError: 0.08,
      stability: 0.5,
    };
  }

  const totalSamples = matching.reduce((sum, value) => sum + value.samples, 0);
  const weightedError = matching.reduce((sum, value) => sum + value.meanAbsoluteError * value.samples, 0);
  const weightedStability = matching.reduce((sum, value) => sum + value.stability * value.samples, 0);

  return {
    books: matching.length,
    averageError: Number((weightedError / Math.max(totalSamples, 1)).toFixed(6)),
    stability: Number((weightedStability / Math.max(totalSamples, 1)).toFixed(6)),
  };
}

function summarizeLeadLag(leadLagStats, contextKey) {
  const matching = Object.entries(leadLagStats)
    .filter(([key]) => key.endsWith(`::${contextKey}`))
    .map(([, value]) => value)
    .filter((value) => value.leadSignals > 0);

  if (!matching.length) {
    return {
      bookCount: 0,
      lagRate: 0,
      averageLagMinutes: 0,
      leadSignals: 0,
      leaderBook: null,
      confidence: 0,
    };
  }

  const totalLeadSignals = matching.reduce((sum, value) => sum + value.leadSignals, 0);
  const totalCatchups = matching.reduce((sum, value) => sum + value.catchups, 0);
  const weightedLagMinutes = matching.reduce((sum, value) => sum + value.averageLagMinutes * value.catchups, 0);
  const bestLeader = [...matching].sort((a, b) => (b.catchups / Math.max(b.leadSignals, 1)) - (a.catchups / Math.max(a.leadSignals, 1)))[0];

  return {
    bookCount: matching.length,
    lagRate: Number((totalCatchups / Math.max(totalLeadSignals, 1)).toFixed(6)),
    averageLagMinutes: Number((weightedLagMinutes / Math.max(totalCatchups, 1)).toFixed(3)),
    leadSignals: totalLeadSignals,
    leaderBook: bestLeader?.book ?? null,
    confidence: clamp(totalLeadSignals / 8, 0, 1),
  };
}

function pruneHistory(history, referenceTimestamp) {
  const cutoff = Date.parse(referenceTimestamp) - HISTORY_STALE_HOURS * 3600000;
  const markets = Object.entries(history.markets)
    .filter(([, value]) => {
      const seenAt = Date.parse(value.lastSeenAt);
      return !Number.isFinite(seenAt) || seenAt >= cutoff;
    })
    .sort((a, b) => Date.parse(b[1].lastSeenAt ?? 0) - Date.parse(a[1].lastSeenAt ?? 0))
    .slice(0, MAX_MARKETS);

  history.markets = Object.fromEntries(markets);
}

function getPositionHistoryKey(descriptor) {
  return descriptor.isLineMarket ? descriptor.groupKey : descriptor.selectionKey;
}

function calculateDrift(current, previous) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) {
    return 0;
  }
  return Number((Number(current) - Number(previous)).toFixed(6));
}

function safeImpliedProbability(price) {
  try {
    return decimalToImpliedProbability(price);
  } catch {
    return 0.5;
  }
}

function createBookStatsRecord() {
  return {
    samples: 0,
    meanAbsoluteError: 0,
    stability: 0.5,
    lastSeenAt: null,
  };
}

function applyBookStatsUpdate(record, error, stabilityValue, updatedAt) {
  record.samples += 1;
  record.meanAbsoluteError = runningAverage(record.meanAbsoluteError, record.samples, error);
  record.stability = runningAverage(record.stability, record.samples, stabilityValue);
  record.lastSeenAt = updatedAt ?? new Date().toISOString();
}

function calculateMinutesBetween(startAt, endAt) {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / 60000));
}

function runningAverage(previousAverage, count, nextValue) {
  if (count <= 1) {
    return Number(nextValue);
  }

  return ((previousAverage * (count - 1)) + nextValue) / count;
}

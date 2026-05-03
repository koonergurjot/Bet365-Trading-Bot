import { clamp, decimalToImpliedProbability } from "./oddsMath.js";
import {
  buildMarketIdentity,
  buildWeightedConsensus,
  collectComparableOutcomes,
  normalizeBookName,
  normalizeOutcomeDescriptor,
} from "./marketNormalizer.js";

const HISTORY_VERSION = 1;
const MAX_MARKETS = 240;
const MAX_SAMPLES_PER_POSITION = 18;
const HISTORY_STALE_HOURS = 72;

export function createMarketHistoryStore(raw = null) {
  return {
    version: HISTORY_VERSION,
    bookStats: { ...(raw?.bookStats ?? {}) },
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

      const consensus = buildWeightedConsensus(peers, {
        snapshotAt: market.snapshotAt ?? snapshotTimestamp,
        agreementHistory: history.bookStats,
      });
      const sample = buildHistorySample(market, outcome, descriptor, peers, consensus, snapshotTimestamp);

      if (!marketState.positions[positionHistoryKey]) {
        marketState.positions[positionHistoryKey] = {
          role: descriptor.role,
          canonicalName: descriptor.canonicalName,
          samples: [],
        };
      }

      marketState.positions[positionHistoryKey].samples.push(sample);
      marketState.positions[positionHistoryKey].samples = marketState.positions[positionHistoryKey].samples
        .slice(-MAX_SAMPLES_PER_POSITION);

      for (const peer of peers) {
        updateBookStats(history.bookStats, peer, consensus.noVigProbability);
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

      positions[descriptor.selectionKey] = buildPositionHistoryModel(state.samples);
    }

    if (Object.keys(positions).length > 0) {
      market.historyModel = {
        version: "line-history-v1",
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
  };
}

function buildPositionHistoryModel(samples) {
  const ordered = [...samples].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const latest = ordered.at(-1);
  const previous = ordered.at(-2) ?? latest;
  const first = ordered[0];
  const currentEdge = Number(latest.edge ?? 0);
  const previousEdge = Number(previous.edge ?? currentEdge);
  const trailingPositive = collectTrailingEdgeSamples(ordered, currentEdge);
  const persistenceMinutes = calculatePersistenceMinutes(trailingPositive);
  const snapbackDelta = previousEdge - currentEdge;

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
        ? currentEdge * 14 + Math.max(0, currentEdge - previousEdge) * 8 + Math.min(persistenceMinutes / 90, 0.28)
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
    isLagging: currentEdge > 0.018 && (currentEdge >= previousEdge - 0.003 || persistenceMinutes >= 20),
    isSnappingBack: snapbackDelta > 0.012 || (previousEdge > 0.02 && currentEdge <= 0),
    edge: Number(currentEdge.toFixed(6)),
    marketProbability: latest.marketProbability,
    bet365ImpliedProbability: latest.bet365ImpliedProbability,
    lastRecordedAt: latest.recordedAt,
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

function updateBookStats(bookStats, peer, consensusProbability) {
  const key = normalizeBookName(peer.normalizedBook ?? peer.book);
  const current = bookStats[key] ?? {
    samples: 0,
    meanAbsoluteError: 0,
    stability: 0.5,
    lastSeenAt: null,
  };

  const error = Math.abs(Number(peer.probability ?? 0.5) - Number(consensusProbability ?? 0.5));
  current.samples += 1;
  current.meanAbsoluteError = runningAverage(current.meanAbsoluteError, current.samples, error);
  current.stability = runningAverage(
    current.stability,
    current.samples,
    clamp(1 - error * 6 - Number(peer.lineDistance ?? 0) * 0.05, 0, 1)
  );
  current.lastSeenAt = peer.updatedAt ?? new Date().toISOString();
  bookStats[key] = current;
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

function runningAverage(previousAverage, count, nextValue) {
  if (count <= 1) {
    return Number(nextValue);
  }

  return ((previousAverage * (count - 1)) + nextValue) / count;
}

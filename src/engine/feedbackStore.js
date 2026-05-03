import { clamp, decimalToImpliedProbability, expectedValue } from "./oddsMath.js";
import {
  buildWeightedConsensus,
  collectComparableOutcomes,
  normalizeMarketType,
  normalizeOutcomeDescriptor,
  canonicalizeText,
  isLineMarket,
} from "./marketNormalizer.js";

const FEEDBACK_VERSION = 1;
const MAX_SIGNAL_OBSERVATIONS = 24;
const PROFILE_MIN_SAMPLES = 6;

export function createFeedbackStore(raw = null) {
  return {
    version: FEEDBACK_VERSION,
    signals: { ...(raw?.signals ?? {}) },
  };
}

export function observeSnapshotFeedback(snapshot, store) {
  const feedback = createFeedbackStore(store);
  const observations = buildSnapshotObservationMap(snapshot);
  const snapshotAt = snapshot?.snapshotAt ?? new Date().toISOString();

  for (const signal of Object.values(feedback.signals)) {
    if (!signal || signal.closedAt) {
      continue;
    }

    const observation = observations.get(signal.id);
    if (observation) {
      appendObservation(signal, observation);
      signal.lastObservedAt = observation.seenAt;
      signal.latestBet365Decimal = observation.bet365Decimal;
      signal.latestConsensusProbability = observation.consensusProbability;
    }

    const commenceAt = Date.parse(signal.commenceTime);
    const currentAt = Date.parse(snapshotAt);
    if (Number.isFinite(commenceAt) && Number.isFinite(currentAt) && currentAt >= commenceAt) {
      finalizeSignalClose(signal);
    }
  }

  return feedback;
}

export function registerRecommendations(report, snapshot, store) {
  const feedback = createFeedbackStore(store);
  const snapshotAt = snapshot?.snapshotAt ?? report?.sourceSnapshotAt ?? new Date().toISOString();

  for (const recommendation of report?.recommendations ?? []) {
    const signal = feedback.signals[recommendation.id] ?? createSignalRecord(recommendation, snapshotAt);

    signal.lastRecommendedAt = snapshotAt;
    signal.modelSource = recommendation.modelSource ?? signal.modelSource;
    signal.initialPeerBookCount ??= recommendation.peerBookCount ?? 0;
    signal.initialExpectedValue ??= recommendation.expectedValue;
    signal.initialConfidence ??= recommendation.confidence;
    signal.initialModelProbability ??= recommendation.modelProbability;
    signal.initialConsensusProbability ??= recommendation.consensusProbability;
    signal.initialBet365Decimal ??= recommendation.bet365Decimal;
    signal.initialBet365ImpliedProbability ??= recommendation.bet365ImpliedProbability;
    signal.isLagging ??= Boolean(recommendation.history?.isLagging);
    signal.isLineNormalized ??= Boolean(recommendation.marketShape?.usedLineNormalization);
    signal.selectionRole ??= recommendation.selectionRole ?? signal.selectionRole;
    signal.selectionKey ??= recommendation.selectionKey ?? signal.selectionKey;
    signal.line = recommendation.line ?? signal.line ?? null;

    appendObservation(signal, {
      seenAt: snapshotAt,
      bet365Decimal: recommendation.bet365Decimal,
      bet365ImpliedProbability: recommendation.bet365ImpliedProbability,
      consensusProbability: recommendation.consensusProbability,
      modelProbability: recommendation.modelProbability,
      expectedValueAtOpen: recommendation.expectedValue,
      fairDecimal: recommendation.fairDecimal,
    });

    feedback.signals[recommendation.id] = signal;
  }

  return feedback;
}

export function syncTrackedBets(betLog, store) {
  const feedback = createFeedbackStore(store);
  const trackedSignalIds = new Set();

  for (const bet of betLog ?? []) {
    if (!bet?.signalId) {
      continue;
    }

    trackedSignalIds.add(bet.signalId);
    const signal = feedback.signals[bet.signalId];
    if (!signal) {
      continue;
    }

    if (!signal.trackedBetIds.includes(bet.id)) {
      signal.trackedBetIds.push(bet.id);
    }

    signal.latestTrackedStatus = bet.status;
    signal.trackedStake = Number(bet.stake ?? signal.trackedStake ?? 0);
    signal.trackedOdds = Number(bet.odds ?? signal.trackedOdds ?? 0);
    signal.trackedAddedAt = bet.addedAt ?? signal.trackedAddedAt ?? null;

    if (bet.status === "won" || bet.status === "lost" || bet.status === "void") {
      signal.settledAt = new Date().toISOString();
      signal.result = bet.status;
      signal.realizedPnl = calculateTrackedBetPnl(bet);
    } else if (!signal.result || signal.result === "pending") {
      signal.result = "pending";
      signal.realizedPnl = null;
    }
  }

  for (const signal of Object.values(feedback.signals)) {
    if (!trackedSignalIds.has(signal.id) && signal.result === "pending" && signal.trackedBetIds?.length) {
      signal.result = null;
      signal.realizedPnl = null;
    }
  }

  return feedback;
}

export function buildAdaptiveLearningContext(store) {
  const feedback = createFeedbackStore(store);
  const summary = createProfileAccumulator("global");
  const profiles = {};

  for (const signal of Object.values(feedback.signals)) {
    const resolved = finalizeSignalClose({ ...signal });
    accumulateProfile(summary, resolved);

    for (const key of buildLearningProfileKeys({
      sport: resolved.sport,
      marketType: resolved.marketType,
      peerCount: resolved.initialPeerBookCount,
      isLagging: resolved.isLagging,
      modelSource: resolved.modelSource,
      isLineNormalized: resolved.isLineNormalized,
    })) {
      if (!profiles[key]) {
        profiles[key] = createProfileAccumulator(key);
      }
      accumulateProfile(profiles[key], resolved);
    }
  }

  const finalizedProfiles = Object.fromEntries(
    Object.entries(profiles).map(([key, value]) => [key, finalizeProfile(value)])
  );

  return {
    summary: finalizeProfile(summary),
    profiles: finalizedProfiles,
  };
}

export function annotateSnapshotWithFeedback(snapshot, store) {
  const learningContext = buildAdaptiveLearningContext(store);

  for (const market of snapshot?.markets ?? []) {
    const profile = resolveAdaptiveLearningProfile(learningContext, {
      sport: market.sport,
      marketType: market.marketType,
      peerCount: (market.model?.meta?.peerBooks ?? 0),
      isLagging: false,
      modelSource: market.model?.version,
      isLineNormalized: Boolean(market.model?.meta?.usedLineNormalization),
    });

    if (profile) {
      market.feedbackModel = {
        profileKey: profile.profileKey,
        thresholdDeltaEv: profile.thresholdDeltaEv,
        thresholdDeltaConfidence: profile.thresholdDeltaConfidence,
        confidenceBoost: profile.confidenceBoost,
        scoreBoost: profile.scoreBoost,
        avgClv: profile.avgClv,
        positiveClvRate: profile.positiveClvRate,
        samples: profile.samples,
      };
    }
  }

  snapshot.learningModel = learningContext.summary;
  return snapshot;
}

export function resolveAdaptiveLearningProfile(learningContext, {
  sport,
  marketType,
  peerCount = 0,
  isLagging = false,
  modelSource = "",
  isLineNormalized = false,
} = {}) {
  if (!learningContext?.profiles) {
    return null;
  }

  const matchedProfiles = buildLearningProfileKeys({
    sport,
    marketType,
    peerCount,
    isLagging,
    modelSource,
    isLineNormalized,
  })
    .map((key) => learningContext.profiles[key])
    .filter((profile) => profile && profile.reliability > 0);

  if (!matchedProfiles.length) {
    return null;
  }

  let weightSum = 0;
  const merged = {
    profileKey: matchedProfiles.map((profile) => profile.profileKey).join("+"),
    thresholdDeltaEv: 0,
    thresholdDeltaConfidence: 0,
    confidenceBoost: 0,
    scoreBoost: 0,
    avgClv: 0,
    positiveClvRate: 0,
    samples: 0,
    reliability: 0,
  };

  for (const profile of matchedProfiles) {
    const weight = profile.reliability;
    merged.thresholdDeltaEv += profile.thresholdDeltaEv * weight;
    merged.thresholdDeltaConfidence += profile.thresholdDeltaConfidence * weight;
    merged.confidenceBoost += profile.confidenceBoost * weight;
    merged.scoreBoost += profile.scoreBoost * weight;
    merged.avgClv += profile.avgClv * weight;
    merged.positiveClvRate += profile.positiveClvRate * weight;
    merged.samples += profile.samples;
    merged.reliability += profile.reliability;
    weightSum += weight;
  }

  if (weightSum <= 0) {
    return null;
  }

  merged.thresholdDeltaEv /= weightSum;
  merged.thresholdDeltaConfidence /= weightSum;
  merged.confidenceBoost /= weightSum;
  merged.scoreBoost /= weightSum;
  merged.avgClv /= weightSum;
  merged.positiveClvRate /= weightSum;
  merged.reliability = clamp(merged.reliability / matchedProfiles.length, 0, 1);
  return merged;
}

export function buildLearningProfileKeys({
  sport,
  marketType,
  peerCount = 0,
  isLagging = false,
  modelSource = "",
  isLineNormalized = false,
} = {}) {
  const sportKey = canonicalizeText(sport) || "unknown";
  const marketKey = normalizeMarketType(marketType) || "unknown";
  const depthKey = peerCount >= 5 ? "deep" : peerCount >= 3 ? "medium" : "thin";
  const lagKey = isLagging ? "lag" : "standard";
  const modelKey = String(modelSource).includes("weighted") ? "weighted" : "other";
  const shapeKey = isLineNormalized || isLineMarket(marketKey) ? "line" : "straight";

  return [
    `sport-market::${sportKey}::${marketKey}`,
    `style::${marketKey}::${depthKey}::${lagKey}::${modelKey}::${shapeKey}`,
  ];
}

function buildSnapshotObservationMap(snapshot) {
  const map = new Map();

  for (const market of snapshot?.markets ?? []) {
    const bet365Book = (market.books ?? []).find((book) => canonicalizeText(book.name) === "bet365");
    if (!bet365Book) {
      continue;
    }

    for (const outcome of bet365Book.outcomes ?? []) {
      const descriptor = normalizeOutcomeDescriptor(market, outcome);
      const recommendationId = `${market.id}:${descriptor.selectionKey}`;
      const observation = buildObservationFromMarket(market, outcome, descriptor, snapshot.snapshotAt);
      if (observation) {
        map.set(recommendationId, observation);
      }
    }
  }

  return map;
}

function buildObservationFromMarket(market, outcome, descriptor, seenAt) {
  const peers = collectComparableOutcomes(market, outcome, { sourceBook: "bet365", staleMinutes: 12 });
  const consensus = peers.length
    ? buildWeightedConsensus(peers, { snapshotAt: market.snapshotAt, market, targetDescriptor: descriptor })
    : null;
  const modelProbability = resolveMarketModelProbability(market, descriptor, consensus?.noVigProbability ?? null);

  return {
    seenAt: seenAt ?? market.snapshotAt ?? new Date().toISOString(),
    bet365Decimal: Number(outcome.price),
    bet365ImpliedProbability: safeImpliedProbability(outcome.price),
    consensusProbability: modelProbability ?? consensus?.noVigProbability ?? 0.5,
    modelProbability: modelProbability ?? consensus?.noVigProbability ?? 0.5,
    expectedValueAtOpen: modelProbability != null ? expectedValue(modelProbability, outcome.price) : null,
    fairDecimal: consensus?.fairDecimal ?? (modelProbability ? 1 / modelProbability : null),
  };
}

function createSignalRecord(recommendation, snapshotAt) {
  return {
    id: recommendation.id,
    marketId: recommendation.marketId,
    sport: recommendation.sport,
    league: recommendation.league,
    event: recommendation.event,
    marketType: recommendation.marketType,
    selection: recommendation.selection,
    selectionKey: recommendation.selectionKey ?? recommendation.id.split(":").slice(1).join(":"),
    selectionRole: recommendation.selectionRole ?? "selection",
    line: recommendation.line ?? null,
    commenceTime: recommendation.commenceTime ?? null,
    modelSource: recommendation.modelSource ?? "unknown",
    initialSnapshotAt: snapshotAt,
    initialBet365Decimal: recommendation.bet365Decimal,
    initialBet365ImpliedProbability: recommendation.bet365ImpliedProbability,
    initialConsensusProbability: recommendation.consensusProbability,
    initialModelProbability: recommendation.modelProbability,
    initialExpectedValue: recommendation.expectedValue,
    initialConfidence: recommendation.confidence,
    initialPeerBookCount: recommendation.peerBookCount ?? 0,
    isLagging: Boolean(recommendation.history?.isLagging),
    isLineNormalized: Boolean(recommendation.marketShape?.usedLineNormalization),
    trackedBetIds: [],
    result: null,
    realizedPnl: null,
    observations: [],
    lastRecommendedAt: snapshotAt,
    lastObservedAt: snapshotAt,
    closedAt: null,
  };
}

function appendObservation(signal, observation) {
  if (!signal.observations) {
    signal.observations = [];
  }

  const last = signal.observations.at(-1);
  if (last?.seenAt === observation.seenAt) {
    signal.observations[signal.observations.length - 1] = observation;
  } else {
    signal.observations.push(observation);
    signal.observations = signal.observations.slice(-MAX_SIGNAL_OBSERVATIONS);
  }
}

function finalizeSignalClose(signal) {
  if (signal.closedAt) {
    return signal;
  }

  const observations = [...(signal.observations ?? [])].sort((a, b) => Date.parse(a.seenAt) - Date.parse(b.seenAt));
  if (!observations.length) {
    return signal;
  }

  const commenceAt = Date.parse(signal.commenceTime);
  const closingObservation = observations
    .filter((observation) => !Number.isFinite(commenceAt) || Date.parse(observation.seenAt) <= commenceAt)
    .at(-1) ?? observations.at(-1);

  signal.closedAt = signal.commenceTime ?? closingObservation.seenAt;
  signal.closingBet365Decimal = closingObservation.bet365Decimal;
  signal.closingConsensusProbability = closingObservation.consensusProbability;
  signal.closingModelProbability = closingObservation.modelProbability;
  signal.closingFairDecimal = closingObservation.fairDecimal ?? (
    Number.isFinite(closingObservation.consensusProbability) && closingObservation.consensusProbability > 0
      ? 1 / closingObservation.consensusProbability
      : null
  );
  signal.clv = Number(((closingObservation.consensusProbability ?? 0) - (signal.initialBet365ImpliedProbability ?? 0)).toFixed(6));
  signal.closingExpectedValue = Number(
    expectedValue(
      clamp(closingObservation.consensusProbability ?? 0.5, 0.001, 0.999),
      clamp(signal.initialBet365Decimal ?? 2, 1.001, 1000)
    ).toFixed(6)
  );

  return signal;
}

function createProfileAccumulator(profileKey) {
  return {
    profileKey,
    samples: 0,
    closedSamples: 0,
    settledSamples: 0,
    positiveClvCount: 0,
    totalClv: 0,
    totalClosingEv: 0,
    totalStake: 0,
    totalPnl: 0,
    wins: 0,
    losses: 0,
  };
}

function accumulateProfile(accumulator, signal) {
  accumulator.samples += 1;

  if (Number.isFinite(signal.clv)) {
    accumulator.closedSamples += 1;
    accumulator.totalClv += signal.clv;
    accumulator.totalClosingEv += Number(signal.closingExpectedValue ?? 0);
    if (signal.clv > 0) {
      accumulator.positiveClvCount += 1;
    }
  }

  if (signal.result === "won" || signal.result === "lost" || signal.result === "void") {
    accumulator.settledSamples += 1;
    accumulator.totalStake += Number(signal.trackedStake ?? 0);
    accumulator.totalPnl += Number(signal.realizedPnl ?? 0);
    if (signal.result === "won") accumulator.wins += 1;
    if (signal.result === "lost") accumulator.losses += 1;
  }
}

function finalizeProfile(accumulator) {
  const closedSamples = accumulator.closedSamples;
  const settledSamples = accumulator.settledSamples;
  const avgClv = closedSamples > 0 ? accumulator.totalClv / closedSamples : 0;
  const positiveClvRate = closedSamples > 0 ? accumulator.positiveClvCount / closedSamples : 0.5;
  const avgClosingEv = closedSamples > 0 ? accumulator.totalClosingEv / closedSamples : 0;
  const realizedRoi = accumulator.totalStake > 0 ? accumulator.totalPnl / accumulator.totalStake : null;
  const realizedWinRate = (accumulator.wins + accumulator.losses) > 0
    ? accumulator.wins / (accumulator.wins + accumulator.losses)
    : null;
  const reliability = clamp(
    Math.min(1, closedSamples / PROFILE_MIN_SAMPLES) * 0.75
      + Math.min(1, settledSamples / Math.max(PROFILE_MIN_SAMPLES - 2, 1)) * 0.25,
    0,
    1
  );

  const clvSignal = avgClv * 20 + (positiveClvRate - 0.5) * 0.8 + avgClosingEv * 4;
  const roiSignal = realizedRoi == null ? 0 : clamp(realizedRoi, -0.5, 0.5) * 0.5;
  const combinedSignal = (clvSignal + roiSignal) * reliability;

  return {
    profileKey: accumulator.profileKey,
    samples: accumulator.samples,
    closedSamples,
    settledSamples,
    avgClv: Number(avgClv.toFixed(6)),
    positiveClvRate: Number(positiveClvRate.toFixed(4)),
    avgClosingEv: Number(avgClosingEv.toFixed(6)),
    realizedRoi: realizedRoi == null ? null : Number(realizedRoi.toFixed(6)),
    realizedWinRate: realizedWinRate == null ? null : Number(realizedWinRate.toFixed(4)),
    reliability: Number(reliability.toFixed(4)),
    thresholdDeltaEv: clamp(Number((-combinedSignal * 0.008).toFixed(6)), -0.012, 0.015),
    thresholdDeltaConfidence: clamp(Number((-combinedSignal * 0.04).toFixed(6)), -0.06, 0.08),
    confidenceBoost: clamp(Number((combinedSignal * 0.03).toFixed(6)), -0.05, 0.05),
    scoreBoost: clamp(Number((combinedSignal * 3.5).toFixed(6)), -4, 4),
  };
}

function resolveMarketModelProbability(market, descriptor, fallbackProbability) {
  const modelEntry = market.model?.probabilities?.find((entry) => {
    if (entry.canonicalKey && entry.canonicalKey === descriptor.selectionKey) {
      return true;
    }

    if (descriptor.point != null && Number(entry.line) === descriptor.point) {
      return true;
    }

    return entry.name === descriptor.name;
  });

  if (modelEntry && Number.isFinite(modelEntry.probability)) {
    return clamp(Number(modelEntry.probability), 0.001, 0.999);
  }

  if (Number.isFinite(fallbackProbability)) {
    return clamp(Number(fallbackProbability), 0.001, 0.999);
  }

  return null;
}

function safeImpliedProbability(price) {
  try {
    return decimalToImpliedProbability(price);
  } catch {
    return 0.5;
  }
}

function calculateTrackedBetPnl(bet) {
  if (bet.status === "won") return Number(bet.stake) * (Number(bet.odds) - 1);
  if (bet.status === "lost") return -Number(bet.stake);
  if (bet.status === "void") return 0;
  return null;
}

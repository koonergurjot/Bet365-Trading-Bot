import {
  clamp,
  decimalToImpliedProbability,
  expectedValue,
  kellyFraction,
} from "./oddsMath.js";
import {
  buildWeightedConsensus,
  collectComparableOutcomes,
  describeMarketShape,
  normalizeBookName,
  normalizeOutcomeDescriptor,
} from "./marketNormalizer.js";
import { applyCrossMarketContext } from "./crossMarketAnalyzer.js";
import { resolveAdaptiveLearningProfile } from "./feedbackStore.js";

const DEFAULT_CONFIG = {
  bankroll: 1000,
  minExpectedValue: 0.03,
  minConfidence: 0.55,
  maxBankrollStake: 0.02,
  maxTotalExposure: 0.06,
  maxEventExposure: 0.025,
  maxSportExposure: 0.04,
  fractionalKelly: 0.25,
  staleMinutes: 8,
  dynamicThresholds: true,
  adaptiveLearning: null,
};

export function analyzeSnapshot(snapshot, config = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };
  validateSnapshot(snapshot);

  const evaluations = snapshot.markets.flatMap((market) => evaluateMarket(market, settings));
  const crossMarketSummary = applyCrossMarketContext(snapshot, evaluations);
  const recommendations = evaluations
    .filter((entry) => entry.accepted && entry.recommendation)
    .map((entry) => entry.recommendation)
    .sort((a, b) => b.score - a.score);
  const portfolioSummary = applyPortfolioGuardrails(recommendations, settings);

  return {
    generatedAt: new Date().toISOString(),
    sourceSnapshotAt: snapshot.snapshotAt,
    settings,
    totalMarkets: snapshot.markets.length,
    totalCandidates: evaluations.filter((entry) => entry.recommendation).length,
    recommendations,
    portfolioSummary,
    learningSummary: settings.adaptiveLearning?.summary ?? null,
    diagnostics: buildDiagnostics(snapshot.markets, evaluations, crossMarketSummary, portfolioSummary),
  };
}

export function analyzeMarket(market, settings = DEFAULT_CONFIG) {
  return evaluateMarket(market, settings)
    .filter((entry) => entry.recommendation)
    .map((entry) => entry.recommendation);
}

function evaluateMarket(market, settings) {
  const bet365Book = (market.books ?? []).find((book) => normalizeBookName(book.name) === "bet365");
  if (!bet365Book) {
    return [{
      accepted: false,
      recommendation: null,
      marketId: market.id,
      sport: market.sport,
      event: market.event,
      reasonCodes: ["missing_bet365"],
      warningCodes: [],
    }];
  }

  return bet365Book.outcomes.map((bet365Outcome) => {
    const descriptor = normalizeOutcomeDescriptor(market, bet365Outcome);
    const peerOutcomes = collectPeerOutcomes(market, bet365Outcome, settings);
    const consensus = buildConsensus(peerOutcomes, market, descriptor);
    const modelProbability = chooseModelProbability(market, descriptor, consensus.noVigProbability);
    const ev = expectedValue(modelProbability, bet365Outcome.price);
    const rawKelly = kellyFraction(modelProbability, bet365Outcome.price);
    const history = market.historyModel?.positions?.[descriptor.selectionKey] ?? null;
    const marketShape = describeMarketShape(market, bet365Outcome, peerOutcomes);
    const peerBookCount = new Set(peerOutcomes.map((outcome) => outcome.normalizedBook)).size;
    const learningProfile = resolveAdaptiveLearningProfile(settings.adaptiveLearning, {
      sport: market.sport,
      marketType: market.marketType,
      peerCount: peerBookCount,
      isLagging: Boolean(history?.isLagging),
      modelSource: market.model?.version,
      isLineNormalized: Boolean(marketShape.usedLineNormalization),
    });
    const dataQuality = scoreDataQuality(market, peerOutcomes, settings, history, marketShape, learningProfile);
    const confidence = scoreConfidence(market, dataQuality, consensus, history, learningProfile);
    const thresholds = buildDynamicThresholds({
      market,
      settings,
      peerOutcomes,
      history,
      marketShape,
      learningProfile,
    });
    const stakeFraction = clamp(rawKelly * settings.fractionalKelly, 0, settings.maxBankrollStake);
    const risk = scoreRisk({
      ev,
      stakeFraction,
      confidence,
      dataQuality,
      price: bet365Outcome.price,
      history,
      learningProfile,
    });
    const notes = buildNotes(market, peerOutcomes, confidence, dataQuality, history, marketShape, learningProfile);
    const reasonCodes = buildReasonCodes({
      market,
      peerOutcomes,
      expectedValue: ev,
      confidence,
      thresholds,
      history,
    });

    return {
      accepted: reasonCodes.length === 0,
      marketId: market.id,
      sport: market.sport,
      event: market.event,
      selection: bet365Outcome.name,
      reasonCodes,
      warningCodes: notes.map(noteToReasonCode),
      recommendation: {
        id: `${market.id}:${descriptor.selectionKey}`,
        marketId: market.id,
        sport: market.sport,
        league: market.league,
        event: market.event,
        marketType: market.marketType,
        selection: bet365Outcome.name,
        selectionKey: descriptor.selectionKey,
        selectionRole: descriptor.role,
        selectionGroup: descriptor.groupKey,
        ...(descriptor.point !== null ? { line: descriptor.point } : {}),
        commenceTime: market.commenceTime,
        bet365Decimal: bet365Outcome.price,
        bet365American: bet365Outcome.american ?? null,
        bet365ImpliedProbability: decimalToImpliedProbability(bet365Outcome.price),
        consensusProbability: consensus.noVigProbability,
        fairDecimal: consensus.fairDecimal,
        modelProbability,
        expectedValue: ev,
        kellyFraction: rawKelly,
        stakeFraction,
        stakeAmount: Number((settings.bankroll * stakeFraction).toFixed(2)),
        confidence,
        dataQuality,
        risk,
        thresholds,
        history,
        marketShape,
        learningProfile,
        score: buildRecommendationScore({ ev, confidence, dataQuality, history, marketShape, risk, learningProfile }),
        peerBookCount,
        staleBookCount: new Set(peerOutcomes.filter((outcome) => outcome.isStale).map((outcome) => outcome.normalizedBook)).size,
        modelSource: market.model?.version ?? "consensus-fallback",
        notes,
      },
    };
  });
}

function collectPeerOutcomes(market, targetOutcome, settings) {
  return collectComparableOutcomes(market, targetOutcome, {
    sourceBook: "bet365",
    staleMinutes: settings.staleMinutes,
  });
}

function buildConsensus(peerOutcomes, market, descriptor) {
  return buildWeightedConsensus(peerOutcomes, {
    snapshotAt: market.snapshotAt,
    agreementHistory: {
      bookStats: market.historyModel?.bookStats,
      contextBookStats: market.historyModel?.contextBookStats,
    },
    market,
    targetDescriptor: descriptor,
  });
}

function chooseModelProbability(market, descriptor, consensusProbability) {
  const modelPick = market.model?.probabilities?.find((entry) => {
    if (entry.canonicalKey && entry.canonicalKey === descriptor.selectionKey) {
      return true;
    }

    if (descriptor.point != null && Number(entry.line) === descriptor.point) {
      const candidateDescriptor = normalizeOutcomeDescriptor(market, entry);
      return candidateDescriptor.groupKey === descriptor.groupKey;
    }

    return entry.name === descriptor.name;
  });

  if (modelPick && Number.isFinite(modelPick.probability)) {
    return clamp(modelPick.probability, 0.001, 0.999);
  }
  return clamp(consensusProbability, 0.001, 0.999);
}

function scoreDataQuality(market, peerOutcomes, settings, history, marketShape, learningProfile) {
  const bookDepth = clamp(new Set(peerOutcomes.map((outcome) => outcome.normalizedBook)).size / 6, 0, 1);
  const freshness = 1 - clamp(peerOutcomes.filter((outcome) => outcome.isStale).length / Math.max(peerOutcomes.length, 1), 0, 1);
  const modelFreshness = isOlderThan(market.snapshotAt, new Date().toISOString(), settings.staleMinutes) ? 0.45 : 1;
  const settlementRisk = market.settlementRules ? 1 : 0.7;
  const lineQuality = marketShape.usedLineNormalization
    ? clamp(1 - marketShape.averageLineDistance / 4, 0.55, 1)
    : 1;
  const historyCoverage = history ? clamp(history.sampleCount / 6, 0.25, 1) : 0.5;
  const reliability = history?.selectionReliability
    ? clamp(1 - history.selectionReliability.averageError * 4 + history.selectionReliability.stability * 0.15, 0.4, 1)
    : 0.55;
  const learningLift = learningProfile ? clamp(0.5 + learningProfile.confidenceBoost * 3, 0.4, 0.7) : 0.55;

  return clamp(
    bookDepth * 0.23
      + freshness * 0.2
      + modelFreshness * 0.13
      + settlementRisk * 0.12
      + lineQuality * 0.09
      + historyCoverage * 0.08
      + reliability * 0.09
      + learningLift * 0.06,
    0,
    1
  );
}

function scoreConfidence(market, dataQuality, consensus, history, learningProfile) {
  const modelConfidence = Number(market.model?.confidence ?? 0.5);
  const agreementScore = clamp(Number(consensus.agreementScore ?? 0.9) - 0.75, 0, 0.4);
  const historyAdjustment = history
    ? (history.isLagging ? 0.06 : 0)
      - (history.isSnappingBack ? 0.06 : 0)
      + Math.min(history.persistenceSamples / 20, 0.08)
      + (history.leadLag?.lagRate ?? 0) * 0.04
    : 0;
  const learningAdjustment = learningProfile
    ? clamp(learningProfile.confidenceBoost, -0.05, 0.05)
    : 0;

  return clamp(
    modelConfidence * 0.42
      + dataQuality * 0.34
      + agreementScore * 0.18
      + historyAdjustment
      + learningAdjustment,
    0,
    1
  );
}

function buildDynamicThresholds({ market, settings, peerOutcomes, history, marketShape, learningProfile }) {
  const dynamic = settings.dynamicThresholds !== false;
  const baseEv = Number(settings.minExpectedValue ?? DEFAULT_CONFIG.minExpectedValue);
  const baseConfidence = Number(settings.minConfidence ?? DEFAULT_CONFIG.minConfidence);

  if (!dynamic) {
    return {
      minExpectedValue: baseEv,
      minConfidence: baseConfidence,
      rationale: ["dynamic thresholds disabled"],
    };
  }

  const peerCount = new Set(peerOutcomes.map((outcome) => outcome.normalizedBook)).size;
  const staleShare = clamp(peerOutcomes.filter((outcome) => outcome.isStale).length / Math.max(peerOutcomes.length, 1), 0, 1);
  const hoursToStart = getHoursToStart(market.commenceTime, market.snapshotAt);
  const rationale = [];
  let minExpectedValue = baseEv;
  let minConfidence = baseConfidence;

  if (peerCount >= 5) {
    minExpectedValue -= 0.008;
    minConfidence -= 0.045;
    rationale.push("deep peer market");
  } else if (peerCount <= 1) {
    minExpectedValue += 0.02;
    minConfidence += 0.12;
    rationale.push("thin peer market");
  } else if (peerCount <= 3) {
    minExpectedValue += 0.006;
    minConfidence += 0.04;
    rationale.push("moderate peer depth");
  }

  if (staleShare >= 0.5) {
    minExpectedValue += 0.008;
    minConfidence += 0.05;
    rationale.push("stale peer quotes");
  } else if (staleShare <= 0.15) {
    minExpectedValue -= 0.004;
    minConfidence -= 0.02;
    rationale.push("fresh peer quotes");
  }

  if (String(market.model?.version ?? "").includes("weighted-consensus")) {
    minExpectedValue -= 0.003;
    minConfidence -= 0.015;
    rationale.push("weighted baseline model");
  } else if (!market.model) {
    minExpectedValue += 0.01;
    minConfidence += 0.06;
    rationale.push("consensus fallback only");
  }

  if (marketShape.usedLineNormalization) {
    minExpectedValue -= 0.003;
    rationale.push("equivalent line matching");
  } else if ((market.marketType === "spread" || market.marketType === "totals") && !marketShape.usedLineNormalization) {
    minConfidence += 0.03;
    rationale.push("line market without line support");
  }

  if (hoursToStart !== null && hoursToStart < 1.5) {
    minExpectedValue += 0.012;
    minConfidence += 0.06;
    rationale.push("event starting soon");
  } else if (hoursToStart !== null && hoursToStart < 6) {
    minExpectedValue += 0.006;
    minConfidence += 0.03;
    rationale.push("near-start market");
  } else if (hoursToStart !== null && hoursToStart > 24) {
    minExpectedValue -= 0.002;
    rationale.push("early market window");
  }

  if (history?.isLagging && history.persistenceMinutes >= 15) {
    minExpectedValue -= 0.004;
    minConfidence -= 0.015;
    rationale.push("persistent lag signal");
  }

  if (history?.isSnappingBack) {
    minExpectedValue += 0.01;
    minConfidence += 0.045;
    rationale.push("snap-back risk");
  }

  if (learningProfile?.reliability > 0.15) {
    minExpectedValue += learningProfile.thresholdDeltaEv;
    minConfidence += learningProfile.thresholdDeltaConfidence;
    rationale.push("adaptive threshold profile");
  }

  return {
    minExpectedValue: clamp(Number(minExpectedValue.toFixed(4)), 0.012, 0.065),
    minConfidence: clamp(Number(minConfidence.toFixed(4)), 0.48, 0.82),
    rationale,
  };
}

function scoreRisk({ ev, stakeFraction, confidence, dataQuality, price, history, learningProfile }) {
  const longshotPenalty = price >= 5 ? 2 : price >= 3.5 ? 1 : 0;
  const confidencePenalty = confidence < 0.7 ? 2 : confidence < 0.82 ? 1 : 0;
  const qualityPenalty = dataQuality < 0.65 ? 2 : dataQuality < 0.8 ? 1 : 0;
  const stakePenalty = stakeFraction > 0.015 ? 1 : 0;
  const evPenalty = ev < 0.05 ? 1 : 0;
  const historyPenalty = history?.isSnappingBack ? 2 : 0;
  const learningPenalty = learningProfile && learningProfile.confidenceBoost < 0 ? 1 : 0;
  const penalty = longshotPenalty + confidencePenalty + qualityPenalty + stakePenalty + evPenalty + historyPenalty + learningPenalty;
  const label = penalty <= 2 ? "Low" : penalty <= 4 ? "Medium" : "High";
  return { label, penalty };
}

function buildNotes(market, peerOutcomes, confidence, dataQuality, history, marketShape, learningProfile) {
  const notes = [];
  if (new Set(peerOutcomes.map((outcome) => outcome.normalizedBook)).size < 4) notes.push("thin market");
  if (peerOutcomes.some((outcome) => outcome.isStale)) notes.push("stale peer quote");
  if (marketShape.usedLineNormalization) notes.push("line-normalized consensus");
  if (!market.settlementRules) notes.push("missing settlement rules");
  if (!market.model) notes.push("consensus fallback");
  if (confidence < 0.7) notes.push("model confidence below target");
  if (dataQuality < 0.7) notes.push("data quality review needed");
  if (history?.isLagging) notes.push("bet365 lagging market");
  if (history?.persistenceSamples >= 3) notes.push("persistent edge");
  if (history?.isSnappingBack) notes.push("market snapping back");
  if (history?.leadLag?.lagRate >= 0.45) notes.push("repeatable lead-lag pattern");
  if (learningProfile?.reliability > 0.15 && learningProfile.confidenceBoost > 0) notes.push("positive CLV profile");
  if (learningProfile?.reliability > 0.15 && learningProfile.confidenceBoost < 0) notes.push("weak CLV profile");
  return notes;
}

function buildReasonCodes({ market, peerOutcomes, expectedValue: ev, confidence, thresholds, history }) {
  const reasonCodes = [];
  if (!market.model && peerOutcomes.length < 2) reasonCodes.push("no_reliable_model");
  if (peerOutcomes.length === 0) reasonCodes.push("no_peer_prices");
  if (ev < thresholds.minExpectedValue) reasonCodes.push("ev_below_threshold");
  if (confidence < thresholds.minConfidence) reasonCodes.push("confidence_below_threshold");
  if (history?.isSnappingBack && ev < thresholds.minExpectedValue + 0.012) reasonCodes.push("snapback_risk");
  return reasonCodes;
}

function buildRecommendationScore({ ev, confidence, dataQuality, history, marketShape, risk, learningProfile }) {
  const lagBoost = history?.isLagging ? 3 : 0;
  const persistenceBoost = Math.min((history?.persistenceMinutes ?? 0) / 20, 3);
  const lineBoost = marketShape.usedLineNormalization ? 1.5 : 0;
  const snapbackPenalty = history?.isSnappingBack ? 4 : 0;
  const leadLagBoost = (history?.leadLag?.lagRate ?? 0) * 3;
  const learningBoost = learningProfile?.scoreBoost ?? 0;

  return ev * 100 + confidence * 10 + dataQuality * 6 + lagBoost + persistenceBoost + lineBoost + leadLagBoost + learningBoost - risk.penalty - snapbackPenalty;
}

function applyPortfolioGuardrails(recommendations, settings) {
  const bankroll = Number(settings.bankroll ?? DEFAULT_CONFIG.bankroll);
  const caps = {
    maxTotalExposure: resolveExposureCap(settings.maxTotalExposure, DEFAULT_CONFIG.maxTotalExposure),
    maxEventExposure: resolveExposureCap(settings.maxEventExposure, DEFAULT_CONFIG.maxEventExposure),
    maxSportExposure: resolveExposureCap(settings.maxSportExposure, DEFAULT_CONFIG.maxSportExposure),
  };
  const eventExposure = new Map();
  const sportExposure = new Map();
  let totalExposure = 0;
  let desiredExposure = 0;
  let reducedCount = 0;
  let excludedCount = 0;

  for (const recommendation of recommendations) {
    const desired = clamp(Number(recommendation.stakeFraction ?? 0), 0, Number(settings.maxBankrollStake ?? DEFAULT_CONFIG.maxBankrollStake));
    const eventKey = buildPortfolioEventKey(recommendation);
    const sportKey = String(recommendation.sport ?? "unknown");
    const remaining = {
      total: Math.max(0, caps.maxTotalExposure - totalExposure),
      event: Math.max(0, caps.maxEventExposure - (eventExposure.get(eventKey) ?? 0)),
      sport: Math.max(0, caps.maxSportExposure - (sportExposure.get(sportKey) ?? 0)),
    };
    const adjusted = clamp(Math.min(desired, remaining.total, remaining.event, remaining.sport), 0, desired);
    const capReasons = [];

    desiredExposure += desired;
    if (adjusted < desired - 0.000001) {
      reducedCount += adjusted > 0 ? 1 : 0;
      excludedCount += adjusted > 0 ? 0 : 1;
      if (remaining.total <= adjusted + 0.000001) capReasons.push("total exposure cap");
      if (remaining.event <= adjusted + 0.000001) capReasons.push("event exposure cap");
      if (remaining.sport <= adjusted + 0.000001) capReasons.push("sport exposure cap");
    }

    totalExposure += adjusted;
    eventExposure.set(eventKey, (eventExposure.get(eventKey) ?? 0) + adjusted);
    sportExposure.set(sportKey, (sportExposure.get(sportKey) ?? 0) + adjusted);

    recommendation.unadjustedStakeFraction = Number(desired.toFixed(6));
    recommendation.unadjustedStakeAmount = roundCurrency(bankroll * desired);
    recommendation.stakeFraction = Number(adjusted.toFixed(6));
    recommendation.stakeAmount = roundCurrency(bankroll * adjusted);
    recommendation.portfolio = {
      status: adjusted <= 0 && desired > 0
        ? "watchlist"
        : adjusted < desired
          ? "reduced"
          : "active",
      capReasons,
      desiredStakeFraction: Number(desired.toFixed(6)),
      desiredStakeAmount: roundCurrency(bankroll * desired),
      adjustedStakeFraction: Number(adjusted.toFixed(6)),
      adjustedStakeAmount: roundCurrency(bankroll * adjusted),
      eventExposureFraction: Number((eventExposure.get(eventKey) ?? 0).toFixed(6)),
      sportExposureFraction: Number((sportExposure.get(sportKey) ?? 0).toFixed(6)),
      totalExposureFraction: Number(totalExposure.toFixed(6)),
    };

    if (recommendation.portfolio.status === "reduced") {
      recommendation.notes.push("portfolio stake reduced");
    } else if (recommendation.portfolio.status === "watchlist") {
      recommendation.notes.push("portfolio cap reached");
    }
  }

  return {
    bankroll,
    caps,
    desiredExposureFraction: Number(desiredExposure.toFixed(6)),
    plannedExposureFraction: Number(totalExposure.toFixed(6)),
    desiredStakeAmount: roundCurrency(bankroll * desiredExposure),
    plannedStakeAmount: roundCurrency(bankroll * totalExposure),
    reducedStakeAmount: roundCurrency(bankroll * Math.max(0, desiredExposure - totalExposure)),
    activeCount: recommendations.filter((entry) => entry.portfolio?.status === "active" || entry.portfolio?.status === "reduced").length,
    reducedCount,
    watchlistCount: excludedCount,
    topEventExposures: topExposureEntries(eventExposure, bankroll),
    topSportExposures: topExposureEntries(sportExposure, bankroll),
  };
}

function resolveExposureCap(value, fallback) {
  const cap = Number(value);
  if (!Number.isFinite(cap) || cap <= 0) {
    return fallback;
  }
  return clamp(cap, 0.001, 1);
}

function topExposureEntries(map, bankroll) {
  return [...map.entries()]
    .filter(([, fraction]) => fraction > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, fraction]) => ({
      key,
      fraction: Number(fraction.toFixed(6)),
      amount: roundCurrency(bankroll * fraction),
    }));
}

function buildPortfolioEventKey(recommendation) {
  return [
    recommendation.sport ?? "",
    recommendation.league ?? "",
    recommendation.event ?? "",
    recommendation.commenceTime ? String(recommendation.commenceTime).slice(0, 16) : "",
  ].join("::");
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildDiagnostics(markets, evaluations, crossMarketSummary, portfolioSummary) {
  const reasonCounts = countCodes(evaluations.flatMap((entry) => entry.reasonCodes));
  const warningCounts = countCodes(evaluations.flatMap((entry) => entry.warningCodes));

  return {
    totalMarkets: markets.length,
    totalSelections: evaluations.filter((entry) => entry.recommendation).length,
    acceptedSelections: evaluations.filter((entry) => entry.accepted && entry.recommendation).length,
    rejectedSelections: evaluations.filter((entry) => !entry.accepted).length,
    marketsMissingBet365: evaluations.filter((entry) => entry.reasonCodes.includes("missing_bet365")).length,
    confirmedSelections: crossMarketSummary?.confirmedSelections ?? 0,
    conflictingSelections: crossMarketSummary?.conflictingSelections ?? 0,
    inconsistentEvents: crossMarketSummary?.inconsistentEvents ?? 0,
    portfolioReducedSelections: portfolioSummary?.reducedCount ?? 0,
    portfolioWatchlistSelections: portfolioSummary?.watchlistCount ?? 0,
    reasonCounts,
    warningCounts,
    topReasons: Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([code, count]) => ({ code, count })),
  };
}

function countCodes(codes) {
  return codes.reduce((acc, code) => {
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});
}

function noteToReasonCode(note) {
  return String(note).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function validateSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.markets)) {
    throw new Error("Snapshot must include a markets array.");
  }
}

function isOlderThan(timestamp, referenceTimestamp, minutes) {
  const then = Date.parse(timestamp);
  const reference = Date.parse(referenceTimestamp);
  if (!Number.isFinite(then) || !Number.isFinite(reference)) return true;
  return reference - then > minutes * 60 * 1000;
}

function getHoursToStart(commenceTime, snapshotAt) {
  const start = Date.parse(commenceTime);
  const reference = Date.parse(snapshotAt ?? new Date().toISOString());
  if (!Number.isFinite(start) || !Number.isFinite(reference)) {
    return null;
  }

  return (start - reference) / 3600000;
}

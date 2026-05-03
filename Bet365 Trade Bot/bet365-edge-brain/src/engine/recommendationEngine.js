import {
  clamp,
  decimalToImpliedProbability,
  expectedValue,
  kellyFraction,
  removeVig
} from "./oddsMath.js";

const DEFAULT_CONFIG = {
  bankroll: 1000,
  minExpectedValue: 0.03,
  minConfidence: 0.55,
  maxBankrollStake: 0.02,
  fractionalKelly: 0.25,
  staleMinutes: 8,
  trustedBooks: ["pinnacle", "betfair", "matchbook", "circa", "draftkings", "fanduel"]
};

export function analyzeSnapshot(snapshot, config = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };
  validateSnapshot(snapshot);

  const recommendations = snapshot.markets.flatMap((market) => analyzeMarket(market, settings));
  const filtered = recommendations
    .filter((rec) => rec.expectedValue >= settings.minExpectedValue)
    .filter((rec) => rec.confidence >= settings.minConfidence)
    .sort((a, b) => b.score - a.score);

  return {
    generatedAt: new Date().toISOString(),
    sourceSnapshotAt: snapshot.snapshotAt,
    settings,
    totalMarkets: snapshot.markets.length,
    totalCandidates: recommendations.length,
    recommendations: filtered
  };
}

export function analyzeMarket(market, settings = DEFAULT_CONFIG) {
  const bet365Book = market.books.find((book) => normalizeBook(book.name) === "bet365");
  if (!bet365Book) {
    return [];
  }

  return bet365Book.outcomes.map((bet365Outcome) => {
    const peerOutcomes = collectPeerOutcomes(market, bet365Outcome.name, settings);
    const consensus = buildConsensus(peerOutcomes, settings);
    const modelProbability = chooseModelProbability(market, bet365Outcome.name, consensus.noVigProbability);
    const ev = expectedValue(modelProbability, bet365Outcome.price);
    const rawKelly = kellyFraction(modelProbability, bet365Outcome.price);
    const stakeFraction = clamp(rawKelly * settings.fractionalKelly, 0, settings.maxBankrollStake);
    const dataQuality = scoreDataQuality(market, peerOutcomes, settings);
    const confidence = clamp((dataQuality + Number(market.model?.confidence ?? 0.5)) / 2, 0, 1);
    const risk = scoreRisk({ ev, stakeFraction, confidence, dataQuality, price: bet365Outcome.price });

    return {
      id: `${market.id}:${bet365Outcome.name}`,
      sport: market.sport,
      league: market.league,
      event: market.event,
      marketType: market.marketType,
      selection: bet365Outcome.name,
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
      score: ev * 100 + confidence * 10 - risk.penalty,
      peerBookCount: peerOutcomes.length,
      staleBookCount: peerOutcomes.filter((outcome) => outcome.isStale).length,
      notes: buildNotes(market, peerOutcomes, confidence, dataQuality)
    };
  });
}

function collectPeerOutcomes(market, selectionName, settings) {
  return market.books
    .filter((book) => normalizeBook(book.name) !== "bet365")
    .flatMap((book) => {
      const noVigMarket = removeVig(book.outcomes);
      return noVigMarket
        .filter((outcome) => outcome.name === selectionName)
        .map((outcome) => ({
        ...outcome,
        book: book.name,
        normalizedBook: normalizeBook(book.name),
        updatedAt: book.updatedAt,
        isStale: isOlderThan(book.updatedAt, market.snapshotAt, settings.staleMinutes)
      }));
    });
}

function buildConsensus(peerOutcomes, settings) {
  if (peerOutcomes.length === 0) {
    return {
      noVigProbability: 0,
      fairDecimal: Infinity,
      overround: 0
    };
  }

  const weightedProbabilities = peerOutcomes.map((outcome) => ({
    probability: outcome.noVigProbability,
    weight: settings.trustedBooks.includes(outcome.normalizedBook) ? 1.25 : 1
  }));

  const noVigProbability = weightedProbabilities.reduce((sum, outcome) => (
    sum + outcome.probability * outcome.weight
  ), 0) / weightedProbabilities.reduce((sum, outcome) => sum + outcome.weight, 0);

  return {
    noVigProbability,
    fairDecimal: 1 / clamp(noVigProbability, 0.001, 0.999),
    overround: null
  };
}

function chooseModelProbability(market, selectionName, consensusProbability) {
  const modelPick = market.model?.probabilities?.find((entry) => entry.name === selectionName);
  if (modelPick && Number.isFinite(modelPick.probability)) {
    return clamp(modelPick.probability, 0.001, 0.999);
  }
  return clamp(consensusProbability, 0.001, 0.999);
}

function scoreDataQuality(market, peerOutcomes, settings) {
  const bookDepth = clamp(peerOutcomes.length / 6, 0, 1);
  const freshness = 1 - clamp(peerOutcomes.filter((outcome) => outcome.isStale).length / Math.max(peerOutcomes.length, 1), 0, 1);
  const modelFreshness = isOlderThan(market.snapshotAt, new Date().toISOString(), settings.staleMinutes) ? 0.45 : 1;
  const settlementRisk = market.settlementRules ? 1 : 0.7;
  return clamp(bookDepth * 0.35 + freshness * 0.3 + modelFreshness * 0.2 + settlementRisk * 0.15, 0, 1);
}

function scoreRisk({ ev, stakeFraction, confidence, dataQuality, price }) {
  const longshotPenalty = price >= 5 ? 2 : price >= 3.5 ? 1 : 0;
  const confidencePenalty = confidence < 0.7 ? 2 : confidence < 0.82 ? 1 : 0;
  const qualityPenalty = dataQuality < 0.65 ? 2 : dataQuality < 0.8 ? 1 : 0;
  const stakePenalty = stakeFraction > 0.015 ? 1 : 0;
  const evPenalty = ev < 0.05 ? 1 : 0;
  const penalty = longshotPenalty + confidencePenalty + qualityPenalty + stakePenalty + evPenalty;
  const label = penalty <= 2 ? "Low" : penalty <= 4 ? "Medium" : "High";
  return { label, penalty };
}

function buildNotes(market, peerOutcomes, confidence, dataQuality) {
  const notes = [];
  if (peerOutcomes.length < 4) notes.push("thin market");
  if (peerOutcomes.some((outcome) => outcome.isStale)) notes.push("stale peer quote");
  if (!market.settlementRules) notes.push("missing settlement rules");
  if (confidence < 0.7) notes.push("model confidence below target");
  if (dataQuality < 0.7) notes.push("data quality review needed");
  return notes;
}

function validateSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.markets)) {
    throw new Error("Snapshot must include a markets array.");
  }
}

function normalizeBook(bookName) {
  return String(bookName).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isOlderThan(timestamp, referenceTimestamp, minutes) {
  const then = Date.parse(timestamp);
  const reference = Date.parse(referenceTimestamp);
  if (!Number.isFinite(then) || !Number.isFinite(reference)) return true;
  return reference - then > minutes * 60 * 1000;
}

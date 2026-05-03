import { clamp, removeVig } from "./oddsMath.js";

const TEAM_TOKEN_STOPWORDS = new Set([
  "fc",
  "cf",
  "club",
  "sc",
  "ac",
  "bk",
  "bc",
  "afc",
]);

const BOOK_SHARPNESS_WEIGHTS = {
  pinnacle: 1.4,
  betfair: 1.34,
  matchbook: 1.3,
  circa: 1.28,
  lowvig: 1.2,
  draftkings: 1.1,
  fanduel: 1.08,
  espnbet: 1.03,
  betmgm: 1.02,
  caesars: 1,
  betrivers: 0.98,
  unibet: 0.97,
  williamhill: 0.96,
  bet365: 0.95,
};

const LINE_SENSITIVITY = {
  spread: {
    default: 0.022,
    basketball: 0.028,
    americanfootball: 0.035,
    football: 0.035,
    baseball: 0.012,
    icehockey: 0.018,
    hockey: 0.018,
  },
  totals: {
    default: 0.014,
    basketball: 0.017,
    americanfootball: 0.021,
    football: 0.021,
    baseball: 0.01,
    icehockey: 0.012,
    hockey: 0.012,
  },
};

const MAX_LINE_DELTA = {
  spread: {
    default: 4,
    basketball: 5,
    americanfootball: 6,
    football: 6,
    baseball: 2,
    icehockey: 2.5,
    hockey: 2.5,
  },
  totals: {
    default: 6,
    basketball: 9,
    americanfootball: 10,
    football: 10,
    baseball: 3,
    icehockey: 3,
    hockey: 3,
  },
};

export function normalizeBookName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeMarketType(marketType) {
  const normalized = canonicalizeText(marketType);
  if (normalized === "spreads") return "spread";
  if (normalized === "totals") return "totals";
  if (normalized === "h2h") return "moneyline";
  return normalized;
}

export function isLineMarket(marketOrType) {
  const marketType = typeof marketOrType === "string"
    ? normalizeMarketType(marketOrType)
    : normalizeMarketType(marketOrType?.marketType);
  return marketType === "spread" || marketType === "totals";
}

export function canonicalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bst[.]?\b/g, "saint")
    .replace(/\butd\b/g, "united")
    .replace(/[^\w\s+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeTeamName(name) {
  return tokenizeTeamName(name).join(" ");
}

export function getMarketParticipants(market) {
  const parsed = parseEventParticipants(market?.event);
  return {
    homeTeam: market?.homeTeam ?? parsed.homeTeam ?? null,
    awayTeam: market?.awayTeam ?? parsed.awayTeam ?? null,
  };
}

export function buildMarketIdentity(market) {
  const { homeTeam, awayTeam } = getMarketParticipants(market);
  return {
    marketKey: [
      canonicalizeText(market?.sport),
      canonicalizeText(market?.league),
      canonicalizeTeamName(homeTeam),
      canonicalizeTeamName(awayTeam),
      normalizeMarketType(market?.marketType),
      market?.commenceTime ? String(market.commenceTime).slice(0, 16) : "",
    ].join("::"),
    homeTeam,
    awayTeam,
  };
}

export function normalizeOutcomeDescriptor(market, outcome) {
  const marketType = normalizeMarketType(market?.marketType);
  const { homeTeam, awayTeam } = getMarketParticipants(market);
  const normalizedName = canonicalizeText(outcome?.name);
  const point = Number.isFinite(Number(outcome?.point))
    ? roundLine(Number(outcome.point))
    : null;

  let role = "selection";
  let canonicalName = String(outcome?.name ?? "").trim();

  if (marketType === "totals") {
    if (isOverOutcome(normalizedName)) {
      role = "over";
      canonicalName = "Over";
    } else if (isUnderOutcome(normalizedName)) {
      role = "under";
      canonicalName = "Under";
    }
  } else if (normalizedName === "draw" || normalizedName === "tie" || normalizedName === "x") {
    role = "draw";
    canonicalName = "Draw";
  } else {
    const entityRole = inferEntityRole(String(outcome?.name ?? ""), market, homeTeam, awayTeam);
    if (entityRole === "home") {
      role = "home";
      canonicalName = homeTeam ?? canonicalName;
    } else if (entityRole === "away") {
      role = "away";
      canonicalName = awayTeam ?? canonicalName;
    } else if (normalizedName === "home") {
      role = "home";
      canonicalName = homeTeam ?? "Home";
    } else if (normalizedName === "away") {
      role = "away";
      canonicalName = awayTeam ?? "Away";
    }
  }

  const groupKey = isLineMarket(marketType)
    ? role
    : canonicalizeText(canonicalName || outcome?.name || "selection");
  const lineKey = point === null ? "" : `:${formatLineKey(point)}`;
  const selectionKey = `${groupKey}${lineKey}`;

  return {
    marketType,
    name: String(outcome?.name ?? ""),
    canonicalName,
    normalizedName,
    role,
    point,
    groupKey,
    selectionKey,
    isLineMarket: isLineMarket(marketType),
  };
}

export function collectComparableOutcomes(market, targetOutcome, {
  sourceBook = "bet365",
  staleMinutes = 8,
} = {}) {
  const target = normalizeOutcomeDescriptor(market, targetOutcome);
  const sourceBookKey = normalizeBookName(sourceBook);

  return (market?.books ?? [])
    .filter((book) => normalizeBookName(book.name) !== sourceBookKey)
    .flatMap((book) => {
      let noVigOutcomes;
      try {
        noVigOutcomes = removeVig(book.outcomes ?? []);
      } catch {
        return [];
      }

      const candidates = noVigOutcomes
        .map((outcome) => ({
          ...outcome,
          descriptor: normalizeOutcomeDescriptor(market, outcome),
        }))
        .filter((outcome) => areComparableDescriptors(target, outcome.descriptor));

      if (candidates.length === 0) {
        return [];
      }

      const selected = pickClosestComparable(target, candidates, market);
      if (!selected) {
        return [];
      }

      const probability = projectProbabilityToTargetLine({
        market,
        role: selected.descriptor.role,
        sourcePoint: selected.descriptor.point,
        targetPoint: target.point,
        probability: selected.noVigProbability,
      });
      const lineDistance = calculateLineDistance(selected.descriptor.point, target.point);
      const equivalenceWeight = calculateEquivalenceWeight(market, selected.descriptor.point, target.point);
      if (equivalenceWeight <= 0) {
        return [];
      }

      return [{
        ...selected,
        book: book.name,
        normalizedBook: normalizeBookName(book.name),
        updatedAt: book.updatedAt,
        isStale: isOlderThan(book.updatedAt, market?.snapshotAt, staleMinutes),
        probability,
        lineDistance,
        equivalenceWeight,
        target,
        matchedLine: selected.descriptor.point,
        matchedName: selected.name,
      }];
    });
}

export function buildWeightedConsensus(peerOutcomes, {
  snapshotAt,
  agreementHistory = {},
} = {}) {
  if (!peerOutcomes.length) {
    return {
      noVigProbability: 0.5,
      fairDecimal: 2,
      weightSum: 0,
      contributors: 0,
      agreementScore: 0,
      freshnessScore: 0,
    };
  }

  let weightedProbability = 0;
  let weightSum = 0;
  let freshnessWeighted = 0;
  let agreementWeighted = 0;

  for (const outcome of peerOutcomes) {
    const sharpnessWeight = getSharpnessWeight(outcome.normalizedBook);
    const freshnessWeight = getRecencyWeight(outcome.updatedAt, snapshotAt);
    const agreementWeight = getAgreementWeight(agreementHistory?.[outcome.normalizedBook]);
    const equivalenceWeight = clamp(Number(outcome.equivalenceWeight ?? 1), 0.1, 1);
    const combinedWeight = sharpnessWeight * freshnessWeight * agreementWeight * equivalenceWeight;

    weightedProbability += outcome.probability * combinedWeight;
    weightSum += combinedWeight;
    freshnessWeighted += freshnessWeight * combinedWeight;
    agreementWeighted += agreementWeight * combinedWeight;
  }

  if (weightSum <= 0) {
    return {
      noVigProbability: 0.5,
      fairDecimal: 2,
      weightSum: 0,
      contributors: peerOutcomes.length,
      agreementScore: 0,
      freshnessScore: 0,
    };
  }

  const noVigProbability = clamp(weightedProbability / weightSum, 0.001, 0.999);

  return {
    noVigProbability,
    fairDecimal: 1 / noVigProbability,
    weightSum,
    contributors: peerOutcomes.length,
    agreementScore: clamp(agreementWeighted / weightSum, 0, 1.3),
    freshnessScore: clamp(freshnessWeighted / weightSum, 0, 1),
  };
}

export function getSharpnessWeight(bookName) {
  return BOOK_SHARPNESS_WEIGHTS[normalizeBookName(bookName)] ?? 0.92;
}

export function describeMarketShape(market, targetOutcome, peerOutcomes) {
  const descriptor = normalizeOutcomeDescriptor(market, targetOutcome);
  const lineDistances = peerOutcomes
    .map((outcome) => Number(outcome.lineDistance ?? 0))
    .filter((value) => Number.isFinite(value));
  const averageDistance = lineDistances.length
    ? lineDistances.reduce((sum, value) => sum + value, 0) / lineDistances.length
    : 0;

  return {
    role: descriptor.role,
    targetLine: descriptor.point,
    equivalentLineCount: lineDistances.filter((distance) => distance > 0).length,
    averageLineDistance: Number(averageDistance.toFixed(3)),
    usedLineNormalization: descriptor.isLineMarket && lineDistances.some((distance) => distance > 0),
  };
}

function inferEntityRole(name, market, homeTeam, awayTeam) {
  const candidateTokens = tokenizeTeamName(name);
  if (!candidateTokens.length) return "selection";

  const homeTokens = tokenizeTeamName(homeTeam);
  const awayTokens = tokenizeTeamName(awayTeam);
  const homeScore = scoreTokenOverlap(candidateTokens, homeTokens);
  const awayScore = scoreTokenOverlap(candidateTokens, awayTokens);

  if (homeScore >= 0.6 && homeScore > awayScore) return "home";
  if (awayScore >= 0.6 && awayScore > homeScore) return "away";

  const eventText = canonicalizeText(market?.event);
  if (homeScore >= 0.34 && homeScore > awayScore && eventText.includes(candidateTokens[0])) return "home";
  if (awayScore >= 0.34 && awayScore > homeScore && eventText.includes(candidateTokens[0])) return "away";

  return "selection";
}

function areComparableDescriptors(target, candidate) {
  if (target.isLineMarket !== candidate.isLineMarket) {
    return false;
  }

  if (target.isLineMarket) {
    return target.role === candidate.role;
  }

  return target.groupKey === candidate.groupKey;
}

function pickClosestComparable(target, candidates, market) {
  if (!target.isLineMarket) {
    return candidates[0] ?? null;
  }

  const maxDelta = getSportSpecificValue(MAX_LINE_DELTA, market, 0);
  const ranked = [...candidates]
    .map((candidate) => ({
      candidate,
      distance: calculateLineDistance(candidate.descriptor.point, target.point),
    }))
    .filter((entry) => entry.distance <= maxDelta)
    .sort((a, b) => a.distance - b.distance);

  return ranked[0]?.candidate ?? null;
}

function projectProbabilityToTargetLine({ market, role, sourcePoint, targetPoint, probability }) {
  if (!isLineMarket(market) || sourcePoint === null || targetPoint === null || sourcePoint === targetPoint) {
    return clamp(Number(probability), 0.001, 0.999);
  }

  const sensitivity = getSportSpecificValue(LINE_SENSITIVITY, market, 0.014);
  const delta = targetPoint - sourcePoint;
  let adjusted = Number(probability);

  if (normalizeMarketType(market?.marketType) === "totals") {
    adjusted += (role === "under" ? 1 : -1) * delta * sensitivity;
  } else {
    adjusted += delta * sensitivity;
  }

  return clamp(adjusted, 0.001, 0.999);
}

function calculateEquivalenceWeight(market, sourcePoint, targetPoint) {
  if (!isLineMarket(market) || sourcePoint === null || targetPoint === null) {
    return 1;
  }

  const delta = calculateLineDistance(sourcePoint, targetPoint);
  if (delta === 0) {
    return 1;
  }

  const maxDelta = getSportSpecificValue(MAX_LINE_DELTA, market, 0);
  if (delta > maxDelta) {
    return 0;
  }

  return clamp(1 - delta / (maxDelta * 1.15), 0.2, 0.96);
}

function getRecencyWeight(updatedAt, snapshotAt) {
  const updated = Date.parse(updatedAt);
  const snapshot = Date.parse(snapshotAt);
  if (!Number.isFinite(updated) || !Number.isFinite(snapshot)) {
    return 0.55;
  }

  const ageMinutes = Math.max(0, (snapshot - updated) / 60000);
  return clamp(1 - ageMinutes / 18, 0.35, 1);
}

function getAgreementWeight(history) {
  if (!history || !Number.isFinite(history.samples) || history.samples < 3) {
    return 0.95;
  }

  const meanError = Number(history.meanAbsoluteError ?? 0.1);
  const stability = Number(history.stability ?? 0.5);
  return clamp(1.18 - meanError * 3.2 + stability * 0.12, 0.72, 1.22);
}

function calculateLineDistance(sourcePoint, targetPoint) {
  if (sourcePoint === null || targetPoint === null) {
    return 0;
  }
  return Math.abs(roundLine(sourcePoint) - roundLine(targetPoint));
}

function getSportSpecificValue(table, market, fallback) {
  const marketType = normalizeMarketType(market?.marketType);
  const sport = canonicalizeText(market?.sport);
  return table?.[marketType]?.[sport] ?? table?.[marketType]?.default ?? fallback;
}

function tokenizeTeamName(name) {
  return canonicalizeText(name)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !TEAM_TOKEN_STOPWORDS.has(token));
}

function parseEventParticipants(eventName) {
  const raw = String(eventName ?? "");
  const separators = [" vs ", " v ", " @ ", " at "];

  for (const separator of separators) {
    const index = raw.toLowerCase().indexOf(separator);
    if (index > 0) {
      return {
        homeTeam: raw.slice(0, index).trim(),
        awayTeam: raw.slice(index + separator.length).trim(),
      };
    }
  }

  return { homeTeam: null, awayTeam: null };
}

function scoreTokenOverlap(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) {
    return 0;
  }

  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let matches = 0;
  for (const token of a) {
    if (b.has(token)) {
      matches += 1;
    }
  }

  if (matches === 0) {
    const aCompact = aTokens.join("");
    const bCompact = bTokens.join("");
    if (aCompact && bCompact && (aCompact.includes(bCompact) || bCompact.includes(aCompact))) {
      return 0.75;
    }
    return 0;
  }

  const baseScore = matches / Math.max(Math.min(a.size, b.size), 1);
  const aLast = aTokens.at(-1);
  const bLast = bTokens.at(-1);
  const aPrefixInitials = aTokens.slice(0, -1).map((token) => token[0]).join("");
  const bPrefixInitials = bTokens.slice(0, -1).map((token) => token[0]).join("");

  if (aLast && bLast && aLast === bLast && aPrefixInitials && bPrefixInitials && aPrefixInitials === bPrefixInitials) {
    return Math.max(baseScore, 0.88);
  }

  return baseScore;
}

function isOverOutcome(normalizedName) {
  return normalizedName === "over" || normalizedName.startsWith("over ");
}

function isUnderOutcome(normalizedName) {
  return normalizedName === "under" || normalizedName.startsWith("under ");
}

function isOlderThan(timestamp, referenceTimestamp, minutes) {
  const then = Date.parse(timestamp);
  const reference = Date.parse(referenceTimestamp);
  if (!Number.isFinite(then) || !Number.isFinite(reference)) return true;
  return reference - then > minutes * 60 * 1000;
}

function roundLine(line) {
  return Math.round(Number(line) * 1000) / 1000;
}

function formatLineKey(line) {
  const rounded = roundLine(line);
  return Number.isInteger(rounded) ? `${rounded}.0` : String(rounded);
}

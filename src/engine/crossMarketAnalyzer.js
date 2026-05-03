import { clamp } from "./oddsMath.js";

export function applyCrossMarketContext(snapshot, evaluations) {
  const eventModels = buildEventModels(snapshot);
  const eventEntries = new Map();

  for (const entry of evaluations) {
    if (!entry.recommendation) {
      continue;
    }

    const eventKey = buildEventKey(entry.recommendation);
    if (!eventEntries.has(eventKey)) {
      eventEntries.set(eventKey, []);
    }
    eventEntries.get(eventKey).push(entry);
  }

  const summary = {
    confirmedSelections: 0,
    conflictingSelections: 0,
    inconsistentEvents: 0,
  };

  for (const [eventKey, entries] of eventEntries.entries()) {
    const supportByRole = {};
    const eventModel = eventModels.get(eventKey);
    const roleMarketTypes = new Map();

    for (const entry of entries) {
      const recommendation = entry.recommendation;
      if (!recommendation || !isSideSelection(recommendation.selectionRole)) {
        continue;
      }

      const key = `${recommendation.selectionRole}::${recommendation.marketType}`;
      roleMarketTypes.set(key, true);
      supportByRole[recommendation.selectionRole] = supportByRole[recommendation.selectionRole] ?? new Set();
      supportByRole[recommendation.selectionRole].add(recommendation.marketType);
    }

    const eventConsistencyScore = scoreEventConsistency(eventModel);
    if (eventConsistencyScore < 0) {
      summary.inconsistentEvents += 1;
    }

    for (const entry of entries) {
      const recommendation = entry.recommendation;
      if (!recommendation) {
        continue;
      }

      const supportCount = isSideSelection(recommendation.selectionRole)
        ? Math.max(0, (supportByRole[recommendation.selectionRole]?.size ?? 0) - 1)
        : 0;
      const conflictCount = isSideSelection(recommendation.selectionRole)
        ? countRoleConflicts(recommendation, supportByRole)
        : 0;
      const scoreAdjustment = supportCount * 1.4 + eventConsistencyScore * 2.2 - conflictCount * 1.5;
      const confidenceAdjustment = supportCount * 0.025 + eventConsistencyScore * 0.05 - conflictCount * 0.03;

      recommendation.crossMarket = {
        supportCount,
        conflictCount,
        consistencyScore: Number(eventConsistencyScore.toFixed(3)),
        eventFavoriteAlignment: eventModel?.favoriteAlignment ?? null,
      };

      recommendation.confidence = clamp(recommendation.confidence + confidenceAdjustment, 0, 1);
      recommendation.score = Number((recommendation.score + scoreAdjustment).toFixed(4));

      if (supportCount > 0) {
        recommendation.notes.push("multi-market confirmation");
        summary.confirmedSelections += 1;
      }

      if (eventConsistencyScore < 0) {
        recommendation.notes.push("event market mismatch");
      }

      if (conflictCount > 0) {
        recommendation.notes.push("cross-market conflict");
        summary.conflictingSelections += 1;
        if (recommendation.confidence < (recommendation.thresholds?.minConfidence ?? 0) + 0.03) {
          entry.reasonCodes.push("cross_market_conflict");
          entry.accepted = false;
        }
      }

      entry.warningCodes = recommendation.notes.map(noteToReasonCode);
    }
  }

  return summary;
}

function buildEventModels(snapshot) {
  const byEvent = new Map();

  for (const market of snapshot?.markets ?? []) {
    const key = buildEventKey(market);
    const model = byEvent.get(key) ?? {};

    if (market.marketType === "moneyline" || market.marketType === "1x2" || market.marketType === "match winner") {
      const favorite = pickFavoriteOutcome(market);
      if (favorite) {
        model.moneylineFavorite = favorite.selectionRole;
      }
    }

    if (market.marketType === "spread") {
      const favorite = pickSpreadFavorite(market);
      if (favorite) {
        model.spreadFavorite = favorite;
      }
    }

    model.favoriteAlignment = model.moneylineFavorite && model.spreadFavorite
      ? model.moneylineFavorite === model.spreadFavorite
      : null;

    byEvent.set(key, model);
  }

  return byEvent;
}

function pickFavoriteOutcome(market) {
  const entries = market.model?.probabilities ?? [];
  const ordered = [...entries].sort((a, b) => Number(b.probability ?? 0) - Number(a.probability ?? 0));
  const best = ordered[0];
  if (!best?.canonicalKey) {
    return null;
  }

  if (best.canonicalKey.startsWith("home")) return { selectionRole: "home" };
  if (best.canonicalKey.startsWith("away")) return { selectionRole: "away" };
  return null;
}

function pickSpreadFavorite(market) {
  const outcomes = market.books?.find((book) => String(book.name).toLowerCase() === "bet365")?.outcomes ?? [];
  if (!outcomes.length) {
    return null;
  }

  const sorted = [...outcomes]
    .filter((outcome) => Number.isFinite(Number(outcome.point)))
    .sort((a, b) => Number(a.point) - Number(b.point));
  const favorite = sorted[0];
  if (!favorite) {
    return null;
  }

  return Number(favorite.point) < 0 ? inferRoleFromName(favorite.name, market) : null;
}

function inferRoleFromName(name, market) {
  if (name === market.homeTeam) return "home";
  if (name === market.awayTeam) return "away";
  return null;
}

function scoreEventConsistency(eventModel) {
  if (!eventModel) {
    return 0;
  }

  if (eventModel.favoriteAlignment === true) {
    return 0.18;
  }

  if (eventModel.favoriteAlignment === false) {
    return -0.16;
  }

  return 0;
}

function countRoleConflicts(recommendation, supportByRole) {
  const oppositeRole = recommendation.selectionRole === "home"
    ? "away"
    : recommendation.selectionRole === "away"
      ? "home"
      : null;
  if (!oppositeRole) {
    return 0;
  }

  return supportByRole[oppositeRole]?.size ? 1 : 0;
}

function buildEventKey(subject) {
  return [
    subject.sport ?? "",
    subject.league ?? "",
    subject.event ?? "",
    subject.commenceTime ? String(subject.commenceTime).slice(0, 16) : "",
  ].join("::");
}

function isSideSelection(selectionRole) {
  return selectionRole === "home" || selectionRole === "away";
}

function noteToReasonCode(note) {
  return String(note).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

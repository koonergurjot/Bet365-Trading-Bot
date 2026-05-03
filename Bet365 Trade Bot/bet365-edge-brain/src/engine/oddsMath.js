export function decimalToImpliedProbability(decimalOdds) {
  const odds = Number(decimalOdds);
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new Error(`Decimal odds must be greater than 1. Received: ${decimalOdds}`);
  }
  return 1 / odds;
}

export function impliedProbabilityToDecimal(probability) {
  const probabilityNumber = Number(probability);
  if (!Number.isFinite(probabilityNumber) || probabilityNumber <= 0 || probabilityNumber >= 1) {
    throw new Error(`Probability must be between 0 and 1. Received: ${probability}`);
  }
  return 1 / probabilityNumber;
}

export function americanToDecimal(americanOdds) {
  const odds = Number(americanOdds);
  if (!Number.isFinite(odds) || odds === 0) {
    throw new Error(`American odds must be a non-zero number. Received: ${americanOdds}`);
  }
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

export function decimalToAmerican(decimalOdds) {
  const odds = Number(decimalOdds);
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new Error(`Decimal odds must be greater than 1. Received: ${decimalOdds}`);
  }
  return odds >= 2 ? Math.round((odds - 1) * 100) : Math.round(-100 / (odds - 1));
}

export function removeVig(outcomes) {
  const implied = outcomes.map((outcome) => ({
    ...outcome,
    impliedProbability: decimalToImpliedProbability(outcome.price)
  }));
  const overround = implied.reduce((sum, outcome) => sum + outcome.impliedProbability, 0);
  if (overround <= 0) {
    throw new Error("Cannot remove vig from an empty or invalid market.");
  }
  return implied.map((outcome) => ({
    ...outcome,
    noVigProbability: outcome.impliedProbability / overround,
    fairDecimal: impliedProbabilityToDecimal(outcome.impliedProbability / overround),
    overround
  }));
}

export function expectedValue(probability, decimalOdds) {
  const probabilityNumber = Number(probability);
  const odds = Number(decimalOdds);
  if (!Number.isFinite(probabilityNumber) || probabilityNumber < 0 || probabilityNumber > 1) {
    throw new Error(`Probability must be between 0 and 1. Received: ${probability}`);
  }
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new Error(`Decimal odds must be greater than 1. Received: ${decimalOdds}`);
  }
  return probabilityNumber * odds - 1;
}

export function kellyFraction(probability, decimalOdds) {
  const odds = Number(decimalOdds);
  const probabilityNumber = Number(probability);
  const netOdds = odds - 1;
  const fraction = (probabilityNumber * odds - 1) / netOdds;
  return Math.max(0, fraction);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

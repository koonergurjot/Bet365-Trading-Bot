import { collectComparableOutcomes, normalizeBookName } from './marketNormalizer.js';

// Independent of the legacy ranking: never let a heuristic score authorize a bet.
export function attachResearchEvidence(snapshot, recommendations, settings) {
  const now = Date.parse(settings.now ?? new Date().toISOString());
  const maxAge = settings.staleMinutes * 60000;
  const fresh = (value) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && Number.isFinite(now) && now - time >= -30000 && now - time <= maxAge;
  };
  for (const pick of recommendations) {
    const market = snapshot.markets.find(entry => entry.id === pick.marketId);
    const targetBook = settings.targetBook ?? 'Bet365';
    const book = market.books.find(entry => normalizeBookName(entry.name) === normalizeBookName(targetBook));
    const outcome = book?.outcomes.find(entry => entry.name === pick.selection && (pick.line == null || Number(entry.point ?? entry.line) === pick.line));
    const peers = outcome ? collectComparableOutcomes(market, outcome, {sourceBook:normalizeBookName(targetBook),staleMinutes:settings.staleMinutes}) : [];
    const freshPeers = peers.filter(peer => fresh(peer.updatedAt));
    const validation = market.model?.validation;
    const validated = validation?.status === 'passed' && validation.outOfSample === true && validation.sampleSize >= 500 && Number.isFinite(validation.brierScore) && validation.brierScore >= 0 && validation.brierScore <= 1 && Boolean(validation.reportId);
    const reasons = [];
    if (typeof snapshot.provider !== 'string' || !snapshot.provider.trim() || /unknown/i.test(snapshot.provider)) reasons.push('unknown_source');
    if (!fresh(snapshot.snapshotAt) || !fresh(market.snapshotAt)) reasons.push('stale_snapshot');
    if (!fresh(book?.updatedAt)) reasons.push('stale_or_invalid_target_quote');
    if (new Set(freshPeers.map(peer => peer.normalizedBook)).size < 3) reasons.push('insufficient_fresh_peers');
    if (!Number.isFinite(Date.parse(market.commenceTime)) || Date.parse(market.commenceTime) <= now) reasons.push('event_started_or_unknown');
    if (!validated) reasons.push('model_not_validated');
    if (!market.settlementRules || market.settlementRulesVerified !== true) reasons.push('settlement_rules_unverified');
    if (market.jurisdictionVerified !== true) reasons.push('jurisdiction_unverified');
    if (/sample|demo/i.test(snapshot.provider ?? '') || snapshot.isDemo === true) reasons.push('demo_data');
    if (!(Number.isFinite(pick.modelProbability) && pick.modelProbability > 0 && pick.modelProbability < 1 && Number.isFinite(pick.bet365Decimal) && pick.bet365Decimal > 1)) reasons.push('invalid_probability_or_price');
    if (!(pick.expectedValue > 0)) reasons.push('nonpositive_expected_value');
    const components = {
      value: Math.max(0, Math.min(1, pick.expectedValue / 0.10)) * 40,
      confidence: Math.max(0, Math.min(1, pick.confidence)) * 30,
      quality: Math.max(0, Math.min(1, pick.dataQuality)) * 30,
    };
    pick.targetBook = targetBook;
    pick.offeredDecimal = pick.bet365Decimal;
    pick.researchScore = Math.round(Object.values(components).reduce((sum, value) => sum + value, 0));
    pick.blockReasons = reasons;
    pick.actionable = reasons.length === 0;
    pick.actionableStakeAmount = pick.actionable ? pick.stakeAmount : 0;
    pick.evidence = {
      formula:'p * decimalOdds - 1',
      impliedProbability:pick.bet365ImpliedProbability,
      modelProbability:pick.modelProbability,
      consensusProbability:pick.consensusProbability,
      modelSource:pick.modelSource,
      validationStatus:validated ? 'Declared validation; inspect report' : 'Not validated',
      validationReportId: validation?.reportId ?? null,
      scoreComponents:components,
      scoreMeaning:'Heuristic research priority, not win probability or proof of profit',
      quoteUpdatedAt:book?.updatedAt ?? null,
      peers:peers.map(peer => ({book:peer.book,decimal:peer.price,noVigProbability:peer.probability,updatedAt:peer.updatedAt,fresh:fresh(peer.updatedAt),lineDistance:peer.lineDistance})),
    };
  }
  return recommendations.filter(pick => pick.actionable);
}

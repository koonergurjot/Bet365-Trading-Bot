/** Pure, observation-only coverage summary. Never infers plan or eligibility. */
const ELIGIBILITY = 'Unverified · Canada / Ontario labels do not establish provincial eligibility';
const MAX_AGE_MINUTES = 8;
function ageMinutes(timestamp, now) {
  const time = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  const age = (now - time) / 60000;
  return Number.isFinite(age) && age >= 0 ? age : null;
}

export function summarizeConnectionCoverage(status, {now = Date.now(), sport = 'soccer_epl'} = {}) {
  const provider = status?.providers?.oddsApi;
  const verification = provider?.verification;
  let state = provider?.configured === true ? verification?.state ?? 'not_checked' : 'unconfigured';
  const checkedAge = ageMinutes(verification?.checkedAt, now);
  if (!['unconfigured','not_checked','verified','failed','stale'].includes(state)) state = 'invalid';
  if (['verified','stale'].includes(state)) {
    const validBooks = Array.isArray(verification.books) && verification.books.every(book =>
      book && typeof book.key === 'string' && typeof book.title === 'string' &&
      Number.isInteger(book.quoteCount) && book.quoteCount >= 0 &&
      Number.isInteger(book.freshQuoteCount) && book.freshQuoteCount >= 0 && book.freshQuoteCount <= book.quoteCount);
    if (verification.sport !== sport) state = 'not_checked';
    else if (checkedAge === null || verification.region !== 'ca' || verification.market !== 'h2h' ||
      !Number.isInteger(verification.eventCount) || verification.eventCount < 0 || !validBooks ||
      (verification.eventCount === 0 && verification.books.length > 0) || verification.error) state = 'invalid';
    else if (checkedAge > MAX_AGE_MINUTES) state = 'stale';
  }
  const books = (['verified','stale'].includes(state) && Array.isArray(verification?.books) ? verification.books : []).map(book => {
    const age = ageMinutes(book.lastUpdate, now);
    const freshness = age === null ? 'Invalid / missing timestamp' : age > MAX_AGE_MINUTES ? 'Stale' : 'Recent';
    return { key:book.key, title:book.title, quoteCount:book.quoteCount,
      freshQuoteCount:state === 'verified' && freshness === 'Recent' ? book.freshQuoteCount : 0,
      lastUpdate:book.lastUpdate, ageMinutes:age, freshness, eligibility:ELIGIBILITY };
  });
  return {state, configured:provider?.configured === true, feedVerified:state === 'verified', books,
    sport, eventCount:verification?.eventCount ?? null, checkedAt:verification?.checkedAt ?? null,
    error:verification?.error ?? null, liveEnabled:status?.liveEnabled === true};
}

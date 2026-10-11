// Only provider-observed h2h prices count; configured credentials are not evidence.
export const VERIFICATION_TTL_MS = 8 * 60 * 1000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const unique = values => new Set(values).size === values.length;
export function quoteTimestamp(value) {
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const time=Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,19)===value.slice(0,19) ? time : NaN;
}
export function observeBooks(payload, sport, now, secret, observedAt = now) {
  const safeText=value=>text(value) && !(secret && value.includes(secret));
  if(!Array.isArray(payload) || !unique(payload.map(e=>e?.id))) throw Error('Invalid provider response.');
  const books=new Map();
  for(const event of payload) {
    if(!record(event) || !safeText(event.id) || event.sport_key!==sport || !safeText(event.home_team) || !safeText(event.away_team) || event.home_team===event.away_team || !Number.isFinite(quoteTimestamp(event.commence_time)) || !Array.isArray(event.bookmakers) || !unique(event.bookmakers.map(b=>b?.key))) throw Error('Invalid provider response.');
    for(const book of event.bookmakers) {
      if(!record(book) || !safeText(book.key) || !/^[a-z0-9_]+$/.test(book.key) || !safeText(book.title) || !Array.isArray(book.markets) || !unique(book.markets.map(m=>m?.key))) throw Error('Invalid provider response.');
      if(!books.has(book.key)) books.set(book.key,{key:book.key,title:book.title,quoteCount:0,freshQuoteCount:0,lastUpdate:null});
      const observed=books.get(book.key);
      if(observed.title!==book.title) throw Error('Invalid provider response.');
      for(const market of book.markets) {
        if(!record(market) || market.key!=='h2h' || !Array.isArray(market.outcomes) || market.outcomes.length<2 || !unique(market.outcomes.map(o=>o?.name))) throw Error('Invalid provider response.');
        for(const outcome of market.outcomes) {
          if(!record(outcome) || !safeText(outcome.name) || ![event.home_team,event.away_team,'Draw'].includes(outcome.name) || !Number.isFinite(outcome.price) || outcome.price<=1) throw Error('Invalid provider response.');
        }
        if(!market.outcomes.some(o=>o.name===event.home_team) || !market.outcomes.some(o=>o.name===event.away_team)) throw Error('Invalid provider response.');
        observed.quoteCount+=market.outcomes.length;
        const parsed=quoteTimestamp(market.last_update);
        const stamp=parsed<=observedAt?parsed:NaN, age=now-stamp;
        if(age>=0 && age<=VERIFICATION_TTL_MS) observed.freshQuoteCount+=market.outcomes.length;
        if(Number.isFinite(stamp) && age>=0 && (!observed.lastUpdate || stamp>Date.parse(observed.lastUpdate))) observed.lastUpdate=new Date(stamp).toISOString();
      }
    }
  }
  return [...books.values()].sort((a,b)=>a.key.localeCompare(b.key));
}

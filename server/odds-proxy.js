import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
export const SPORTS = ['soccer_epl','soccer_spain_la_liga','soccer_italy_serie_a','soccer_germany_bundesliga','soccer_france_ligue_one','soccer_uefa_champs_league','soccer_uefa_europa_league','americanfootball_nfl','americanfootball_ncaaf','basketball_nba'];
const fail = (status,error) => ({status,body:{error}});
export function createOddsProxy({ env = process.env, fetchImpl = fetch, ledgerPath = resolve('.odds-budget.json'), timeoutMs = 8000 } = {}) {
  const cache = new Map(), pending = new Map();
  const month=()=>new Date().toISOString().slice(0,7);
  const limit=Math.min(500,Math.max(0,Number(env.ODDS_MONTHLY_BUDGET??450)||0));
  let ledger={month:month(),spent:0,remaining:null},broken=false;
  try {
    if(ledgerPath && existsSync(ledgerPath)) ledger=JSON.parse(readFileSync(ledgerPath,'utf8'));
    if(!/^\d{4}-\d{2}$/.test(ledger.month) || !Number.isFinite(ledger.spent) || ledger.spent<0 || !(ledger.remaining===null || Number.isFinite(ledger.remaining)&&ledger.remaining>=0)) throw Error();
  } catch {broken=true;}
  const save=()=>{if(ledgerPath){writeFileSync(ledgerPath+'.tmp',JSON.stringify(ledger),{mode:0o600});renameSync(ledgerPath+'.tmp',ledgerPath);}};
  return { async request(path, {manual=false} = {}) {
    if(ledger.month!==month()) ledger={month:month(),spent:0,remaining:null};
    if (path === '/api/odds/status') return { status:200, body:{ configured:Boolean(env.ODDS_API_KEY), manualOnly:true, budget:{limit,spent:ledger.spent,remaining:ledger.remaining,available:!broken,month:ledger.month}, oddsBlaze:{enabled:false} } };
    if (!env.ODDS_API_KEY) return fail(503,'Odds connection is not configured.');
    const url = new URL(path,'http://localhost');
    const match = url.pathname.match(/^\/api\/odds\/sports\/([a-z0-9_]+)\/odds$/);
    const sportsList=url.pathname==='/api/odds/sports';
    if (!sportsList && (!match || !SPORTS.includes(match[1]))) return fail(400,'Unsupported sport.');
    if (!sportsList && !manual) return fail(403,'Manual request required.');
    for (const key of url.searchParams.keys()) if (sportsList || !['regions','markets','oddsFormat','dateFormat'].includes(key) || url.searchParams.getAll(key).length!==1) return fail(400,'Unsupported parameter.');
    const regions = url.searchParams.get('regions') || 'ca';
    if (!['ca','eu','ca,eu','eu,ca'].includes(regions) || (url.searchParams.get('markets')||'h2h') !== 'h2h' || (url.searchParams.get('oddsFormat')||'decimal') !== 'decimal' || (url.searchParams.get('dateFormat')||'iso') !== 'iso') return fail(400,'Unsupported market or region.');
    const upstream = new URL('https://api.the-odds-api.com/v4/sports'+(sportsList?'':`/${match[1]}/odds`));
    if(!sportsList) upstream.search = new URLSearchParams({regions:regions.split(',').sort().join(','),markets:'h2h',oddsFormat:'decimal',dateFormat:'iso'});
    const cacheKey=upstream.href;
    if(cache.has(cacheKey) && cache.get(cacheKey).expires>Date.now()) return {...cache.get(cacheKey).result,headers:{...cache.get(cacheKey).result.headers,'x-odds-cache':'HIT'}};
    if(pending.has(cacheKey)) return pending.get(cacheKey);
    if(broken) return fail(503,'Budget ledger unavailable.');
    const cost=sportsList?0:regions.split(',').length;
    if(ledger.spent+cost>limit || ledger.remaining!==null && ledger.remaining<cost) return fail(429,'Free-tier budget exhausted.');
    ledger.spent+=cost;
    if(ledger.remaining!==null) ledger.remaining-=cost;
    try {save();} catch {broken=true;return fail(503,'Budget ledger unavailable.');}
    upstream.searchParams.set('apiKey',env.ODDS_API_KEY);
    const controller=new AbortController();
    let timer;
    const work=(async()=>{
      try {
        const res=await fetchImpl(upstream,{signal:controller.signal,redirect:'error'});
        const headers={'x-odds-cache':'MISS'};
        for(const key of ['x-requests-used','x-requests-remaining','x-requests-last']) { const v=res.headers.get(key); if(v!==null && /^\d+$/.test(v)) headers[key]=v; }
        if(headers['x-requests-remaining']!==undefined) ledger.remaining=ledger.remaining===null?Number(headers['x-requests-remaining']):Math.min(ledger.remaining,Number(headers['x-requests-remaining']));
        if(headers['x-requests-used']!==undefined) ledger.spent=Math.max(ledger.spent,Number(headers['x-requests-used']));
        try {save();} catch {broken=true;return fail(503,'Budget ledger unavailable.');}
        if(!res.ok) return {...fail(res.status===429?429:502,'Odds provider rejected the request.'),headers};
        let body=await res.json();
        if(!Array.isArray(body)) return fail(502,'Invalid provider response.');
        if(sportsList) body=body.filter(s=>SPORTS.includes(s.key));
        const result={status:200,body,headers};
        cache.set(cacheKey,{result,expires:Date.now()+(sportsList?3600000:300000)});
        return result;
      } catch {return fail(502,'Odds provider unavailable.');}
    })();
    const job=Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(fail(504,'Odds provider timed out.'));},timeoutMs);})]).finally(()=>{clearTimeout(timer);pending.delete(cacheKey);});
    pending.set(cacheKey,job);
    return job;
  }};
}

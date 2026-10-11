// Public deployment readiness only. Never spend a personal provider quota here.
export function onRequest({request,env={}}) {
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(!['GET','HEAD'].includes(request.method)) return new Response(JSON.stringify({error:'Method not allowed.'}),{status:405,headers:{...headers,Allow:'GET, HEAD'}});
  const configured=Boolean(env.ODDS_API_KEY);
  const reason='Private authenticated hosted proxy is not enabled. Live odds require private authentication and a durable quota budget; use the localhost backend for manual verification.';
  const body={
    deploymentMode:'hosted-static',liveEnabled:false,liveDisabledReason:reason,
    providers:{oddsApi:{configured,manualOnly:true,verification:{state:configured?'not_checked':'unconfigured',checkedAt:null,sport:null,region:'ca',market:'h2h',eventCount:0,books:[],error:null},budget:{limit:0,spent:0,remaining:null,available:false,month:null},oddsBlaze:{enabled:false}}}
  };
  return new Response(request.method==='HEAD'?null:JSON.stringify(body),{status:200,headers});
}

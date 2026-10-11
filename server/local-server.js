import { createServer } from 'node:http';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { resolve, relative, extname, sep } from 'node:path';
import { createOddsProxy } from './odds-proxy.js';
import { homedir } from 'node:os';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
export function createLocalServer({root=resolve('.'),env=process.env,proxy=createOddsProxy({env,ledgerPath:env.ODDS_BUDGET_FILE||resolve(homedir(),'.bet365-edge-odds-budget.json')})}={}) {
  root=realpathSync(root);
  return createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')) return send(403,{error:'Non-local host denied.'});
    if(!['GET','HEAD'].includes(req.method)) return send(405,{error:'Method not allowed.'});
    let path;
    try {path=decodeURIComponent((req.url||'/').split('?')[0]);} catch {return send(400,{error:'Invalid path.'});}
    if(path.includes('\\') || path.includes('\0') || path.split('/').some(p=>p==='..'||p.startsWith('.'))) return send(403,{error:'Forbidden.'});
    if(path.startsWith('/api/')) {
      if(path==='/api/odds/verify' && req.method!=='GET') return send(405,{error:'Verification requires GET.'});
      if(req.headers['sec-fetch-site']==='cross-site') return send(403,{error:'Cross-origin request denied.'});
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) return send(403,{error:'Cross-origin request denied.'});
      if(path!=='/api/status' && !path.startsWith('/api/odds/')) return send(404,{error:'Unknown endpoint.'});
      try {
        if(path==='/api/status') {
          const result=await proxy.request('/api/odds/status');
          return send(result.status,{liveEnabled:true,deploymentMode:'local',providers:{oddsApi:result.body}});
        }
        const result=await proxy.request(req.url,{manual:req.headers['x-odds-manual']==='1'});
        for(const [key,value] of Object.entries(result.headers||{})) res.setHeader(key,value);
        return send(result.status,result.body);
      } catch {return send(500,{error:'Connection unavailable.'});}
    }
    if(path==='/') path='/index.html';
    // Explicit public assets only: never expose repository, environment, server or ledger.
    if(!(path==='/index.html'||path.startsWith('/src/')||path.startsWith('/assets/')) || !mime[extname(path)]) return send(404,{error:'Not found.'});
    try {
      const file=realpathSync(resolve(root,'.'+path));
      const rel=relative(root,file);
      if(rel==='..'||rel.startsWith('..'+sep)||resolve(root,rel)!==file||!statSync(file).isFile()) return send(403,{error:'Forbidden.'});
      // Also reject symlinks pointing into excluded directories inside root.
      const publicRel=rel.split(sep).join('/');
      if(publicRel.split('/').some(p=>p.startsWith('.')) || !(publicRel==='index.html'||publicRel.startsWith('src/')||publicRel.startsWith('assets/'))) return send(403,{error:'Forbidden.'});
      res.writeHead(200,{'Content-Type':mime[extname(file)]});
      if(req.method==='HEAD') return res.end();
      createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    } catch {return send(404,{error:'Not found.'});}
  });
}

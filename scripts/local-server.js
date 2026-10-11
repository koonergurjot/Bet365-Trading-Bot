import { createLocalServer } from '../server/local-server.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const host='127.0.0.1';
const port=Number(process.env.PORT||8787);
if(!Number.isInteger(port)||port<0||port>65535) throw new Error('Invalid PORT.');
createLocalServer({root}).listen(port,host,function(){
  console.log(`Bet365 Edge Brain preview running at http://${host}:${this.address().port}`);
  console.log(process.env.ODDS_API_KEY?'Odds key configured; manual free-tier requests only.':'Odds disconnected: server ODDS_API_KEY is not configured.');
});

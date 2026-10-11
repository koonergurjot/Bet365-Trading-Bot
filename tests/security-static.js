import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { resolve } from 'node:path';
function get(port,path,headers={}) {return new Promise((done,reject)=>{request({hostname:'127.0.0.1',port,path,headers},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>done({status:res.statusCode,body}));}).on('error',reject).end();});}
test('static server rejects secrets, traversal and cross-origin API; serves app',async()=>{
  const {createLocalServer}=await import('../server/local-server.js');
  const server=createLocalServer({root:resolve('.'),env:{}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  try {
    assert.equal((await get(port,'/')).status,200);
    for(const path of ['/.env','/.git/config','/src/../.env','/%2e%2e/.env','/%2e%2e%5c.env','/%ZZ','/server/odds-proxy.js','/package.json','/.odds-budget.json']) assert.notEqual((await get(port,path)).status,200,path);
    assert.equal((await get(port,'/api/odds/status')).status,200);
    assert.equal((await get(port,'/api/odds/status',{Host:'attacker.example'})).status,403);
    assert.equal((await get(port,'/api/odds/status',{Origin:'https://evil.test'})).status,403);
  } finally {await new Promise(r=>server.close(r));}
});

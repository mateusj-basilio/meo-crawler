import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { Store } from '../lib/store.mjs';
import { Crawler } from '../lib/engine.mjs';
import { classifyContentType } from '../lib/resource-types.mjs';

async function listen(handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:'http://127.0.0.1:'+server.address().port};}
async function workspace(){const directory=await mkdtemp(join(tmpdir(),'spider-resources-')),store=new Store(join(directory,'test.sqlite')),crawler=new Crawler(store,directory);return {store,crawler,close:async()=>{await crawler.shutdown();store.close();assert(resolve(directory).startsWith(resolve(tmpdir())));await rm(directory,{recursive:true,force:true});}};}
test('internal CSS, JavaScript, image and PDF are requested, categorized and filtered using real HTTP results',async()=>{
 const requests=[];
 const fixture=await listen((req,res)=>{requests.push(req.url);if(req.url==='/robots.txt'){res.end('User-agent: *\nDisallow: /private');return;}
  const types={'/style.css':'text/css','/app.js':'application/javascript','/image.svg':'image/svg+xml','/document.pdf':'application/pdf'};
  if(types[req.url]){res.setHeader('content-type',types[req.url]);if(req.url==='/app.js')res.setHeader('X-Robots-Tag','noindex');res.end('resource');return;}
  res.setHeader('content-type','text/html');res.end('<html><head><title>Auditoria de recursos</title><link rel="stylesheet" href="/style.css"><script src="/app.js"></script></head><body><h1>Recursos</h1><img src="/image.svg" alt="Imagem"><a href="/document.pdf">Documento</a></body></html>');
 });const w=await workspace();
 try{const job=await w.crawler.create({url:fixture.url,delayMs:0});await w.crawler.active.get(job.id).promise;assert.equal(w.store.job(job.id).status,'completed');
  const expected={css:'/style.css',javascript:'/app.js',image:'/image.svg',pdf:'/document.pdf'};
  for(const [type,path] of Object.entries(expected)){assert(requests.includes(path));const row=w.store.byUrl(job.id,fixture.url+path);assert.equal(row.statusCode,200);assert.equal(classifyContentType(row.contentType),type);assert.equal(w.store.rows(job.id,{tab:'internal',filter:'type:'+type}).total,1);}
  assert.equal(w.store.byUrl(job.id,fixture.url+'/document.pdf').indexable,true);assert.equal(w.store.byUrl(job.id,fixture.url+'/app.js').indexable,false);
  const group=w.store.overview(job.id).groups.find(g=>g.key==='internal');assert.equal(group.total,5);assert.equal(group.children.find(g=>g.type==='html').total,1);assert.equal(group.children.reduce((n,g)=>n+g.total,0),5);
 }finally{await w.close();await new Promise(r=>fixture.server.close(r));}
});

test('external checks are opt-in, do not recurse and have no hidden 200 URL ceiling when the configured limit is zero',async()=>{
 let externalRequests=0,deepRequests=0;
 const external=await listen((req,res)=>{if(req.url==='/robots.txt'){res.end('User-agent: *\nAllow: /');return;}externalRequests++;if(req.url==='/deep')deepRequests++;res.setHeader('content-type','text/html');res.end('<html><a href="/deep">Never follow this external page</a></html>');});
 const internal=await listen((req,res)=>{res.setHeader('content-type','text/html');res.end('<html><title>External test</title><body>'+Array.from({length:205},(_,i)=>'<a href="'+external.url+'/page/'+i+'">External</a>').join('')+'</body></html>');});
 const w=await workspace();
 try{const job=await w.crawler.create({url:internal.url,delayMs:0,concurrency:8,respectRobots:false,followExternal:true,maxExternalUrls:0});await w.crawler.active.get(job.id).promise;assert.equal(externalRequests,205);assert.equal(deepRequests,0);assert.equal(w.store.rows(job.id,{tab:'external'}).total,205);assert.equal(w.store.stats(job.id).found,206);
 }finally{await w.close();await new Promise(r=>internal.server.close(r));await new Promise(r=>external.server.close(r));}
});

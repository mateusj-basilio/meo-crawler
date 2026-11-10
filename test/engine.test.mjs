import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.mjs';
import { Crawler,validateConfig } from '../lib/engine.mjs';
import { Writable } from 'node:stream';
import { exportJob } from '../lib/export.mjs';

async function fixture(handler) {
 const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,directory=await mkdtemp(join(tmpdir(),'spider-test-')),store=new Store(join(directory,'test.sqlite')),crawler=new Crawler(store,directory);
 return {base,store,crawler,directory,close:async()=>{await crawler.shutdown();store.close();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}};
}
async function finish(context,config){const job=await context.crawler.create({url:context.base,delayMs:0,...config});await context.crawler.active.get(job.id).promise;return context.store.job(job.id);}
const html=(res,text)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html lang="pt"><head><title>SEO de teste com título</title><meta name="description" content="Uma descrição para testar o rastreamento."></head><body><h1>Teste</h1>'+text+'</body></html>');};

test('crawler honors robots, follows redirects, records errors and inlinks, reads sitemap, and exports',async()=>{
 const requests=[];let base='';
 const ctx=await fixture((req,res)=>{requests.push(req.url);
  if(req.url==='/robots.txt'){res.end('User-agent: *\nDisallow: /private\nSitemap: '+base+'/sitemap.xml');return;}
  if(req.url==='/sitemap.xml'){res.setHeader('content-type','application/xml');res.end('<urlset><url><loc>'+base+'/from-sitemap</loc></url></urlset>');return;}
  if(req.url==='/'){html(res,'<a href="/page">Página</a><a href="/private">Privado</a><a href="/missing">Ausente</a><a href="/redirect">Redireciona</a><a href="https://example.invalid/">Externo</a><img src="/image.png"><img>');return;}
  if(req.url==='/redirect'){res.writeHead(301,{location:'/page'});res.end();return;}
  if(req.url==='/missing'){res.writeHead(404);res.end('missing');return;}
  html(res,'<p>'+req.url+'</p>');
 });base=ctx.base;
 try{
  const job=await finish(ctx,{discoverSitemaps:true,checkImages:false});assert.equal(job.status,'completed',job.error);assert(!requests.includes('/private'));
  assert.equal(ctx.store.byUrl(job.id,base+'/private').blocked,true);
  assert.equal(ctx.store.byUrl(job.id,base+'/missing').statusCode,404);
  assert.equal(ctx.store.byUrl(job.id,base+'/redirect').statusCode,301);
  assert.equal(ctx.store.byUrl(job.id,base+'/redirect').indexable,false);
  assert.equal(ctx.store.byUrl(job.id,base+'/from-sitemap').inSitemap,true);
  const root=ctx.store.byUrl(job.id,base+'/');assert(root.issues.some(i=>i.code==='broken-outlink'));
  const page=ctx.store.byUrl(job.id,base+'/page');assert.equal(ctx.store.detail(job.id,page.id).inlinks[0].url,base+'/');
  assert.equal(ctx.store.rows(job.id,{tab:'images'}).total,1);
  assert.equal(ctx.store.rows(job.id,{tab:'amp'}).total,0);
  assert.equal(ctx.store.rows(job.id,{tab:'titles'}).total,3);
  assert(!ctx.store.byUrl(job.id,base+'/redirect').issues.some(i=>i.code==='duplicate-content'));
  assert.equal(ctx.store.byUrl(job.id,'https://example.invalid/').statusCode,undefined);
  let csv='';const stream=new Writable({write(chunk,encoding,done){csv+=chunk;done();}});await exportJob(ctx.store,job.id,{tab:'internal',format:'csv'},stream);assert(csv.includes('URL final'));assert(csv.includes('/from-sitemap'));
 }finally{await ctx.close();}
});

test('no commercial 500 URL cap and exact duplicate analysis persists',async()=>{
 const ctx=await fixture((req,res)=>{if(req.url==='/')html(res,Array.from({length:505},(_,n)=>'<a href="/p/'+n+'">'+n+'</a>').join(''));else html(res,'<p>conteúdo repetido para verificar a detecção de duplicatas</p>');});
 try{const job=await finish(ctx,{respectRobots:false,discoverSitemaps:false,concurrency:8});assert.equal(job.status,'completed',job.error);assert.equal(job.stats.done,506);assert.equal(job.stats.pending,0);assert(ctx.store.byUrl(job.id,ctx.base+'/p/504').issues.some(i=>i.code==='duplicate-content'));}finally{await ctx.close();}
});

test('pause drains requests and resume completes queued work',async()=>{
 const ctx=await fixture(async(req,res)=>{if(req.url==='/')html(res,Array.from({length:12},(_,n)=>'<a href="/p/'+n+'">URL</a>').join(''));else{await new Promise(r=>setTimeout(r,30));html(res,'conteúdo de '+req.url);}});
 try{
  const job=await ctx.crawler.create({url:ctx.base,respectRobots:false,discoverSitemaps:false,delayMs:0,concurrency:2});
  while(ctx.store.stats(job.id).found<10)await new Promise(r=>setTimeout(r,5));
  const running=ctx.crawler.active.get(job.id);await ctx.crawler.control(job.id,'pause');await running.promise;
  assert.equal(ctx.store.job(job.id).status,'paused');assert(ctx.store.stats(job.id).pending>0);
  await ctx.crawler.control(job.id,'resume');await ctx.crawler.active.get(job.id).promise;
  assert.equal(ctx.store.job(job.id).status,'completed');assert.equal(ctx.store.stats(job.id).pending,0);
 }finally{await ctx.close();}
});

test('oversized responses retain HTTP facts without analyzing truncated HTML or marking links broken',async()=>{
 const ctx=await fixture((req,res)=>{
  if(req.url==='/robots.txt'){res.writeHead(404);res.end();return;}
  if(req.url==='/'){html(res,'<a href="/large">Documento grande</a>');return;}
  res.writeHead(200,{'content-type':'text/html','x-test-evidence':'preserved'});
  res.end('<title>Partial title must not be analyzed</title>'+ 'x'.repeat(4096)+'<a href="/hidden">Hidden</a>');
 });
 try{
  const job=await finish(ctx,{maxBodyBytes:1024});
  const large=ctx.store.byUrl(job.id,ctx.base+'/large');
  assert.equal(job.status,'completed');assert.equal(large.statusCode,200);assert.equal(large.finalStatus,200);
  assert.equal(large.headers['x-test-evidence'],'preserved');assert.equal(large.bodyComplete,false);assert.equal(large.bytes,1024);
  assert.equal(large.analysisComplete,false);assert.equal(large.title,undefined);assert.equal(large.indexable,false);
  assert(large.issues.some(issue=>issue.code==='body-too-large'));assert(!large.issues.some(issue=>issue.code==='fetch-error'));
  assert.equal(ctx.store.byUrl(job.id,ctx.base+'/hidden'),null);
  assert(!ctx.store.byUrl(job.id,ctx.base+'/').issues.some(issue=>issue.code==='broken-outlink'));
 }finally{await ctx.close();}
});

test('truncated robots files remain unknown rather than allowing crawling with partial rules',async()=>{
 const requests=[];
 const ctx=await fixture((req,res)=>{requests.push(req.url);res.end(req.url==='/robots.txt'?'#'+'x'.repeat(2048)+'\nUser-agent: *\nDisallow: /':'root');});
 try{const job=await finish(ctx,{maxBodyBytes:1024});assert.equal(job.status,'failed');assert(!requests.includes('/'));assert(ctx.store.byUrl(job.id,ctx.base+'/').issues.some(issue=>issue.code==='robots-unavailable'));}finally{await ctx.close();}
});

test('crawler persists custom searches across the complete fetched HTML',async()=>{
 const ctx=await fixture((req,res)=>html(res,'<p>'+'x'.repeat(12000)+'SKU-765</p>'));
 try{const job=await finish(ctx,{respectRobots:false,customSearch:[{name:'sku',pattern:'SKU-\\d+'}]});const row=ctx.store.byUrl(job.id,ctx.base+'/');assert.equal(job.status,'completed');assert.deepEqual(row.custom.sku.matches,['SKU-765']);assert.equal(row.custom.sku.complete,true);assert(row.custom.sku.examinedCharacters>12000);}finally{await ctx.close();}
});

test('binary resources are streamed and counted without retaining bodies needed only for HTML analysis',async()=>{
 const image=Buffer.alloc(2*1024*1024,255);
 const ctx=await fixture((req,res)=>{if(req.url==='/image'){res.setHeader('content-type','image/png');res.end(image);}else html(res,'<p>HTML is retained</p>');});
 try{
  const runtime={config:validateConfig({url:ctx.base,delayMs:0}),abort:new AbortController(),gates:new Map()};
  const binary=await ctx.crawler.raw(runtime,ctx.base+'/image');
  assert.equal(binary.status,200);assert.equal(binary.bytes,image.length);assert.equal(binary.body.length,0);assert.equal(binary.bodyComplete,true);
  const page=await ctx.crawler.raw(runtime,ctx.base+'/');assert.match(page.body.toString(),/HTML is retained/);assert.equal(page.bytes,page.body.length);
 }finally{await ctx.close();}
});

test('saved configurations remove credentials and reject bad protocols and concurrency',async()=>{
 const ctx=await fixture((req,res)=>html(res,'teste'));
 try{assert.throws(()=>validateConfig({url:'file:///etc/passwd'}));assert.throws(()=>validateConfig({url:ctx.base,concurrency:0}));
  const job=ctx.store.create({url:ctx.base,password:'secret',cookie:'session=secret',headers:{Authorization:'Bearer secret','X-Test':'value'}});
  assert.equal(job.config.password,undefined);assert.equal(job.config.cookie,undefined);assert.equal(job.config.headers.Authorization,undefined);assert.equal(job.config.headers['X-Test'],'value');
 }finally{await ctx.close();}
});

test('shutdown preserves in-flight URLs as queued and resume completes them without fabricated failures',async()=>{
 let release,interrupted=true;const requested=new Promise(resolve=>{release=resolve;});
 const ctx=await fixture((req,res)=>{if(interrupted){res.writeHead(200,{'content-type':'text/html'});res.write('<html>');release();}else html(res,'<p>Recovered</p>');});
 try{
  const job=await ctx.crawler.create({url:ctx.base,respectRobots:false,delayMs:0});await requested;
  await ctx.crawler.shutdown();assert.equal(ctx.store.job(job.id).status,'paused');assert.equal(ctx.store.stats(job.id).pending,1);assert.equal(ctx.store.stats(job.id).failed,0);
  interrupted=false;await ctx.crawler.control(job.id,'resume');await ctx.crawler.active.get(job.id).promise;
  assert.equal(ctx.store.job(job.id).status,'completed');assert.equal(ctx.store.stats(job.id).pending,0);
 }finally{await ctx.close();}
});

test('a non-terminating custom script times out and preserves the received HTTP response',async()=>{
 const ctx=await fixture((req,res)=>html(res,'<p>Received page</p>'));
 try{
  const job=await finish(ctx,{respectRobots:false,timeoutMs:1000,renderWaitMs:0,customJavaScript:'await new Promise(()=>{});'});
  const row=ctx.store.byUrl(job.id,ctx.base+'/');assert.equal(job.status,'failed');assert.equal(row.statusCode,200);assert.equal(row.analysisComplete,false);assert(row.issues.some(issue=>issue.code==='analysis-error'));
 }finally{await ctx.close();}
});

test('recrawling a removed page does not retain its old outbound links',async()=>{
 let removed=false;const ctx=await fixture((req,res)=>{if(removed&&req.url==='/'){res.writeHead(404,{'content-type':'text/html'});res.end('gone');}else html(res,req.url==='/'?'<a href="/child">Child</a>':'Child');});
 try{
  const job=await finish(ctx,{respectRobots:false});assert(ctx.store.detail(job.id,ctx.store.byUrl(job.id,ctx.base+'/child').id).inlinks.length);
  removed=true;ctx.store.db.prepare("UPDATE urls SET state='queued' WHERE job=? AND url=?").run(job.id,ctx.base+'/');ctx.crawler.start(job.id);await ctx.crawler.active.get(job.id).promise;
  assert.equal(ctx.store.byUrl(job.id,ctx.base+'/').statusCode,404);assert.equal(ctx.store.detail(job.id,ctx.store.byUrl(job.id,ctx.base+'/child').id).inlinks.length,0);
 }finally{await ctx.close();}
});

test('browser rendering discovers dynamic links and runs axe and custom JavaScript',async()=>{
 const ctx=await fixture((req,res)=>html(res,req.url==='/'?'<script>document.body.insertAdjacentHTML("beforeend",\'<a href="/dynamic">Dinâmico</a>\')</script>':'<p>página dinâmica</p>'));
 try{const job=await finish(ctx,{respectRobots:false,discoverSitemaps:false,renderJavaScript:true,renderWaitMs:20,accessibility:true,customJavaScript:'return document.title;',screenshots:true});assert.equal(job.status,'completed',job.error);const root=ctx.store.byUrl(job.id,ctx.base+'/');assert(root.js);assert(root.accessibility);assert(root.customJavaScript);assert(root.screenshot);assert(ctx.store.byUrl(job.id,ctx.base+'/dynamic'));}finally{await ctx.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { Store } from '../lib/store.mjs';
import { Crawler } from '../lib/engine.mjs';

async function scenario(robotsStatus,transportDenied=false) {
 let pageRequests=0;
 const server=http.createServer((req,res)=>{
  if(req.url==='/robots.txt'){res.writeHead(robotsStatus,{'content-type':'text/plain'});res.end(robotsStatus===200?'User-agent: *\nDisallow: /admin/':'unavailable');return;}
  pageRequests++;res.setHeader('content-type','text/html');res.end('<html><head><title>Robots de teste</title></head><body><h1>Teste</h1></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port+'/',directory=await mkdtemp(join(tmpdir(),'spider-robots-')),store=new Store(join(directory,'test.sqlite')),crawler=new Crawler(store,directory);
 if(transportDenied){const raw=crawler.raw.bind(crawler);crawler.raw=async(runtime,target,options)=>{if(target.endsWith('/robots.txt'))throw new TypeError('fetch failed',{cause:{code:'EACCES'}});return raw(runtime,target,options);};}
 try {
  const created=await crawler.create({url,delayMs:0,discoverSitemaps:false});await crawler.active.get(created.id).promise;
  return {job:store.job(created.id),row:store.byUrl(created.id,url),pageRequests};
 }finally{await crawler.shutdown();store.close();await new Promise(r=>server.close(r));assert(resolve(directory).startsWith(resolve(tmpdir())));await rm(directory,{recursive:true,force:true});}
}

test('network permission error is not misrepresented as a robots Disallow rule or a completed crawl',async()=>{
 const {job,row,pageRequests}=await scenario(200,true);
 assert.equal(job.status,'failed');assert.equal(job.stats.failed,1);assert.equal(pageRequests,0);
 assert.equal(row.blocked,undefined);assert.equal(row.errorCode,'EACCES');assert(row.issues.some(i=>i.code==='robots-unavailable'));assert(!row.issues.some(i=>i.code==='robots-blocked'));
 assert(job.notes.some(note=>note.includes('EACCES')));
});
for(const status of [403,503])test('robots HTTP '+status+' preserves unknown access instead of inventing Disallow',async()=>{
 const {job,row,pageRequests}=await scenario(status);
 assert.equal(job.status,'failed');assert.equal(pageRequests,0);assert.equal(row.blocked,undefined);assert(row.error.includes('HTTP '+status));assert.equal(row.issues[0].code,'robots-unavailable');
});
test('missing robots allows crawling and available rules still allow the root',async()=>{
 for(const status of [404,200]){const {job,row,pageRequests}=await scenario(status);assert.equal(job.status,'completed',job.error);assert.equal(row.statusCode,200);assert.equal(pageRequests,1);}
});

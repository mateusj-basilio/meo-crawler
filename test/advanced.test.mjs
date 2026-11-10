import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { Store } from '../lib/store.mjs';
import { Crawler } from '../lib/engine.mjs';
import { buildGraph,computeLinkScores,applySegments } from '../lib/graph.mjs';
import { checkLanguage } from '../lib/validation.mjs';

test('graph uses real links, directory ancestry and normalized link scores; segments can overlap',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'spider-graph-')),store=new Store(join(directory,'test.sqlite'));
 try{const job=store.create({url:'https://example.com/'});for(const path of ['/','/blog/one','/blog/two']){store.enqueue(job.id,'https://example.com'+path,0);const row=store.reserve(job.id);store.save(job.id,row.id,{url:'https://example.com'+path,kind:'page',internal:true,contentType:'text/html',statusCode:200,indexable:true,issues:[],segments:applySegments('https://example.com'+path,[{name:'Blog',pattern:'/blog/'},{name:'All',pattern:'.*'}])});}
  store.addLinks(job.id,'https://example.com/',[{url:'https://example.com/blog/one',type:'anchor',follow:true}]);store.addLinks(job.id,'https://example.com/blog/two',[{url:'https://example.com/blog/one',type:'anchor',follow:true}]);computeLinkScores(store,job.id);
  const graph=buildGraph(store,job.id);assert.equal(graph.nodes.length,3);assert.equal(graph.edges.length,2);assert.equal(store.byUrl(job.id,'https://example.com/blog/one').linkScore,100);
  assert(buildGraph(store,job.id,{mode:'directory'}).nodes.some(node=>node.id==='https://example.com/blog'));
  assert.equal(store.rows(job.id,{filter:'segment:Blog'}).total,2);assert.equal(store.overview(job.id).segments.find(segment=>segment.name==='All').count,3);
 }finally{store.close();assert(resolve(directory).startsWith(resolve(tmpdir())));await rm(directory,{recursive:true,force:true});}
});

test('form authentication shares session cookies with HTTP crawling and never saves credentials',async()=>{
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/login'){res.setHeader('content-type','text/html');res.end('<form method="post" action="/session"><input name="username"><input type="password" name="password"><button type="submit">Login</button></form>');return;}
  if(req.url==='/session'){let body='';for await(const chunk of req)body+=chunk;const fields=new URLSearchParams(body);if(fields.get('username')==='alice'&&fields.get('password')==='very-secret'){res.writeHead(302,{'set-cookie':'session=verified; HttpOnly; Path=/','location':'/'});res.end();return;}}
  if(!req.headers.cookie?.includes('session=verified')){res.writeHead(401);res.end('Unauthorized');return;}
  res.setHeader('content-type','text/html');res.end('<html lang="en"><head><title>Authenticated dashboard</title></head><body><h1 id="dashboard">Private dashboard</h1></body></html>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/',directory=await mkdtemp(join(tmpdir(),'spider-form-')),store=new Store(join(directory,'test.sqlite')),crawler=new Crawler(store,directory);
 try{const job=await crawler.create({url,delayMs:0,respectRobots:false,formLoginUrl:url+'login',formUsername:'alice',formPassword:'very-secret',formSuccessSelector:'#dashboard'});await crawler.active.get(job.id).promise;const finished=store.job(job.id);assert.equal(finished.status,'completed',finished.error);assert.equal(store.byUrl(job.id,url).title,'Authenticated dashboard');assert(!JSON.stringify(finished.config).includes('very-secret'));assert.equal(finished.config.formUsername,undefined);assert.equal(finished.config.cookie,undefined);}
 finally{await crawler.shutdown();store.close();await new Promise(r=>server.close(r));assert(resolve(directory).startsWith(resolve(tmpdir())));await rm(directory,{recursive:true,force:true});}
});

test('LanguageTool checks all chunks with correct absolute offsets using the configured endpoint only',async()=>{
 let count=0;const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const form=new URLSearchParams(body);assert.equal(form.get('language'),'pt-BR');assert(form.get('text').length<=19000);count++;res.setHeader('content-type','application/json');res.end(JSON.stringify({matches:[{offset:0,length:1,message:'Example',rule:{id:'TEST'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const result=await checkLanguage('x'.repeat(38001),{endpoint:'http://127.0.0.1:'+server.address().port+'/v2/check',language:'pt-BR'});assert.equal(result.charactersChecked,38001);assert.equal(result.complete,true);assert.equal(count,3);assert.deepEqual(result.matches.map(match=>match.offset),[0,19000,38000]);}finally{await new Promise(r=>server.close(r));}
});

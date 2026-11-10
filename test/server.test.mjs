import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createApplication } from '../server.mjs';
import { Store } from '../lib/store.mjs';
import ExcelJS from 'exceljs';

test('local API denies cross-origin mutations; results filter, compare and export correctly',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'spider-api-')),app=await createApplication({dataDir,port:0,browserProbe:false});
 try{
  assert.equal((await fetch(app.url+'/api/health')).status,200);
  for(const [asset,type] of [['csw-sites.svg','image/svg+xml'],['SplineSans-Regular.woff2','font/woff2'],['AnekTeluguExpanded-Bold.woff','font/woff']]){const response=await fetch(app.url+'/brand/'+asset);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type);assert((await response.arrayBuffer()).byteLength>0);}
  assert.equal((await fetch(app.url+'/brand/../../package.json')).status,404);
  const capabilities=await (await fetch(app.url+'/api/capabilities')).json();
  assert.equal(capabilities.completeParity,false);
  assert.equal(capabilities.features.length,32);
  assert.equal(capabilities.features.find(feature=>feature.name==='AMP Crawling & Validation').status,'implemented');
  assert.equal(capabilities.features.find(feature=>feature.name==='Custom Source Code Search').status,'partial');
  assert(capabilities.features.every(feature=>feature.name&&feature.status&&feature.detail));
  assert.equal((await fetch(app.url+'/api/jobs',{method:'POST',headers:{origin:'https://attacker.invalid','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(app.url+'/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:'{"url":"file:///private"}'})).status,400);
  const first=app.store.create({url:'https://example.com/'}),second=app.store.create({url:'https://example.com/'});
  for(const [job,title] of [[first,'=MALICIOUS()'],[second,'Novo título']]){
   app.store.enqueue(job.id,'https://example.com/',0);const row=app.store.reserve(job.id);
   app.store.save(job.id,row.id,{url:'https://example.com/',kind:'page',internal:true,statusCode:200,contentType:'text/html',title,titleLength:title.length,indexable:true,issues:[],h1:['Exemplo'],textHash:title,amp:null});app.store.setStatus(job.id,'completed');
  }
  const rows=await (await fetch(app.url+`/api/jobs/${first.id}/rows?tab=titles`)).json();assert.equal(rows.total,1);assert.equal(rows.rows[0].title,'=MALICIOUS()');
  assert.equal(rows.rows[0].statusLabel,'OK');assert.equal(rows.rows[0].statusLabelSource,'standard');assert.equal(rows.rows[0].statusText,undefined);
  const amp=await (await fetch(app.url+`/api/jobs/${first.id}/rows?tab=amp`)).json();assert.equal(amp.total,0);
  const compare=await (await fetch(app.url+`/api/compare?a=${first.id}&b=${second.id}`)).json();assert.equal(compare.summary.changed,1);
  const csv=await (await fetch(app.url+`/api/jobs/${first.id}/export?format=csv`)).text();assert(csv.includes("'=MALICIOUS()"));
  const xml=await (await fetch(app.url+`/api/jobs/${first.id}/export?format=sitemap`)).text();assert(xml.includes('<loc>https://example.com/</loc>'));
  const excel=await (await fetch(app.url+`/api/jobs/${first.id}/export?format=xlsx`)).arrayBuffer();const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(excel));assert.equal(book.worksheets[0].getRow(2).getCell(book.worksheets[0].getRow(1).values.indexOf("Title")).value,"'=MALICIOUS()");
  assert.throws(()=>new Store(join(dataDir,'spider.sqlite')),/já está aberto/);
 }finally{await app.close();assert(resolve(dataDir).startsWith(resolve(tmpdir())+'\\')||resolve(dataDir).startsWith(resolve(tmpdir())+'/'));await rm(dataDir,{recursive:true,force:true});}
});

test('saved sessions survive reopen and unfinished jobs become resumable without losing queued URLs',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'spider-recover-')),file=join(directory,'test.sqlite');let store=new Store(file);
 try{const job=store.create({url:'https://example.com/'});store.enqueue(job.id,'https://example.com/',0);store.setStatus(job.id,'running');store.reserve(job.id);store.close();store=new Store(file);assert.equal(store.job(job.id).status,'paused');assert.equal(store.stats(job.id).pending,1);assert(store.reserve(job.id));}
 finally{store.close();assert(resolve(directory).startsWith(resolve(tmpdir())));await rm(directory,{recursive:true,force:true});}
});

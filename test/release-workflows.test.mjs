import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {access} from 'node:fs/promises';
import {createApplication} from '../server.mjs';
import {launchBrowser} from '../lib/engine.mjs';
import ExcelJS from 'exceljs';

async function site(handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};}
function save(store,job,path,extra={}){
 const url=job.config.url+path;store.enqueue(job.id,url,0);const row=store.reserve(job.id);
 store.save(job.id,row.id,{url,kind:'page',internal:true,contentType:'text/html',statusCode:200,indexable:true,title:'Page',text:'Useful content',issues:[],...extra});return row.id;
}
test('default sessions export useful standalone reports and remove only their temporary files on close',async()=>{
 const app=await createApplication({port:0,browserProbe:false}),directory=app.dataDir;
 try{
  const capability=await(await fetch(app.url+'/api/capabilities')).json();assert.equal(capability.storage.mode,'session');
  const job=app.store.create({url:'https://example.test/'});
  save(app.store,job,'',{title:'<script>untrusted</script>',issues:[{code:'TITLE_MISSING',severity:'error',category:'Page Titles',message:'<script>bad()</script>'}],mobile:{scores:{seo:.9}},ai:{output:'a'.repeat(34000)}});
  app.store.setStatus(job.id,'completed');
  const report=await(await fetch(app.url+`/api/jobs/${job.id}/export?format=html`)).text();
  assert.match(report,/Como corrigir/);assert.match(report,/&lt;script&gt;bad/);assert(!report.includes('<script>bad'));assert.match(report,/não comprova indexação/);
  const data=await(await fetch(app.url+`/api/jobs/${job.id}/export?format=xlsx`)).arrayBuffer(),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(data));
  assert(book.getWorksheet('Avisos'));assert(book.worksheets[0].getRow(1).values.includes('Lighthouse Mobile'));
 }finally{await app.close();}
 await assert.rejects(access(directory),{code:'ENOENT'});
});

test('unsupported integrations fail before starting and Ollama honors the configured local endpoint',async()=>{
 let requests=0;
 const model=await site(async(req,res)=>{requests++;assert.equal(req.url,'/api/generate');let body='';for await(const chunk of req)body+=chunk;assert.equal(JSON.parse(body).model,'local-test');res.setHeader('content-type','application/json');res.end(JSON.stringify({response:'Useful analysis',done:true}));});
 const app=await createApplication({port:0,browserProbe:false});
 try{
  const job=app.store.create({url:'https://example.test/'});save(app.store,job,'');save(app.store,job,'missing',{statusCode:404});save(app.store,job,'partial',{bodyComplete:false});
  const post=options=>fetch(app.url+`/api/jobs/${job.id}/integrate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(options)});
  assert.equal((await post({provider:'moz'})).status,400);assert.equal((await post({provider:'openai',model:'test'})).status,400);
  assert.equal((await(await fetch(app.url+`/api/jobs/${job.id}`)).json()).integration,null);
  assert.equal((await post({provider:'ollama',model:'local-test',endpoint:model.url})).status,202);
  let result;for(let count=0;count<100;count++){result=(await(await fetch(app.url+`/api/jobs/${job.id}`)).json()).integration;if(result.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(result.status,'completed');assert.equal(result.result.processed,1);assert.equal(requests,1);assert.equal(app.store.byUrl(job.id,job.config.url).ai.output,'Useful analysis');
 }finally{await app.close();await model.close();}
});

test('due schedules execute once and authenticated schedules are rejected explicitly',async()=>{
 const target=await site((req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Scheduled audit</title><h1>Hello</h1>');});
 const app=await createApplication({port:0,browserProbe:false});
 try{
  const post=config=>fetch(app.url+'/api/schedules',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intervalMinutes:1,config})});
  assert.equal((await post({url:target.url,username:'secret'})).status,400);
  const response=await post({url:target.url,respectRobots:false,delayMs:0});assert.equal(response.status,201);const schedule=await response.json();
  app.store.db.prepare('UPDATE schedules SET nextAt=? WHERE id=?').run('2000-01-01T00:00:00.000Z',schedule.id);
  await Promise.all([app.runDueSchedules(),app.runDueSchedules()]);await Promise.all([...app.crawler.active.values()].map(runtime=>runtime.promise));
  assert.equal(app.store.jobs().length,1);assert.equal(app.store.jobs()[0].status,'completed');
  assert.equal((await fetch(app.url+'/api/schedules/'+schedule.id,{method:'DELETE'})).status,200);
 }finally{await app.close();await target.close();}
});

test('customer browser workflow exposes screenshots, segments, reports and only implemented integrations',{timeout:30000},async()=>{
 const target=await site((req,res)=>{if(req.url==='/robots.txt'){res.writeHead(404);res.end();return;}res.setHeader('content-type','text/html');res.end('<html lang="pt-BR"><title>Customer audit</title><h1>Useful page</h1></html>');});
 const app=await createApplication({port:0,browserProbe:false});let browser;
 try{
  const job=await app.crawler.create({url:target.url,delayMs:0,screenshots:true,segments:[{name:'Site',pattern:'.*'}]});await app.crawler.active.get(job.id).promise;
  browser=await launchBrowser();const page=await(await browser.newContext({acceptDownloads:true})).newPage(),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url,{waitUntil:'networkidle'});await page.locator('.url-select').first().click();
  await page.waitForFunction(()=>document.querySelector('#detail-content img')?.naturalWidth>0,null,{timeout:5000});
  assert(await page.locator('#row-filter option[value="segment:Site"]').count());
  const download=page.waitForEvent('download');await page.locator('#export').click();const file=await download;assert(file.suggestedFilename().endsWith('.html'));
  let html='';for await(const chunk of await file.createReadStream())html+=chunk;assert.match(html,/Relatório de auditoria/);
  await page.locator('[data-action="integration"]').first().click();await page.locator('#integration-dialog').waitFor();await page.waitForFunction(()=>document.querySelector('#integration-provider option[value=moz]').disabled,null,{timeout:5000});
  await page.locator('#integration-provider').selectOption('ollama');assert.equal(await page.locator('[name=model]').isVisible(),true);assert.equal(await page.locator('[name=endpoint]').isVisible(),true);assert.equal(await page.locator('[name=apiKey]').isVisible(),false);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await app.close();await target.close();}
});

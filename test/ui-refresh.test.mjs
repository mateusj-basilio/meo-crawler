import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {launchBrowser} from '../lib/engine.mjs';

test('live polling keeps unchanged table nodes and refreshes changed rows and counts', {timeout:20000}, async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'spider-refresh-'));
 let app,browser;
 try{
  app=await createApplication({dataDir,port:0,browserProbe:false});
  const job=app.store.create({url:'https://example.test/'});
  app.store.enqueue(job.id,'https://example.test/',0);
  const row=app.store.reserve(job.id);
  app.store.save(job.id,row.id,{url:row.url,kind:'page',internal:true,statusCode:200,contentType:'text/html',title:'Original title',issues:[]});
  // A deterministic live fixture: status changes are controlled by the test.
  app.store.setStatus(job.id,'running');
  browser=await launchBrowser();const context=await browser.newContext(),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url,{waitUntil:'networkidle'});
  await page.locator('#results-body tr').first().waitFor();
  await page.evaluate(()=>{window.savedRow=document.querySelector('#results-body tr');});
  const unchanged=await page.waitForResponse(response=>response.url().includes('/view?')&&response.url().includes('sinceRows='));
  assert.equal((await unchanged.json()).rows,null);
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.evaluate(()=>window.savedRow===document.querySelector('#results-body tr')),true);
  app.store.merge(job.id,row.url,{title:'Updated title'});
  app.store.issue(job.id,row.url,{code:'test-issue',message:'Changed issue',severity:'warning'});
  app.store.setStatus(job.id,'completed');
  await page.waitForFunction(()=>document.querySelector('#job-state').textContent==='Concluído');
  assert.match(await page.locator('#results-body').textContent(),/Updated title/);
  assert.equal(await page.locator('#metric-issues').textContent(),'1');
  assert.equal(await page.locator('#issues-count').textContent(),'1');
  assert.equal(await page.evaluate(()=>window.savedRow===document.querySelector('#results-body tr')),false);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});}
});

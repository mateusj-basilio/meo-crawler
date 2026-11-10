import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApplication} from '../server.mjs';
import {launchBrowser} from '../lib/engine.mjs';

test('pasted URLs start immediately without settings, including an empty list mode', {timeout:30000}, async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'csw-quickstart-'));
  const fixture=http.createServer((req,res)=>{
    if(req.url==='/robots.txt'){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end('<!doctype html><title>Quick start '+req.url+'</title><h1>Teste</h1>'+(req.url==='/'?'<a href="/next">Próxima página</a>':''));
  });
  let app,browser;
  try {
    await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+fixture.address().port+'/';
    app=await createApplication({dataDir,port:0,browserProbe:false});
    browser=await launchBrowser();
    const context=await browser.newContext();
    const page=await context.newPage();
    await page.goto(app.url,{waitUntil:'networkidle'});
    async function start(mode,address=url){
      await page.locator('#crawl-mode').selectOption(mode);
      assert.equal(await page.locator('#settings-dialog').isVisible(),false);
      await page.locator('#crawl-url').fill(address);
      const responsePromise=page.waitForResponse(response=>response.url()===app.url+'/api/jobs'&&response.request().method()==='POST');
      await page.locator('#start').click();
      const response=await responsePromise;
      assert.equal(response.status(),201);
      const job=await response.json();
      assert.equal(await page.locator('#settings-dialog').isVisible(),false);
      await page.waitForFunction(()=>document.querySelector('#job-state')?.textContent==='Concluído',null,{timeout:15000});
      return app.store.job(job.id);
    }
    const spider=await start('spider');
    assert.equal(spider.config.mode,'spider');
    assert.equal(spider.stats.html,2);
    await page.locator('#clear').click();
    const list=await start('list');
    assert.deepEqual(list.config.urls,[url]);
    assert.equal(list.stats.html,1);
    await page.reload({waitUntil:'networkidle'});
    await page.locator('#results-body tr').first().waitFor();
    assert.equal(await page.locator('#crawl-mode').inputValue(),'spider');
    const next=await start('spider',url+'another');
    assert.equal(next.config.url,url+'another');
    assert.deepEqual(next.config.urls,[]);
    assert.equal(next.stats.html,1);
    await page.locator('#clear').click();

    // Inspect the outgoing payload only; never crawl an external test hostname.
    let normalized;
    await page.route(app.url+'/api/jobs',async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      normalized=route.request().postDataJSON();
      await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Interrupção intencional do teste de normalização.'})});
    });
    await page.locator('#crawl-mode').selectOption('spider');
    await page.locator('#crawl-url').fill('example.test/contato');
    await page.locator('#start').click();
    await page.locator('#error-banner').waitFor({state:'visible'});
    assert.equal(normalized.url,'https://example.test/contato');
    assert.equal(await page.locator('#settings-dialog').isVisible(),false);
    assert.equal(app.store.jobs().length,3);
  } finally {
    await browser?.close();
    await app?.close();
    await new Promise(resolve=>fixture.close(resolve));
    const tempRoot=resolve(tmpdir())+sep;
    assert(resolve(dataDir).startsWith(tempRoot));
    assert(/^csw-quickstart-/.test(dataDir.slice(dataDir.lastIndexOf(sep)+1)));
    await rm(dataDir,{recursive:true,force:true});
  }
});

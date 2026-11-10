import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {createApplication} from '../server.mjs';
import {launchBrowser} from '../lib/engine.mjs';
import AxeBuilder from '@axe-core/playwright';

test('problem view shows source evidence and copies a usable repair brief', {timeout: 30000}, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'csw-issues-ui-'));
  const site = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(404); res.end(); return; }
    if (req.url === '/missing') { res.writeHead(404, {'content-type': 'text/html'}); res.end('<h1>Ausente</h1>'); return; }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end('<!doctype html><html lang="pt-BR"><head><title>Teste de problemas</title></head><body><h1>Início</h1><a href="/missing">Link quebrado</a></body></html>');
  });
  let app, browser;
  try {
    await new Promise((done) => site.listen(0, '127.0.0.1', done));
    const siteUrl = `http://127.0.0.1:${site.address().port}/`;
    app = await createApplication({dataDir, port: 0, browserProbe: false});
    const job = await app.crawler.create({url: siteUrl, delayMs: 0, discoverSitemaps: false});
    await app.crawler.active.get(job.id).promise;
    assert.equal(app.store.job(job.id).status, 'completed');

    browser = await launchBrowser();
    const context = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
    const page = await context.newPage();
    await page.goto(app.url, {waitUntil: 'networkidle'});
    await page.locator('#issues-open').click();
    await page.locator('[data-issue-code="http-4xx"]').click();
    await page.locator('[data-issue-row]').first().waitFor();
    assert.match(await page.locator('#issue-heading').textContent(), /Resposta HTTP 4xx/);
    assert.match(await page.locator('.issue-facts').textContent(), /404/);
    assert.match(await page.locator('.issue-facts').textContent(), /\/missing/);
    assert.match(await page.locator('.issue-fix-card').textContent(), /corrigir|remover|redirecionar/i);

    await page.locator('[data-issue-copy]').click();
    await page.waitForFunction(() => document.querySelector('.issue-copy-status')?.textContent.includes('Copiado'));
    assert.match(await page.locator('.issue-copy-status').textContent(), /Copiado/);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /Analise e corrija no código deste site/);
    assert.match(copied, /Resposta HTTP 4xx/);
    assert.match(copied, /\/missing/);
    assert.match(copied, /Como verificar:/);

    const accessibility = await new AxeBuilder({page}).include('#issue-workspace').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(accessibility.violations.map((item) => ({id: item.id, targets: item.nodes.map((node) => node.target)})), []);

    await page.locator('#issues-close').click();
    assert.equal(await page.locator('#issue-workspace').isVisible(), false);
    assert.equal(await page.locator('#results-table').isVisible(), true);
  } finally {
    await browser?.close();
    await app?.close();
    await new Promise((done) => site.close(done));
    const tempRoot = resolve(tmpdir()) + sep;
    assert(resolve(dataDir).startsWith(tempRoot));
    assert(/^csw-issues-ui-/.test(dataDir.slice(dataDir.lastIndexOf(sep) + 1)));
    await rm(dataDir, {recursive: true, force: true});
  }
});

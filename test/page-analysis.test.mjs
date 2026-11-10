import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFetchedPage} from '../lib/page-analysis.mjs';

test('isolated searches and extractions examine HTML after character 8192', async () => {
  const html = '<html><head><title>Full search</title></head><body>'+'a'.repeat(12000)+'SKU-123</body></html>';
  const result = await analyzeFetchedPage({url:'https://example.test/',html,config:{
    customSearch:[{name:'sku',pattern:'SKU-\\d+'}],
    customExtractions:[{name:'number',type:'regex',pattern:'SKU-(\\d+)'}],
  }});
  assert.equal(result.title,'Full search');
  assert.deepEqual(result.custom.sku.matches,['SKU-123']);
  assert.equal(result.custom.sku.examinedCharacters,html.length);
  assert.equal(result.custom.sku.complete,true);
  assert.deepEqual(result.custom.number,['123']);
});

test('full scanning reports retained-result limits separately from examined content',async()=>{
  const html='<html><body>'+ 'SKU-123 '.repeat(150)+'</body></html>';
  const result=await analyzeFetchedPage({url:'https://example.test/',html,config:{customSearch:[{name:'sku',pattern:'SKU-\\d+'}]}});
  assert.equal(result.custom.sku.totalMatches,150);
  assert.equal(result.custom.sku.matches.length,100);
  assert.equal(result.custom.sku.complete,true);
  assert.equal(result.custom.sku.resultsTruncated,true);
  assert(result.issues.some(issue=>issue.code==='CUSTOM_RESULTS_TRUNCATED'));
});

test('pathological regex times out without blocking other work or discarding SEO metadata',async()=>{
  let responsive=false;
  const timer=setTimeout(()=>{responsive=true;},10);
  const result=await analyzeFetchedPage({url:'https://example.test/',html:'<title>Preserved</title><body>'+'a'.repeat(100000)+'</body>',config:{customSearch:[{name:'heavy',pattern:'a+a+z'}]}},{timeoutMs:100});
  clearTimeout(timer);
  assert.equal(responsive,true);
  assert.equal(result.title,'Preserved');
  assert.equal(result.custom.heavy.complete,false);
  assert(result.issues.some(issue=>issue.code==='CUSTOM_SEARCH_INCOMPLETE'));
});

// Explicit live-provider smoke check, intentionally separate from the offline test suite.
import { validateAmp,mobileLighthouse } from '../lib/validation.mjs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const amp=await validateAmp('<!doctype html><html amp><head><title>Invalid AMP fixture</title></head><body>Test</body></html>',resolve('data/validators'));
assert.equal(amp.status,'FAIL');assert(amp.errors.length>0);console.log(JSON.stringify({ampStatus:amp.status,ampErrors:amp.errors.length,validatorDigest:amp.validatorDigest}));
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lighthouse local fixture</title></head><body><main><h1>Local fixture</h1><p>No external resources.</p></main></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{const mobile=await mobileLighthouse('http://127.0.0.1:'+server.address().port);assert(mobile.lighthouseVersion);assert.equal(mobile.formFactor,'mobile');assert(mobile.audits);console.log(JSON.stringify({lighthouseVersion:mobile.lighthouseVersion,scores:mobile.scores,audits:Object.keys(mobile.audits).length}));}finally{await new Promise(r=>server.close(r));}

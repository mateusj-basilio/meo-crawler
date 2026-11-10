import ampValidator from 'amphtml-validator';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { existsSync } from 'node:fs';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {chromium} from 'playwright';

let ampPromise;
export async function validateAmp(html,cacheDir) {
 if(!ampPromise)ampPromise=(async()=>{
  await mkdir(cacheDir,{recursive:true});const path=join(cacheDir,'validator_wasm.js');
  if(!existsSync(path)){const response=await fetch('https://cdn.ampproject.org/v0/validator_wasm.js',{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Download do validador AMP retornou HTTP '+response.status);const script=await response.text();if(Buffer.byteLength(script)>32*1024*1024)throw new Error('Validador AMP excedeu o limite de tamanho.');await writeFile(path,script);}
  const source=await readFile(path);return {validator:await ampValidator.getInstance(path),digest:createHash('sha256').update(source).digest('hex')};
 })().catch(error=>{ampPromise=null;throw error;});
 const {validator,digest}=await ampPromise,result=validator.validateString(html);
 return {status:result.status,errors:result.errors.map(error=>({severity:error.severity,line:error.line,column:error.col,message:error.message,specUrl:error.specUrl,code:error.code})),validatorSource:'https://cdn.ampproject.org/v0/validator_wasm.js',validatorDigest:digest};
}

export async function mobileLighthouse(url) {
 const known=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',...chromeLauncher.Launcher.getInstallations()];
 known.push(chromium.executablePath());
 const chromePath=known.find(path=>existsSync(path));if(!chromePath)throw new Error('Chrome ou Edge não encontrado para Lighthouse. Execute npm run setup.');
 const chrome=await chromeLauncher.launch({chromePath,chromeFlags:['--headless=new','--no-first-run']});
 try{const runner=await lighthouse(url,{port:chrome.port,logLevel:'error',output:'json',formFactor:'mobile',onlyCategories:['performance','accessibility','best-practices','seo'],maxWaitForLoad:30000});
  if(!runner?.lhr)throw new Error('Lighthouse não produziu relatório.');const report=runner.lhr;if(report.runtimeError)throw new Error(report.runtimeError.message);
  return {lighthouseVersion:report.lighthouseVersion,fetchTime:report.fetchTime,requestedUrl:report.requestedUrl,finalDisplayedUrl:report.finalDisplayedUrl,formFactor:'mobile',scores:Object.fromEntries(Object.entries(report.categories).map(([key,category])=>[key,category.score])),audits:report.audits,runWarnings:report.runWarnings};
 }finally{await chrome.kill();}
}

export async function checkLanguage(text,{endpoint='http://127.0.0.1:8081/v2/check',language='auto',signal}={}) {
 const url=new URL(endpoint);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Endpoint LanguageTool inválido.');
 const matches=[];let offset=0,requests=0;
 while(offset<text.length){const chunk=text.slice(offset,offset+19000);const response=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({text:chunk,language}),signal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});if(!response.ok)throw new Error('LanguageTool retornou HTTP '+response.status);const data=await response.json();for(const match of data.matches||[])matches.push({...match,offset:match.offset+offset});offset+=chunk.length;requests++;}
 return {provider:'LanguageTool',language,matches,charactersChecked:offset,requests,complete:offset===text.length};
}

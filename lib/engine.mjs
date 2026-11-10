import robotsParser from 'robots-parser';
import { XMLParser } from 'fast-xml-parser';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {createHash} from 'node:crypto';
import { normalizeUrl,findNearDuplicates } from './analyze.mjs';
import { classifyContentType } from './resource-types.mjs';
import { computeLinkScores,applySegments } from './graph.mjs';
import { analyzeFetchedPage } from './page-analysis.mjs';

export const defaults={mode:'spider',concurrency:4,delayMs:100,maxUrls:0,maxDepth:0,timeoutMs:20000,maxBodyBytes:16*1024*1024,userAgent:'SpiderLocal/0.1 (+local SEO audit)',respectRobots:true,crawlSubdomains:false,followExternal:false,maxExternalUrls:0,checkImages:true,crawlResources:true,crawlCanonicals:true,renderJavaScript:false,renderWaitMs:500,accessibility:false,screenshots:false,discoverSitemaps:false,nearDuplicates:false,nearDuplicateThreshold:.9,segments:[],crawlAMP:true,validateAMP:false,mobileAudit:false,spellCheck:false,grammarEndpoint:'http://127.0.0.1:8081/v2/check',grammarLanguage:'auto',formLoginUrl:'',formUsername:'',formPassword:'',formUsernameSelector:'input[name=username]',formPasswordSelector:'input[type=password]',formSubmitSelector:'button[type=submit]',formSuccessSelector:'',customExtractions:[],customSearch:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function validateConfig(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Configuração inválida.');
  const config={...defaults,...input};
  let urls=Array.isArray(config.urls)?config.urls:String(config.urls||'').split(/\s+/).filter(Boolean);
  if(!config.url&&urls.length)config.url=urls[0];
  config.url=normalizeUrl(config.url);if(!config.url)throw new Error('Informe uma URL HTTP ou HTTPS válida.');
  if(config.mode==='list'&&!urls.length)urls=[config.url];
  config.urls=urls.map(u=>{const n=normalizeUrl(u);if(!n)throw new Error('URL inválida na lista: '+u);return n;});
  for(const [key,min,max] of [['concurrency',1,32],['delayMs',0,60000],['maxUrls',0,Number.MAX_SAFE_INTEGER],['maxExternalUrls',0,Number.MAX_SAFE_INTEGER],['maxDepth',0,10000],['timeoutMs',1000,180000],['renderWaitMs',0,30000],['maxBodyBytes',1024,128*1024*1024]]){
    config[key]=Number(config[key]);if(!Number.isSafeInteger(config[key])||config[key]<min||config[key]>max)throw new Error('Valor inválido: '+key);
  }
  for(const key of ['include','exclude'])if(config[key]){if(typeof config[key]!=='string'||config[key].length>500)throw new Error('Expressão muito longa: '+key);try{new RegExp(config[key]);}catch{throw new Error('Expressão inválida: '+key);}}
  if(!['spider','list'].includes(config.mode))throw new Error('Modo deve ser spider ou list.');
  if(!Array.isArray(config.customExtractions)||!Array.isArray(config.customSearch))throw new Error('Extrações e pesquisas devem ser listas.');
  if(config.customExtractions.length>100||config.customSearch.length>100)throw new Error('Máximo de 100 regras de extração/pesquisa por execução.');
  for(const item of [...config.customExtractions,...config.customSearch])if(!item||typeof item!=='object'||typeof item.name!=='string'||!item.name.trim())throw new Error('Cada regra personalizada deve ter um nome.');
  for(const item of config.customExtractions)if(!['css','xpath','regex'].includes(item.type)||typeof(item.selector??item.pattern)!=='string')throw new Error('Extração exige tipo css, xpath ou regex e um seletor/padrão.');
  for(const item of config.customSearch)if(typeof item.pattern!=='string'||!item.pattern)throw new Error('Cada pesquisa precisa de um padrão.');
  config.nearDuplicateThreshold=Number(config.nearDuplicateThreshold);
  if(!Number.isFinite(config.nearDuplicateThreshold)||config.nearDuplicateThreshold<0.5||config.nearDuplicateThreshold>1)throw new Error('Limiar de semelhança deve estar entre 0,5 e 1.');
  if(!config.headers||typeof config.headers!=='object'||Array.isArray(config.headers))config.headers={};
  for(const key of Object.keys(config.headers))if(/^(host|connection|content-length|transfer-encoding|origin)$/i.test(key))delete config.headers[key];
  if(!Array.isArray(config.segments)||config.segments.some(segment=>!segment||!segment.name||typeof segment.pattern!=='string'))throw new Error('Segmentos devem ser uma lista de nomes e padrões.');
  for(const segment of config.segments){if(segment.pattern.length>500)throw new Error('Padrão de segmento muito longo.');new RegExp(segment.pattern);}
  if(config.formLoginUrl){config.formLoginUrl=normalizeUrl(config.formLoginUrl);if(!config.formLoginUrl||new URL(config.formLoginUrl).origin!==new URL(config.url).origin)throw new Error('O formulário de login deve pertencer ao mesmo domínio da URL inicial.');if(!config.formUsername||!config.formPassword)throw new Error('Preencha usuário e senha do formulário para esta execução.');}
  return config;
}
export async function launchBrowser() {
  const errors=[];
  for(const channel of [undefined,'msedge','chrome']) {
    try{return await chromium.launch({headless:true,...(channel?{channel}:{})});}catch(e){errors.push(String(e.message).split('\n')[0]);}
  }
  throw new Error('Navegador Chromium não encontrado. Instale Chromium com "npx playwright install chromium" ou use Chrome/Edge instalado. '+errors.join('; '));
}
export function connectionError(error) {
  const cause=error?.cause;
  const code=error?.networkCode||cause?.code||cause?.errors?.[0]?.code||error?.code;
  const reason={EACCES:'Acesso à rede negado pelo sistema',EPERM:'Acesso à rede negado pelo sistema',ENOTFOUND:'Não foi possível resolver o domínio',EAI_AGAIN:'Falha temporária de DNS',ECONNREFUSED:'Conexão recusada',ECONNRESET:'Conexão interrompida',ETIMEDOUT:'Tempo de conexão esgotado',CERT_HAS_EXPIRED:'Certificado TLS expirado',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'Não foi possível verificar o certificado TLS'}[code];
  return {code:code||null,message:reason?reason+' ('+code+').':error?.message||'Falha de conexão.'};
}

export class Crawler {
  constructor(store,dataDir){this.store=store;this.dataDir=dataDir;this.active=new Map();}
  async create(input){if(this.active.size>=2)throw new Error('Já há duas sessões em execução.');const config=validateConfig(input),job=this.store.create(config);this.start(job.id,config);return this.store.job(job.id);}
  start(id,provided) {
    if(this.active.has(id))return;
    const saved=this.store.job(id);if(!saved)throw new Error('Sessão não encontrada.');
    if(this.active.size>=2)throw new Error('Já há duas sessões em execução. Pause uma para iniciar outra.');
    const runtime={id,config:validateConfig(provided||saved.config),abort:new AbortController(),requested:null,robots:new Map(),gates:new Map(),sitemapUrls:new Set(),sitemaps:new Set()};
    this.active.set(id,runtime);this.store.setStatus(id,'running');
    runtime.promise=this.run(runtime).catch(e=>{this.store.setStatus(id,'failed',e.message);}).finally(async()=>{
      if(runtime.context)await runtime.context.close().catch(()=>{});if(runtime.browser)await runtime.browser.close().catch(()=>{});this.active.delete(id);
    });
  }
  async control(id,action) {
    const runtime=this.active.get(id);
    if(action==='resume'){this.start(id);return this.store.job(id);}
    if(runtime){runtime.requested=action==='pause'?'paused':'stopped';this.store.setStatus(id,action==='pause'?'pausing':'stopping');if(action==='stop')runtime.abort.abort();}
    return this.store.job(id);
  }
  inScope(runtime,url) {
    const base=new URL(runtime.config.url),target=new URL(url);
    if(runtime.config.mode==='list')return runtime.config.urls.includes(url);
    if(target.origin===base.origin)return true;
    return runtime.config.crawlSubdomains&&target.hostname.endsWith('.'+base.hostname)&&['http:','https:'].includes(target.protocol);
  }
  queue(runtime,url,depth,kind='page',discoveredRecord=null) {
    if(!url)return;const {config,id}=runtime,internal=this.inScope(runtime,url);
    if(config.maxDepth&&depth>config.maxDepth)return;
    if(config.exclude&&new RegExp(config.exclude).test(url))return;
    if(config.include&&!new RegExp(config.include).test(url)&&url!==config.url)return;
    if(!internal&&!config.followExternal)return;
    if(!internal&&config.followExternal&&config.maxExternalUrls>0&&this.store.db.prepare('SELECT count(*) n FROM urls WHERE job=? AND internal=0').get(id).n>=config.maxExternalUrls){this.store.note(id,'Verificação externa limitada a '+config.maxExternalUrls+' destinos diretamente referenciados, sem descoberta de links externos.');return;}
    if(config.maxUrls&&this.store.stats(id).found>=config.maxUrls){this.store.note(id,'Rastreamento limitado pelo maxUrls configurado: '+config.maxUrls);return;}
    this.store.enqueue(id,url,depth,internal?kind:'external',internal,discoveredRecord);
  }
  headers(runtime,url) {
    const config=runtime.config,headers={'user-agent':config.userAgent,accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'};
    if(new URL(url).origin===new URL(config.url).origin){Object.assign(headers,config.headers);if(config.cookie)headers.cookie=config.cookie;if(runtime.cookieJar){const target=new URL(url);headers.cookie=runtime.cookieJar.filter(cookie=>(cookie.domain.replace(/^[.]/,'')===target.hostname||target.hostname.endsWith('.'+cookie.domain.replace(/^[.]/,'')))&&target.pathname.startsWith(cookie.path||'/')&&(!cookie.secure||target.protocol==='https:')&&(cookie.expires<=0||cookie.expires>Date.now()/1000)).map(cookie=>cookie.name+'='+cookie.value).join('; ');}if(config.username)headers.authorization='Basic '+Buffer.from(config.username+':'+(config.password||'')).toString('base64');}
    return headers;
  }
  async gate(runtime,url,delay=0) {
    const origin=new URL(url).origin,now=Date.now(),next=runtime.gates.get(origin)||now;
    const slot=Math.max(next,now);runtime.gates.set(origin,slot+Math.max(runtime.config.delayMs,delay));
    if(slot>now)await sleep(slot-now);if(runtime.abort.signal.aborted)throw new Error('Interrompido.');
  }
  async raw(runtime,url,{method='GET',delay=0,retainBody}={}) {
    await this.gate(runtime,url,delay);
    const response=await fetch(url,{method,headers:this.headers(runtime,url),redirect:'manual',signal:AbortSignal.any([runtime.abort.signal,AbortSignal.timeout(runtime.config.timeoutMs)])});
    const headers=Object.fromEntries(response.headers),chunks=[];let bytes=0,bodyComplete=true;
    const keepBody=retainBody??/html|xhtml/i.test(headers['content-type']||'');
    if(response.body)for await(const chunk of response.body){
      const remaining=runtime.config.maxBodyBytes-bytes;
      if(chunk.length>remaining){if(keepBody&&remaining>0)chunks.push(chunk.subarray(0,remaining));bytes+=Math.max(0,remaining);bodyComplete=false;break;}
      bytes+=chunk.length;if(keepBody)chunks.push(chunk);
    }
    return {status:response.status,statusText:response.statusText,headers,body:Buffer.concat(chunks),bytes,bodyComplete,url};
  }
  async robots(runtime,url) {
    const origin=new URL(url).origin,sourceUrl=origin+'/robots.txt';
    if(!runtime.robots.has(origin))runtime.robots.set(origin,(async()=>{
      const available=(text,status=200)=>({state:'available',rules:robotsParser(sourceUrl,text),sourceUrl,status});
      const unavailable=(reason,errorCode=null,status=null)=>{
        const result={state:'unavailable',rules:null,sourceUrl,status,reason,errorCode};
        this.store.note(runtime.id,'Não foi possível verificar '+sourceUrl+': '+reason+(runtime.config.respectRobots?' As páginas deste host não serão solicitadas até a consulta funcionar.':' A descoberta de sitemap por robots.txt está indisponível.'));
        return result;
      };
      if(runtime.config.customRobots)return available(runtime.config.customRobots);
      let current=sourceUrl;
      try {
        for(let i=0;i<6;i++) {
          const response=await this.raw(runtime,current,{retainBody:true});
          if([301,302,303,307,308].includes(response.status)&&response.headers.location){
            const next=normalizeUrl(response.headers.location,current);
            if(!next)return unavailable('Redirecionamento de robots.txt inválido.');
            current=next;continue;
          }
          if(response.bodyComplete===false)return unavailable('robots.txt excedeu o limite de bytes; regras incompletas não foram aplicadas.',null,response.status);
          if(response.status===200)return available(response.body.toString('utf8'));
          if(response.status>=400&&response.status<500&&![401,403,429].includes(response.status))return available('',response.status);
          return unavailable('robots.txt retornou HTTP '+response.status+'.',null,response.status);
        }
        return unavailable('robots.txt excedeu o limite de redirecionamentos.');
      }catch(error){const failure=connectionError(error);return unavailable(failure.message,failure.code);}
    })());
    return runtime.robots.get(origin);
  }
  async request(runtime,url,checkRobots=true,options={}) {
    const chain=[];let current=url;
    for(let i=0;i<11;i++) {
      let delay=0;
      if(checkRobots&&runtime.config.respectRobots){const robots=await this.robots(runtime,current);if(robots.state==='unavailable'){const error=new Error('robots.txt não verificado: '+robots.reason);error.code='ROBOTS_UNAVAILABLE';error.networkCode=robots.errorCode;throw error;}if(robots.rules.isAllowed(current,runtime.config.userAgent)===false)return {blocked:true,url:current,redirectChain:chain};delay=(robots.rules.getCrawlDelay(runtime.config.userAgent)||0)*1000;}
      const r=await this.raw(runtime,current,{...options,delay});
      if([301,302,303,307,308].includes(r.status)&&r.headers.location){chain.push({url:current,status:r.status,statusText:r.statusText,location:r.headers.location});const next=normalizeUrl(r.headers.location,current);if(!next)throw new Error('Redirecionamento para protocolo inválido.');if(chain.some(x=>x.url===next))throw new Error('Loop de redirecionamento.');current=next;continue;}
      return {...r,redirectChain:chain};
    }
    throw new Error('Mais de 10 redirecionamentos.');
  }
  async sitemap(runtime,url,depth=0) {
    if(depth>8||runtime.sitemaps.has(url))return;runtime.sitemaps.add(url);
    try {
      const response=await this.request(runtime,url,false,{retainBody:true});if(response.status!==200)return;
      if(response.bodyComplete===false)throw new Error('Sitemap excedeu o limite de bytes; documento incompleto não foi analisado.');
      let body=response.body;if(body[0]===0x1f&&body[1]===0x8b)body=gunzipSync(body,{maxOutputLength:runtime.config.maxBodyBytes});
      const xml=new XMLParser({ignoreAttributes:false,processEntities:false}).parse(body.toString('utf8'));
      const list=value=>value?(Array.isArray(value)?value:[value]):[];
      for(const entry of list(xml.sitemapindex?.sitemap)){const location=normalizeUrl(String(entry.loc||''),url);if(location&&this.inScope(runtime,location))await this.sitemap(runtime,location,depth+1);}
      for(const entry of list(xml.urlset?.url)){const location=normalizeUrl(String(entry.loc||''),url);if(location&&this.inScope(runtime,location)){runtime.sitemapUrls.add(location);this.queue(runtime,location,0);this.store.merge(runtime.id,location,{inSitemap:true});}}
    }catch(e){this.store.note(runtime.id,'Falha ao ler sitemap '+url+': '+e.message);}
  }
  async setupBrowser(runtime) {
    runtime.browser=await launchBrowser();
    runtime.context=await runtime.browser.newContext({userAgent:runtime.config.userAgent,acceptDownloads:false,serviceWorkers:'block',httpCredentials:runtime.config.username?{username:runtime.config.username,password:runtime.config.password||'',origin:new URL(runtime.config.url).origin}:undefined});
    await runtime.context.route('**/*',async route=>{
      const url=route.request().url();
      if(!/^https?:/.test(url))return route.continue();
      const headers={...route.request().headers(),...this.headers(runtime,url)};
      if(new URL(url).origin!==new URL(runtime.config.url).origin){delete headers.authorization;delete headers.cookie;}
      await route.continue({headers});
    });
    if(runtime.config.cookie)await runtime.context.addCookies(runtime.config.cookie.split(';').map(c=>{const at=c.indexOf('=');return {name:c.slice(0,at).trim(),value:c.slice(at+1).trim(),url:new URL(runtime.config.url).origin};}).filter(c=>c.name));
    if(runtime.config.formLoginUrl){const page=await runtime.context.newPage();try{await page.goto(runtime.config.formLoginUrl,{waitUntil:'domcontentloaded',timeout:runtime.config.timeoutMs});await page.locator(runtime.config.formUsernameSelector).fill(runtime.config.formUsername);await page.locator(runtime.config.formPasswordSelector).fill(runtime.config.formPassword);await page.locator(runtime.config.formSubmitSelector).click({timeout:runtime.config.timeoutMs});if(runtime.config.formSuccessSelector)await page.locator(runtime.config.formSuccessSelector).waitFor({timeout:runtime.config.timeoutMs});else await page.waitForTimeout(300);runtime.cookieJar=await runtime.context.cookies();if(!runtime.cookieJar.length)throw new Error('O formulário não produziu cookies de sessão. Confira os seletores e o resultado do login.');}finally{await page.close();}}
  }
  async render(runtime,url) {
    const page=await runtime.context.newPage(),consoleErrors=[],resources=[],failures=[];
    const interrupted=()=>{page.close().catch(()=>{});};
    const deadline=setTimeout(interrupted,runtime.config.timeoutMs+runtime.config.renderWaitMs);
    runtime.abort.signal.addEventListener('abort',interrupted,{once:true});
    page.on('pageerror',e=>consoleErrors.push(e.message));page.on('response',r=>resources.push({url:r.url(),status:r.status(),type:r.request().resourceType()}));page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));
    try {
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:runtime.config.timeoutMs});await page.waitForTimeout(runtime.config.renderWaitMs);
      let customJavaScript;
      if(runtime.config.customJavaScript)customJavaScript=await page.evaluate(async source=>{try{const value=await new Function('return (async()=>{'+source+'})()')();return {value:JSON.parse(JSON.stringify(value??null))};}catch(e){return {error:e.message};}},runtime.config.customJavaScript);
      let accessibility;
      if(runtime.config.accessibility){const r=await new AxeBuilder({page}).analyze();accessibility={violations:r.violations,incomplete:r.incomplete,passes:r.passes.map(v=>({id:v.id,description:v.description})),inapplicable:r.inapplicable.map(v=>v.id)};}
      let screenshot;
      if(runtime.config.screenshots){const filename=createHash('sha256').update(url).digest('hex')+'.png';const dir=join(this.dataDir,runtime.id,'screenshots');await mkdir(dir,{recursive:true});await page.screenshot({path:join(dir,filename),fullPage:false});screenshot='/api/jobs/'+runtime.id+'/screenshots/'+filename;}
      return {html:await page.content(),js:{consoleErrors,resources,failures,finalUrl:page.url()},accessibility,customJavaScript,screenshot};
    }finally{clearTimeout(deadline);runtime.abort.signal.removeEventListener('abort',interrupted);await page.close();}
  }
  async visit(runtime,entry) {
    const start=Date.now(),{id,config}=runtime;
    let record={url:entry.url,depth:entry.depth,kind:entry.kind,internal:!!entry.internal,issues:[],links:[],images:[]};
    try {
      const r=await this.request(runtime,entry.url);
      if(r.blocked){record={...record,finalUrl:r.url,statusCode:null,indexable:false,indexabilityReason:'Bloqueado por robots.txt',blocked:true,redirectChain:r.redirectChain,issues:[{code:'robots-blocked',category:'directives',severity:'info',message:'URL bloqueada por robots.txt.'}]};}
      else {
        const contentType=r.headers['content-type']||'';
        record={...record,finalUrl:r.url,statusCode:r.redirectChain[0]?.status||r.status,finalStatus:r.status,statusText:r.redirectChain[0]?.statusText||r.statusText,headers:r.headers,redirectChain:r.redirectChain,contentType,bytes:r.bytes,responseTime:Date.now()-start,inSitemap:runtime.sitemapUrls.has(entry.url)||!!JSON.parse(entry.record||'{}').inSitemap};
        const html=/html|xhtml/i.test(contentType);
        record.bodyComplete=r.bodyComplete!==false;
        if(!record.bodyComplete){
          record.indexable=false;record.indexabilityReason='Corpo incompleto; indexabilidade não verificada';record.analysisComplete=false;
          record.issues.push({code:'body-too-large',category:'response',severity:'warning',message:'Resposta HTTP '+r.status+' preservada. O corpo excedeu o limite de '+config.maxBodyBytes+' bytes e não foi analisado.'});
        }else if(html&&r.status>=200&&r.status<300&&entry.internal&&!r.redirectChain.length) {
          const originalHtml=r.body.toString('utf8');
          let rendering={};if(runtime.context)rendering=await this.render(runtime,r.url);
          Object.assign(record,await analyzeFetchedPage({url:r.url,html:rendering.html||originalHtml,headers:r.headers,status:r.status,config},{signal:runtime.abort.signal}),rendering);
          delete record.html;
          if(config.validateAMP&&record.isAmp||config.mobileAudit||config.spellCheck){
            const validators=await import('./validation.mjs');
            if(config.validateAMP&&record.isAmp)try{record.ampValidation=await validators.validateAmp(rendering.html||originalHtml,join(this.dataDir,'validators'));if(record.ampValidation.status!=='PASS')record.issues.push({code:'amp-invalid',category:'amp',severity:'error',message:'O validador oficial AMP encontrou erros.'});}catch(error){record.ampValidation={status:'ERROR',error:error.message};record.issues.push({code:'amp-validation-error',category:'amp',severity:'error',message:error.message});}
            if(config.spellCheck)try{record.spelling=await validators.checkLanguage(record.text,{endpoint:config.grammarEndpoint,language:config.grammarLanguage,signal:runtime.abort.signal});if(record.spelling.matches.length)record.issues.push({code:'spelling-grammar',category:'spelling',severity:'warning',message:record.spelling.matches.length+' ocorrências de ortografia/gramática.'});}catch(error){record.spelling={error:error.message,complete:false};record.issues.push({code:'spelling-error',category:'spelling',severity:'error',message:error.message});}
            if(config.mobileAudit)try{const audit=(runtime.auditChain||Promise.resolve()).catch(()=>{}).then(()=>validators.mobileLighthouse(r.url));runtime.auditChain=audit;record.mobile=await audit;}catch(error){record.mobile={error:error.message};record.issues.push({code:'mobile-audit-error',category:'mobile',severity:'error',message:error.message});}
          }
          record.url=entry.url;record.originalHtml=originalHtml;
          if(rendering.html)record.renderedHtml=rendering.html;
          if(record.accessibility?.violations.length)record.issues.push({code:'accessibility-violations',category:'accessibility',severity:'warning',message:record.accessibility.violations.length+' regras de acessibilidade com violações.'});
          if(record.js?.consoleErrors.length)record.issues.push({code:'javascript-error',category:'javascript',severity:'warning',message:'Erros JavaScript durante a renderização.'});
          if(record.customJavaScript?.error)record.issues.push({code:'custom-javascript-error',category:'javascript',severity:'warning',message:record.customJavaScript.error});
          if(r.redirectChain.length){record.indexable=false;record.indexabilityReason='Redirecionamento';}
          const graphLinks=[...record.links,...record.images.filter(img=>img.url).map(img=>({url:img.url,text:img.alt||'',rel:'',type:'image',follow:true}))];this.store.db.prepare('DELETE FROM links WHERE job=? AND source=?').run(id,entry.url);this.store.addLinks(id,entry.url,graphLinks);
          if(config.mode==='spider')for(const link of record.links){
            const resource=link.type==='resource',image=link.resourceType==='image';
            // Newly supported resource crawling stays on the selected origin.
            if(resource&&!this.inScope(runtime,link.url)&&!config.followExternal)continue;
            const allowed=link.type==='anchor'?link.follow!==false:link.resourceType==='canonical'?config.crawlCanonicals:link.resourceType==='amp'?config.crawlAMP:link.resourceType==='document'||image?(!image||config.checkImages):config.crawlResources&&['css','javascript','media'].includes(link.resourceType);
            if(allowed)this.queue(runtime,link.url,entry.depth+1,image?'image':resource&&link.resourceType!=='canonical'&&link.resourceType!=='document'?'resource':'page');
          }
          for(const image of record.images.filter(image=>image.url)){const internal=this.inScope(runtime,image.url);if(config.checkImages){this.queue(runtime,image.url,entry.depth+1,'image');}else if(internal){if(!config.maxUrls||this.store.stats(id).found<config.maxUrls)this.store.enqueue(id,image.url,entry.depth+1,'image',true,{...image,url:image.url,contentType:'image (não solicitado)',issues:[],indexable:false,indexabilityReason:'Imagem; status HTTP não verificado',images:[]});}}
          for(const link of record.links.filter(l=>!l.internal))if(!config.followExternal&&(!config.maxUrls||this.store.stats(id).found<config.maxUrls))this.store.enqueue(id,link.url,entry.depth+1,'external',false,{url:link.url,issues:[],indexable:false,indexabilityReason:'Link externo; status HTTP não verificado'});
          const dir=join(this.dataDir,id,'sources');await mkdir(dir,{recursive:true});await writeFile(join(dir,entry.id+'.json'),JSON.stringify({originalHtml:record.originalHtml,renderedHtml:record.renderedHtml}));delete record.originalHtml;delete record.renderedHtml;
        }else {const noindex=/(?:^|[ ,:])(noindex|none)(?:$|[ ,])/i.test(r.headers['x-robots-tag']||'');record.indexable=r.status>=200&&r.status<300&&!r.redirectChain.length&&!noindex;record.indexabilityReason=r.redirectChain.length?'Redirecionamento':noindex?'Noindex':record.indexable?'Indexable':'HTTP '+r.status;
          if(r.redirectChain.length&&config.mode==='spider'&&entry.internal&&this.inScope(runtime,r.url))this.queue(runtime,r.url,entry.depth,'page');
        }
        record.resourceType=classifyContentType(contentType);
        if(r.status>=400)record.issues.push({code:'http-'+Math.floor(r.status/100)+'xx',category:'response',severity:'error',message:'Resposta HTTP '+r.status+'.'});
        if(r.redirectChain.length>1)record.issues.push({code:'redirect-chain',category:'response',severity:'warning',message:'Cadeia com '+r.redirectChain.length+' redirecionamentos.'});
        if(entry.internal)record.kind=html?'page':record.resourceType==='image'?'image':'resource';
      }
    }catch(e){
      if(runtime.abort.signal.aborted&&runtime.requested){this.store.db.prepare("UPDATE urls SET state='queued' WHERE job=? AND id=?").run(id,entry.id);return;}
      const failure=connectionError(e),robotsUnavailable=e.code==='ROBOTS_UNAVAILABLE',received=record.statusCode>0;
      record={...record,statusCode:received?record.statusCode:0,analysisComplete:false,indexable:false,indexabilityReason:robotsUnavailable?'robots.txt não verificado':received?'Falha de análise; resposta HTTP preservada':'Erro de rastreamento',error:robotsUnavailable?e.message:failure.message,errorCode:failure.code,responseTime:Date.now()-start};
      record.issues.push({code:robotsUnavailable?'robots-unavailable':received?'analysis-error':'fetch-error',category:robotsUnavailable?'directives':'response',severity:'error',message:record.error});
    }
    record.segments=applySegments(entry.url,config.segments);
    if(!record.links?.length)this.store.db.prepare('DELETE FROM links WHERE job=? AND source=?').run(id,entry.url);
    this.store.save(id,entry.id,record);
  }
  async postprocess(runtime) {
    const {id}=runtime;this.store.setStatus(id,'analyzing');computeLinkScores(this.store,id);
    for(const row of this.store.iterate(id,{tab:'internal'})){if(runtime.requested)return;const derived=new Set(['duplicate-title','duplicate-description','duplicate-content','near-duplicate','broken-outlink','canonical-broken','hreflang-no-return','sitemap-nonindexable']);if((row.issues||[]).some(i=>derived.has(i.code)))this.store.merge(id,row.url,{issues:row.issues.filter(i=>!derived.has(i.code))});}
    for(const [field,code,category,label] of [['title','duplicate-title','titles','Título repetido'],['description','duplicate-description','descriptions','Descrição repetida'],['textHash','duplicate-content','content','Conteúdo idêntico']]) {
      const duplicates=this.store.db.prepare(`SELECT json_extract(record,'$.${field}') value FROM urls WHERE job=? AND kind='page' AND statusCode BETWEEN 200 AND 299 AND json_extract(record,'$.${field}') IS NOT NULL AND json_extract(record,'$.${field}')!='' GROUP BY value HAVING count(*)>1`).all(id);
      for(const {value} of duplicates)for(const {url} of this.store.db.prepare(`SELECT url FROM urls WHERE job=? AND statusCode BETWEEN 200 AND 299 AND json_extract(record,'$.${field}')=?`).all(id,value))this.store.issue(id,url,{code,category,severity:'warning',message:label+'.'});
    }
    for(const link of this.store.db.prepare('SELECT l.source,l.target,u.statusCode,u.record FROM links l JOIN urls u ON u.job=l.job AND u.url=l.target WHERE l.job=? AND (u.statusCode>=400 OR u.statusCode=0)').iterate(id))this.store.issue(id,link.source,{code:'broken-outlink',category:'links',severity:'error',message:'Destino indisponível: '+link.target});
    let analyzed=0;
    for(const row of this.store.iterate(id,{tab:'internal'}))if(row.kind==='page') {
      if(++analyzed%50===0){await sleep(0);if(runtime.requested)return;}
      if(row.canonical){const target=this.store.byUrl(id,row.canonical);if(target&&target.statusCode>=400)this.store.issue(id,row.url,{code:'canonical-broken',category:'canonicals',severity:'error',message:'Canonical aponta para URL com erro.'});}
      for(const alternate of row.hreflang||[]){const target=this.store.byUrl(id,alternate.url);if(target&&target.statusCode>=200&&target.statusCode<300&&target.bodyComplete!==false&&Array.isArray(target.hreflang)&&!target.hreflang.some(a=>a.url===row.url))this.store.issue(id,row.url,{code:'hreflang-no-return',category:'hreflang',severity:'warning',message:'Hreflang sem referência de retorno: '+alternate.url});}
      if(row.inSitemap&&!row.indexable)this.store.issue(id,row.url,{code:'sitemap-nonindexable',category:'sitemaps',severity:'warning',message:'URL no sitemap não é indexável segundo as diretivas verificadas.'});
    }
    if(runtime.config.nearDuplicates){this.store.note(id,'Duplicidade aproximada: cobertura limitada aos primeiros 1.000 documentos com texto e às primeiras 10.000 palavras de cada documento; similaridade Jaccard, diferente do algoritmo do Screaming Frog.');const pairs=findNearDuplicates([...this.store.iterate(id,{tab:'internal'})].filter(r=>r.kind==='page'),runtime.config.nearDuplicateThreshold);for(const pair of pairs){for(const url of [pair.urlA,pair.urlB])this.store.issue(id,url,{code:'near-duplicate',category:'content',severity:'warning',message:'Conteúdo similar ('+Math.round(pair.similarity*100)+'%): '+(url===pair.urlA?pair.urlB:pair.urlA)});}}
  }
  async run(runtime) {
    const {id,config}=runtime;
    if(config.renderJavaScript||config.accessibility||config.customJavaScript||config.screenshots||config.formLoginUrl)await this.setupBrowser(runtime);
    if(this.store.stats(id).found===0){if(config.mode==='list')for(const url of config.urls)this.queue(runtime,url,0);else{this.queue(runtime,config.url,0);if(config.discoverSitemaps){const robots=await this.robots(runtime,config.url);if(robots.state==='available'){const sitemaps=robots.rules.getSitemaps();for(const url of sitemaps.length?sitemaps:[new URL('/sitemap.xml',config.url).href])if(this.inScope(runtime,url))await this.sitemap(runtime,url);}}}}
    const tasks=new Set();
    while(!runtime.requested) {
      while(tasks.size<config.concurrency){const entry=this.store.reserve(id);if(!entry)break;let task;task=this.visit(runtime,entry).finally(()=>tasks.delete(task));tasks.add(task);}
      if(!tasks.size)break;await Promise.race(tasks);
    }
    await Promise.allSettled(tasks);
    if(runtime.requested){this.store.setStatus(id,runtime.requested);return;}
    const stats=this.store.stats(id);if(!runtime.requested&&stats.html===0&&stats.failed>0){this.store.setStatus(id,'failed','Nenhuma página HTML foi obtida. Verifique os erros de conexão e de robots.txt nos resultados.');return;}
    if(stats.html>0&&!this.store.db.prepare("SELECT count(*) n FROM urls WHERE job=? AND state='done' AND internal=1 AND statusCode BETWEEN 200 AND 299 AND json_extract(record,'$.textHash') IS NOT NULL").get(id).n){this.store.setStatus(id,'failed','Nenhuma página HTML foi analisada com sucesso. Consulte os erros HTTP, de renderização ou de tamanho nos resultados.');return;}
    await this.postprocess(runtime);this.store.setStatus(id,runtime.requested||'completed');
  }
  async shutdown(){for(const r of this.active.values()){r.requested='paused';r.abort.abort();}await Promise.allSettled([...this.active.values()].map(r=>r.promise));}
}

import http from 'node:http';
import { readFile,stat,mkdtemp,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import { createReadStream } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { dirname,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store,safeSavedConfig } from './lib/store.mjs';
import { buildGraph } from './lib/graph.mjs';
import { Crawler,validateConfig,launchBrowser } from './lib/engine.mjs';
import { exportJob } from './lib/export.mjs';
import { runIntegration,validateIntegration,integrationProviders } from './lib/integrations.mjs';
import featureSpec from './docs/features.json' with { type: 'json' };
import packageSpec from './package.json' with {type:'json'};

const root=dirname(fileURLToPath(import.meta.url));
const features=featureSpec.features;
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2*1024*1024)throw new Error('Requisição maior que 2 MiB.');}try{return text?JSON.parse(text):{};}catch{throw new Error('JSON inválido.');}}
const validId=id=>/^[a-f0-9-]{36}$/.test(id);

export async function createApplication({dataDir,port=4318,hostname='127.0.0.1',browserProbe=true}={}) {
 const temporary=!dataDir;
 if(temporary)dataDir=await mkdtemp(join(tmpdir(),'csw-crawler-session-'));
 const store=new Store(join(dataDir,'spider.sqlite')),crawler=new Crawler(store,dataDir),integrations=new Map();
 let browserAvailable=false;
 if(browserProbe){try{const browser=await launchBrowser();browserAvailable=true;await browser.close();}catch{}}
 const server=http.createServer(async(req,res)=>{
  try{
   const requestUrl=new URL(req.url,'http://127.0.0.1'),pathname=requestUrl.pathname,host=req.headers.host||'';
   const allowedHosts=['127.0.0.1','localhost',hostname].filter(name=>name!=='0.0.0.0');
   if(!allowedHosts.some(name=>host===name||(host.startsWith(name+':')&&/^\d+$/.test(host.slice(name.length+1)))))return json(res,403,{error:'Host não autorizado para esta instância.'});
   if(req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'Origem não autorizada.'});
   if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Acesso entre sites recusado.'});
   res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
   res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
   if(pathname==='/api/health')return json(res,200,{ok:true,version:packageSpec.version});
   if(pathname==='/api/capabilities')return json(res,200,{features,browserAvailable,storage:{mode:temporary?'session':'persistent'},integrations:integrationProviders,completeParity:featureSpec.completeParity,reference:featureSpec.reference});
   if(pathname==='/api/jobs'){
    if(req.method==='GET')return json(res,200,store.jobs());
    if(req.method==='POST')return json(res,201,await crawler.create(await body(req)));
   }
   if(pathname==='/api/compare'&&req.method==='GET'){
    const a=requestUrl.searchParams.get('a'),b=requestUrl.searchParams.get('b');if(!validId(a)||!validId(b)||!store.job(a)||!store.job(b))return json(res,404,{error:'Selecione duas sessões existentes.'});return json(res,200,store.compare(a,b));
   }
   if(pathname==='/api/schedules'){
    if(req.method==='GET')return json(res,200,store.db.prepare('SELECT * FROM schedules ORDER BY nextAt').all().map(r=>({...r,config:JSON.parse(r.config)})));
    if(req.method==='POST'){
     const input=await body(req),config=validateConfig(input.config||input),interval=Number(input.intervalMinutes);
     if(!Number.isInteger(interval)||interval<1||interval>525600)throw new Error('Intervalo deve ser de 1 a 525600 minutos.');
     if(config.username||config.password||config.cookie||config.formLoginUrl||Object.keys(config.headers||{}).length)throw new Error('Agendamentos aceitam apenas páginas públicas, sem credenciais ou cabeçalhos personalizados. Execute análises autenticadas manualmente.');
     const safeConfig=safeSavedConfig(config);safeConfig.headers={};
     const id=randomUUID(),nextAt=new Date(Date.now()+interval*60000).toISOString();
     store.db.prepare('INSERT INTO schedules(id,config,intervalMinutes,nextAt) VALUES(?,?,?,?)').run(id,JSON.stringify(safeConfig),interval,nextAt);return json(res,201,{id,nextAt,intervalMinutes:interval});
    }
   }
   const scheduleMatch=pathname.match(/^\/api\/schedules\/([a-f0-9-]{36})$/);
   if(scheduleMatch&&req.method==='DELETE'){store.db.prepare('DELETE FROM schedules WHERE id=?').run(scheduleMatch[1]);return json(res,200,{ok:true});}
   const match=pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(.*))?$/);
   if(match){
    const [,id,action='']=match,job=store.job(id);if(!job)return json(res,404,{error:'Sessão não encontrada.'});
    if(!action&&req.method==='GET')return json(res,200,{...job,integration:integrations.get(id)||null});
    if(action==='view'&&req.method==='GET'){
     const options=Object.fromEntries(requestUrl.searchParams);
     return json(res,200,{
      job:{...job,integration:integrations.get(id)||null},revision:job.revision,
      overview:options.sinceOverview===job.revision?null:store.overview(id),
      rows:options.sinceRows===store.rowsRevision(id,options)?null:store.rows(id,options),
     });
    }
    if(['pause','resume','stop'].includes(action)&&req.method==='POST')return json(res,200,await crawler.control(id,action));
    if(action==='rows'&&req.method==='GET')return json(res,200,store.rows(id,Object.fromEntries(requestUrl.searchParams)));
    if(/^rows\/\d+$/.test(action)&&req.method==='GET'){
     const row=store.detail(id,action.split('/')[1]);if(!row)return json(res,404,{error:'URL não encontrada.'});
     if(row.statusCode>=200&&row.statusCode<300&&row.analysisComplete!==false&&row.bodyComplete!==false&&!(row.redirectChain||[]).length)try{Object.assign(row,JSON.parse(await readFile(join(dataDir,id,'sources',row.id+'.json'),'utf8')));}catch{}
     row.html=row.renderedHtml||row.originalHtml||'';return json(res,200,row);
    }
    if(action==='graph'&&req.method==='GET')return json(res,200,buildGraph(store,id,Object.fromEntries(requestUrl.searchParams)));
    if(action==='overview')return json(res,200,store.overview(id));
    if(action==='recrawl'&&req.method==='POST'){
     if(crawler.active.has(id))throw new Error('Pause ou conclua a sessão antes de rastrear novamente.');
     const input=await body(req);if(!Array.isArray(input.ids)||!input.ids.every(Number.isSafeInteger))throw new Error('Informe IDs numéricos de URLs.');
     for(const rid of input.ids)store.db.prepare("UPDATE urls SET state='queued' WHERE job=? AND id=?").run(id,rid);
     crawler.start(id);return json(res,200,store.job(id));
    }
    if(action==='export'&&req.method==='GET'){
     const options=Object.fromEntries(requestUrl.searchParams),format=options.format||'csv',types={html:'text/html; charset=utf-8',csv:'text/csv; charset=utf-8',json:'application/json',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',sitemap:'application/xml'};
     if(!types[format])throw new Error('Formato inválido.');
     res.writeHead(200,{'content-type':types[format],'content-disposition':`attachment; filename="spider-${id.slice(0,8)}.${format==='sitemap'?'xml':format}"`});await exportJob(store,id,options,res);return;
    }
    if(/^screenshots\/[A-Za-z0-9_-]+\.png$/.test(action)&&req.method==='GET'){
     const path=join(dataDir,id,'screenshots',action.split('/')[1]);await stat(path);res.writeHead(200,{'content-type':'image/png'});createReadStream(path).pipe(res);return;
    }
    if(action==='integrate'&&req.method==='POST'){
     if(integrations.get(id)?.status==='running')throw new Error('Já existe uma integração em execução nesta sessão.');
     const options=await body(req);validateIntegration(options);
     const state={status:'running',provider:options.provider,startedAt:new Date().toISOString()};integrations.set(id,state);
     // No secrets in state, SQLite, logs or exported configuration.
     runIntegration(store,id,options).then(result=>integrations.set(id,{...state,status:'completed',result})).catch(e=>integrations.set(id,{...state,status:'failed',error:e.message}));
     return json(res,202,state);
    }
   }
   if(req.method==='GET'&&/^\/brand\/[a-zA-Z0-9_-]+\.(svg|woff2?)$/.test(pathname)){const type=pathname.endsWith('.svg')?'image/svg+xml':pathname.endsWith('.woff2')?'font/woff2':'font/woff';const data=await readFile(join(root,'public',pathname.slice(1)));res.writeHead(200,{'content-type':type,'cache-control':'public, max-age=3600'});res.end(data);return;}
   if(pathname==='/vendor/d3.min.js'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await readFile(join(root,'node_modules','d3','dist','d3.min.js')));return;}
   if(req.method==='GET'&&['/','/index.html','/app.js','/extras.js','/issue-guidance.js','/issues-ui.js','/style.css'].includes(pathname)){
    const file=pathname==='/'?'index.html':pathname.slice(1),type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-cache'});res.end(await readFile(join(root,'public',file)));return;
   }
   return json(res,404,{error:'Recurso não encontrado.'});
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.destroy(error);}
 });
 let scheduling=false,closing=false,scheduleRun=Promise.resolve();
 const runDueSchedules=()=>{
  if(scheduling||closing)return scheduleRun;
  scheduling=true;
  scheduleRun=(async()=>{
  try{
  if(crawler.active.size>=2)return;
  for(const schedule of store.db.prepare('SELECT * FROM schedules WHERE enabled=1 AND nextAt<=?').all(new Date().toISOString())){
   if(crawler.active.size>=2)break;
   try{const job=await crawler.create(JSON.parse(schedule.config));store.db.prepare('UPDATE schedules SET lastJob=?,nextAt=? WHERE id=?').run(job.id,new Date(Date.now()+schedule.intervalMinutes*60000).toISOString(),schedule.id);}
   catch{store.db.prepare('UPDATE schedules SET nextAt=? WHERE id=?').run(new Date(Date.now()+60000).toISOString(),schedule.id);}
  }
  }finally{scheduling=false;}
  })();return scheduleRun;
 };
 const scheduler=setInterval(()=>runDueSchedules().catch(()=>{}),10000);scheduler.unref();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,hostname,resolve);});
 return {server,store,crawler,runDueSchedules,dataDir,url:`http://${hostname}:${server.address().port}`,close:async()=>{closing=true;clearInterval(scheduler);await scheduleRun;await crawler.shutdown();await new Promise(resolve=>server.close(resolve));store.close();if(temporary)await rm(dataDir,{recursive:true,force:true});}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const application=await createApplication({dataDir:process.env.SPIDER_DATA_DIR||undefined,port:Number(process.env.SPIDER_PORT)||4318,hostname:process.env.SPIDER_HOST||'127.0.0.1'});
 console.log('Spider Local — '+application.url+' (Ctrl+C para encerrar)');
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await application.close();process.exit(0);});
}

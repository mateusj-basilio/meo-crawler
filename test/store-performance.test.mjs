import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,groups} from '../lib/store.mjs';
import {createApplication} from '../server.mjs';

async function workspace(run){
  const dataDir=await mkdtemp(join(tmpdir(),'spider-summary-'));
  const app=await createApplication({dataDir,port:0,browserProbe:false});
  try{await run(app,dataDir);}finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
}
function insert(store,id,path,record,internal=true){
  const url='https://example.test/'+path;
  store.enqueue(id,url,0,record.kind||'page',internal);
  const row=store.db.prepare('SELECT id FROM urls WHERE job=? AND url=?').get(id,url);
  store.save(id,row.id,{url,internal,issues:[],...record});
  return {url,id:row.id};
}

test('aggregated overview counts match every table filter including optional analyses and resources',()=>workspace(async({store})=>{
  const job=store.create({url:'https://example.test/'});
  insert(store,job.id,'page',{statusCode:200,contentType:'text/html',kind:'page',title:'A',isAmp:true,amp:'/amp',mobile:{score:1},spelling:{matches:[]},accessibility:{},customJavaScript:[],inSitemap:true,segments:['Blog']});
  insert(store,job.id,'second',{statusCode:200,contentType:'text/html',kind:'page',title:'B',analytics:{sessions:1},searchConsole:{clicks:1},ai:{output:'x'},pagespeed:{},js:{}});
  insert(store,job.id,'missing',{statusCode:404,contentType:'text/html',kind:'page',issues:[{code:'http-4xx',message:'404',severity:'error'}]});
  insert(store,job.id,'image',{statusCode:200,contentType:'image/png',kind:'image'});
  insert(store,job.id,'outside',{statusCode:200,contentType:'text/html',kind:'external'},false);
  store.enqueue(job.id,'https://example.test/pending',2);
  const summary=store.overview(job.id);
  for(const [key] of groups)assert.equal(summary.groups.find(group=>group.key===key).total,store.rows(job.id,{tab:key}).total,key);
  assert.deepEqual(summary.totals,{found:6,done:5,pending:1,failed:1,html:4,issues:1});
  assert.equal(summary.groups.find(group=>group.key==='internal').children.find(child=>child.type==='image').total,1);
}));

test('summary cache invalidates on saves, direct SQL, recrawl and other SQLite connections',()=>workspace(async({store},dataDir)=>{
  const job=store.create({url:'https://example.test/'});
  const row=insert(store,job.id,'page',{statusCode:200,contentType:'text/html',kind:'page'});
  const first=store.overview(job.id),revision=store.revision();
  assert.equal(store.overview(job.id),first);
  store.issue(job.id,row.url,{code:'test',message:'Observed',severity:'warning'});
  assert.notEqual(store.revision(),revision);assert.equal(store.stats(job.id).issues,1);
  assert.equal(store.overview(job.id).issues[0].code,'test');
  store.db.prepare("UPDATE urls SET record=json_set(record,'$.issues',json('[]')) WHERE id=?").run(row.id);
  assert.equal(store.stats(job.id).issues,0);
  const external=new DatabaseSync(join(dataDir,'spider.sqlite'));
  try{external.prepare("UPDATE urls SET state='queued' WHERE id=?").run(row.id);}finally{external.close();}
  assert.equal(store.stats(job.id).pending,1);assert.equal(store.rows(job.id).total,0);
  assert.equal(store.overview(job.id).groups.find(group=>group.key==='internal').total,0);
  const plan=store.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM urls WHERE job=? AND state='queued' ORDER BY depth,id LIMIT 1").all(job.id);
  assert(!plan.some(step=>step.detail.includes('TEMP B-TREE')));
}));

test('view revisions suppress unchanged data but refresh after mutations, filters and restart',()=>workspace(async({store,url},dataDir)=>{
  const job=store.create({url:'https://example.test/'});
  insert(store,job.id,'page',{statusCode:200,contentType:'text/html',kind:'page'});
  const view=options=>fetch(url+`/api/jobs/${job.id}/view?`+new URLSearchParams(options)).then(response=>response.json());
  const first=await view({tab:'internal'});
  assert.equal(first.rows.total,1);assert(first.overview);
  const tokens={sinceOverview:first.revision,sinceRows:first.rows.revision,tab:'internal'};
  const unchanged=await view(tokens);assert.equal(unchanged.overview,null);assert.equal(unchanged.rows,null);
  const filtered=await view({...tokens,filter:'5xx'});assert.equal(filtered.rows.total,0);
  insert(store,job.id,'second',{statusCode:500,kind:'page',contentType:'text/html'});
  const changed=await view(tokens);assert.equal(changed.rows.total,2);assert(changed.overview);assert.notEqual(changed.revision,first.revision);
  // A new Store lifetime must not accept a revision from a previous process.
  const otherDir=await mkdtemp(join(tmpdir(),'spider-revision-'));
  try{const other=new Store(join(otherDir,'other.sqlite'));try{assert.notEqual(other.revision(),store.revision());}finally{other.close();}}finally{await rm(otherDir,{recursive:true,force:true});}
}));

test('opening an older database migrates indexes and issue counts without losing records',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'spider-migrate-')),path=join(directory,'old.sqlite');
 let store;
 try{
  const old=new DatabaseSync(path);
  old.exec("CREATE TABLE urls (id INTEGER PRIMARY KEY,job TEXT,url TEXT,depth INTEGER,kind TEXT,internal INTEGER,state TEXT,statusCode INTEGER,contentType TEXT,bytes INTEGER,responseTime INTEGER,indexable INTEGER,record TEXT,UNIQUE(job,url));CREATE INDEX queue ON urls(job,state,id);");
  old.prepare('INSERT INTO urls(job,url,state,record) VALUES(?,?,?,?)').run('legacy','https://example.test/','done',JSON.stringify({issues:[{code:'legacy',message:'Existing evidence'}]}));
  old.close();
  store=new Store(path);
  assert.equal(store.stats('legacy').issues,1);
  assert.equal(store.byUrl('legacy','https://example.test/').issues[0].message,'Existing evidence');
  const revision=store.revision();store.close();store=new Store(path);
  assert.equal(store.stats('legacy').found,1);assert.notEqual(store.revision(),revision);
 }finally{store?.close();await rm(directory,{recursive:true,force:true});}
});

import { DatabaseSync } from 'node:sqlite';
import { STATUS_CODES } from 'node:http';
import { mkdirSync,openSync,writeFileSync,readFileSync,closeSync,unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { resourceTypes,categorySQL } from './resource-types.mjs';

const tabFields = {
  titles:'title', descriptions:'description', keywords:'keywords', h1:'h1', h2:'h2', content:'wordCount',
  canonicals:'canonical', pagination:'pagination', directives:'metaRobots', hreflang:'hreflang',
  javascript:'js', amp:'amp', structured:'structuredData', sitemaps:'inSitemap',
  accessibility:'accessibility', customSearch:'custom', customExtraction:'custom', customJavaScript:'customJavaScript',
  mobile:'mobile', spelling:'spelling', pagespeed:'pagespeed', analytics:'analytics', searchConsole:'searchConsole', linkMetrics:'linkMetrics', ai:'ai',
};
export const groups = [
  ['internal','Internos'],['external','Externos'],['security','Segurança'],['response','Códigos de resposta'],
  ['url','URLs'],['titles','Títulos'],['descriptions','Meta descriptions'],['keywords','Meta keywords'],
  ['h1','H1'],['h2','H2'],['content','Conteúdo'],['images','Imagens'],['canonicals','Canonicals'],
  ['pagination','Paginação'],['directives','Diretivas'],['hreflang','Hreflang'],['javascript','JavaScript'],
  ['links','Links'],['amp','AMP'],['structured','Dados estruturados'],['sitemaps','Sitemaps'],
  ['pagespeed','PageSpeed'],['mobile','Mobile'],['spelling','Ortografia e gramática'],['accessibility','Acessibilidade'],['customSearch','Pesquisa personalizada'],
  ['customExtraction','Extração personalizada'],['customJavaScript','JavaScript personalizado'],
  ['analytics','Analytics'],['searchConsole','Search Console'],['linkMetrics','Métricas de links'],['ai','IA'],
];

export function safeSavedConfig(config) {
  const clean={...config,headers:Object.fromEntries(Object.entries(config.headers||{}).filter(([key])=>!['authorization','cookie','proxy-authorization'].includes(key.toLowerCase())))};
  for(const key of ['password','username','cookie','apiKey','accessToken','formPassword','formUsername'])delete clean[key];
  if(clean.formAuth)clean.formAuth={...clean.formAuth,username:'',password:''};
  return clean;
}

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true});
    this.lockPath=path+'.lock';this.lockToken=randomUUID();
    try{this.lockFd=openSync(this.lockPath,'wx');}catch(error){
      if(error.code!=='EEXIST')throw error;
      let previous;try{previous=JSON.parse(readFileSync(this.lockPath,'utf8'));}catch{throw new Error('Arquivo de lock inválido: '+this.lockPath);}
      let alive=true;try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
      if(alive)throw new Error('O banco já está aberto em outro processo. Use outro diretório --data na CLI, ou encerre o servidor antes.');
      unlinkSync(this.lockPath);this.lockFd=openSync(this.lockPath,'wx');
    }
    writeFileSync(this.lockFd,JSON.stringify({pid:process.pid,token:this.lockToken}));
    try{this.db = new DatabaseSync(path);}catch(error){closeSync(this.lockFd);unlinkSync(this.lockPath);throw error;}
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,name TEXT,config TEXT,status TEXT,createdAt TEXT,updatedAt TEXT,error TEXT,notes TEXT DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY,job TEXT REFERENCES jobs(id),url TEXT,depth INTEGER,kind TEXT,internal INTEGER,state TEXT DEFAULT 'queued',statusCode INTEGER,contentType TEXT,bytes INTEGER,responseTime INTEGER,indexable INTEGER DEFAULT 0,record TEXT DEFAULT '{}',UNIQUE(job,url));
      CREATE INDEX IF NOT EXISTS queue_depth ON urls(job,state,depth,id);
      CREATE INDEX IF NOT EXISTS url_kind ON urls(job,kind,internal);
      CREATE TABLE IF NOT EXISTS links (job TEXT,source TEXT,target TEXT,text TEXT,rel TEXT,type TEXT,follow INTEGER,UNIQUE(job,source,target,text,type));
      CREATE INDEX IF NOT EXISTS inlinks ON links(job,target);
      CREATE INDEX IF NOT EXISTS outlinks ON links(job,source);
      CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY,config TEXT,intervalMinutes INTEGER,nextAt TEXT,lastJob TEXT,enabled INTEGER DEFAULT 1);
      UPDATE jobs SET status='paused',error='Interrompido pelo encerramento do servidor; retome para continuar.' WHERE status IN ('running','stopping','pausing','analyzing');
      UPDATE urls SET state='queued' WHERE state='fetching';`);
    // Generated count + covering index keep stats away from large HTML records.
    // SQLite maintains both for every record write, including direct SQL updates.
    if(!this.db.prepare('PRAGMA table_xinfo(urls)').all().some(column=>column.name==='issueCount')){
      this.db.exec("ALTER TABLE urls ADD COLUMN issueCount INTEGER GENERATED ALWAYS AS (coalesce(json_array_length(json_extract(record,'$.issues')),0)) VIRTUAL");
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS url_stats ON urls(job,state,statusCode,contentType,issueCount); DROP INDEX IF EXISTS queue;');
    this.revisionQuery=this.db.prepare('SELECT total_changes() local, (SELECT data_version FROM pragma_data_version) external');
    this.summaries=new Map();
  }
  revision() {
    const value=this.revisionQuery.get();
    return this.lockToken+':'+value.local+':'+value.external;
  }
  summary(id) {
    const revision=this.revision();
    let entry=this.summaries.get(id);
    if(!entry||entry.revision!==revision){
      entry={revision};
      if(!this.summaries.has(id)&&this.summaries.size>=16)this.summaries.delete(this.summaries.keys().next().value);
      this.summaries.set(id,entry);
    }
    return entry;
  }
  rowsRevision(id,options={}) {
    const selection=['tab','filter','q','page','pageSize','sort','direction'].map(key=>[key,options[key]??null]);
    return createHash('sha256').update(JSON.stringify([id,this.revision(),selection])).digest('base64url');
  }
  create(config) {
    const id=randomUUID(),now=new Date().toISOString();
    // Authentication stays in the active runtime. Saved sessions never retain credentials.
    const clean=safeSavedConfig(config);
    this.db.prepare('INSERT INTO jobs(id,name,config,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id,config.name||config.url,JSON.stringify(clean),'paused',now,now);
    return this.job(id);
  }
  stats(id) {
    const cached=this.summary(id);
    if(cached.stats)return {...cached.stats};
    const row=this.db.prepare(`SELECT count(*) found, sum(state='done') done, sum(state='queued' OR state='fetching') pending,
      sum(state='done' AND (statusCode>=400 OR statusCode=0)) failed,sum(contentType LIKE '%html%') html,
      coalesce(sum(issueCount),0) issues FROM urls WHERE job=?`).get(id);
    cached.stats=Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v||0]));
    return {...cached.stats};
  }
  job(id) {
    const row=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    return row?{...row,config:JSON.parse(row.config),notes:JSON.parse(row.notes),stats:this.stats(id),revision:this.revision()}:null;
  }
  jobs() {return this.db.prepare('SELECT id FROM jobs ORDER BY createdAt DESC').all().map(r=>this.job(r.id));}
  setStatus(id,status,error=null) {this.db.prepare('UPDATE jobs SET status=?,error=?,updatedAt=? WHERE id=?').run(status,error,new Date().toISOString(),id);}
  note(id,message) {const job=this.job(id); if(job&&!job.notes.includes(message))this.db.prepare('UPDATE jobs SET notes=? WHERE id=?').run(JSON.stringify([...job.notes,message]),id);}
  enqueue(id,url,depth,kind='page',internal=true,doneRecord=null) {
    return Number(this.db.prepare('INSERT OR IGNORE INTO urls(job,url,depth,kind,internal,state,record) VALUES(?,?,?,?,?,?,?)').run(id,url,depth,kind,internal?1:0,doneRecord?'done':'queued',JSON.stringify(doneRecord||{})).changes)>0;
  }
  reserve(id) {
    const row=this.db.prepare("SELECT * FROM urls WHERE job=? AND state='queued' ORDER BY depth,id LIMIT 1").get(id);
    if(row)this.db.prepare("UPDATE urls SET state='fetching' WHERE id=?").run(row.id);
    return row;
  }
  save(id,rid,record) {
    this.db.prepare("UPDATE urls SET state='done',statusCode=?,contentType=?,bytes=?,responseTime=?,indexable=?,record=?,kind=? WHERE id=? AND job=?").run(record.statusCode??null,record.contentType||'',record.bytes||0,record.responseTime||0,record.indexable?1:0,JSON.stringify(record),record.kind||'page',rid,id);
  }
  addLinks(id,source,links) {
    const stmt=this.db.prepare('INSERT OR IGNORE INTO links(job,source,target,text,rel,type,follow) VALUES(?,?,?,?,?,?,?)');
    this.db.exec('BEGIN');
    try{for(const l of links)stmt.run(id,source,l.url,l.text||'',l.rel||'',l.type||'anchor',l.follow===false?0:1);this.db.exec('COMMIT');}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  decode(row) {
    if(!row)return null;
    const record=JSON.parse(row.record);
    return {...record,statusLabel:record.statusText||STATUS_CODES[record.statusCode]||'',statusLabelSource:record.statusText?'response':'standard',id:row.id,url:row.url,depth:row.depth,kind:row.kind,internal:!!row.internal,state:row.state};
  }
  detail(id,rid) {
    const row=this.decode(this.db.prepare('SELECT * FROM urls WHERE job=? AND id=?').get(id,Number(rid)));
    if(row)row.inlinks=this.db.prepare('SELECT source AS url,text,rel,type,follow FROM links WHERE job=? AND target=?').all(id,row.url);
    return row;
  }
  byUrl(id,url) {return this.decode(this.db.prepare('SELECT * FROM urls WHERE job=? AND url=?').get(id,url));}
  selection(id,options={}) {
    const {tab='internal',filter='all',q=''}=options;
    const where=['job=?',"state='done'"],args=[id];
    if(tab==='internal')where.push('internal=1');
    else if(tab==='external')where.push('internal=0');
    else if(tab==='images')where.push("kind='image'");
    else if(!['response','url','security','links','issues'].includes(tab)) {
      where.push("kind='page'",'internal=1',"contentType LIKE '%html%'",'statusCode BETWEEN 200 AND 299');
      if(['customSearch','customExtraction'].includes(tab)){
        const field=tab==='customSearch'?'customSearch':'customExtractions';
        where.push(`EXISTS(SELECT 1 FROM jobs configured WHERE configured.id=? AND json_array_length(json_extract(configured.config,'$.${field}'))>0)`);args.push(id);
      }
      if(['pagespeed','mobile','spelling','accessibility','analytics','searchConsole','linkMetrics','ai','javascript','amp','sitemaps','customJavaScript'].includes(tab)) {
        if(tab==='amp')where.push("(json_extract(record,'$.amp') IS NOT NULL OR json_extract(record,'$.isAmp')=1)");else if(tab==='sitemaps')where.push("json_extract(record,'$.inSitemap')=1");else where.push(`json_extract(record,'$.${tabFields[tab]}') IS NOT NULL`);
      }
    }
    if(q){where.push('(url LIKE ? OR json_extract(record,\'$.title\') LIKE ?)');args.push('%'+q+'%','%'+q+'%');}
    if(filter.startsWith('type:')&&resourceTypes.some(t=>t.key===filter.slice(5))){where.push('('+categorySQL+')=?');args.push(filter.slice(5));}
    else if(filter.startsWith('segment:')){where.push("EXISTS(SELECT 1 FROM json_each(json_extract(record,'$.segments')) segment WHERE segment.value=?)");args.push(filter.slice(8));}
    else if(filter==='issues')where.push("json_array_length(json_extract(record,'$.issues'))>0");
    else if(filter==='indexable')where.push('indexable=1');
    else if(filter==='nonindexable')where.push('indexable=0');
    else if(/^[2345]xx$/.test(filter))where.push(`statusCode BETWEEN ${Number(filter[0])*100} AND ${Number(filter[0])*100+99}`);
    else if(filter!=='all'){where.push("EXISTS(SELECT 1 FROM json_each(json_extract(record,'$.issues')) issue WHERE json_extract(issue.value,'$.code')=?)");args.push(filter);}
    return {where:where.join(' AND '),args};
  }
  rows(id,options={}) {
    const {where,args}=this.selection(id,options),page=Math.max(1,Number(options.page)||1),pageSize=Math.max(1,Math.min(500,Number(options.pageSize)||100));
    const jsonSort=new Set(['finalUrl','indexabilityReason','title','titleLength','description','descriptionLength','keywords','h1','h2','wordCount','lang','canonical','metaRobots','pagination','hreflang','js','links','amp','structuredData','accessibility','pagespeed','custom','customJavaScript','analytics','searchConsole','linkMetrics','ai','headers','statusText','keywordsLength','h1Length','h2Length','xRobotsTag','linkScore','segments']);
    const sort=['url','statusCode','contentType','bytes','responseTime','depth','indexable','id'].includes(options.sort)?options.sort:options.sort==='issues'?"json_array_length(json_extract(record,'$.issues'))":jsonSort.has(options.sort)?`json_extract(record,'$.${options.sort}')`:'id';
    const direction=options.direction==='desc'?'DESC':'ASC';
    const total=this.db.prepare(`SELECT count(*) n FROM urls WHERE ${where}`).get(...args).n;
    const rows=this.db.prepare(`SELECT * FROM urls WHERE ${where} ORDER BY ${sort} ${direction},id LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize).map(r=>{
      const value=this.decode(r); delete value.text;delete value.html; return value;
    });
    return {rows,total,page,pages:Math.max(1,Math.ceil(total/pageSize)),revision:this.rowsRevision(id,options)};
  }
  *iterate(id,options={}) {
    const {where,args}=this.selection(id,options);
    for(const row of this.db.prepare(`SELECT * FROM urls WHERE ${where} ORDER BY id`).iterate(...args))yield this.decode(row);
  }
  issue(id,url,issue) {
    const row=this.byUrl(id,url);if(!row)return;
    row.issues||=[];if(!row.issues.some(i=>i.code===issue.code&&i.message===issue.message))row.issues.push(issue);
    this.db.prepare('UPDATE urls SET record=? WHERE job=? AND url=?').run(JSON.stringify(row),id,url);
  }
  merge(id,url,extra) {
    const row=this.byUrl(id,url);if(!row)return;
    this.db.prepare('UPDATE urls SET record=? WHERE job=? AND url=?').run(JSON.stringify({...row,...extra}),id,url);
  }
  overview(id) {
    const cached=this.summary(id);
    if(cached.overview)return cached.overview;
    const issues=this.db.prepare(`SELECT json_extract(i.value,'$.code') code,json_extract(i.value,'$.message') message,
      json_extract(i.value,'$.severity') severity,json_extract(i.value,'$.category') category,count(DISTINCT u.id) count
      FROM urls u,json_each(json_extract(u.record,'$.issues')) i WHERE job=? GROUP BY code ORDER BY count DESC`).all(id);
    const totals=this.stats(id),parameters=[];
    // All tab counts share one scan. Reuse selection() so summary and tables
    // cannot drift apart as optional-analysis filters evolve.
    const expressions=groups.map(([key],index)=>{
      const {where,args}=this.selection(id,{tab:key});
      parameters.push(...args.slice(1));
      return `coalesce(sum(CASE WHEN ${where.replace(/^job=\? AND /,'')} THEN 1 ELSE 0 END),0) AS group_${index}`;
    });
    const counts=this.db.prepare('SELECT '+expressions.join(',')+' FROM urls WHERE job=?').get(...parameters,id);
    const groupsList=groups.map(([key,label],index)=>({key,label,total:counts['group_'+index]}));
    const paths=new Map();for(const row of this.db.prepare('SELECT url FROM urls WHERE job=? AND internal=1').iterate(id)){try{const path=new URL(row.url).pathname.split('/').slice(0,3).join('/')||'/';paths.set(path,(paths.get(path)||0)+1);}catch{}}
    const typeCounts=this.db.prepare('SELECT internal,('+categorySQL+") type,count(*) n FROM urls WHERE job=? AND state='done' GROUP BY internal,type").all(id);
    for(const scope of ['internal','external']){const group=groupsList.find(g=>g.key===scope);group.children=resourceTypes.map(type=>({key:'type:'+type.key,type:type.key,label:type.label,total:typeCounts.find(row=>!!row.internal===(scope==='internal')&&row.type===type.key)?.n||0}));for(const child of group.children)child.percent=group.total?child.total/group.total*100:0;}
    const segments=this.db.prepare("SELECT segment.value name,count(*) count FROM urls,json_each(json_extract(record,'$.segments')) segment WHERE job=? GROUP BY segment.value ORDER BY count DESC").all(id);
    cached.overview={groups:groupsList,issues,totals,segments,tree:[...paths].map(([path,count])=>({path,count})).sort((a,b)=>b.count-a.count),timings:this.db.prepare('SELECT round(responseTime/500)*500 bucket,count(*) count FROM urls WHERE job=? AND responseTime>0 GROUP BY bucket').all(id)};
    return cached.overview;
  }
  compare(a,b) {
    const changes=[]; const fields=['statusCode','title','description','h1','canonical','metaRobots','wordCount','textHash','indexable'];
    const seen=new Set();
    for(const row of this.iterate(b,{tab:'internal'})) {
      seen.add(row.url);const before=this.byUrl(a,row.url);
      if(!before){changes.push({url:row.url,type:'added',fields:[]});continue;}
      const diff=fields.filter(f=>JSON.stringify(before[f])!==JSON.stringify(row[f])).map(field=>({field,before:before[field],after:row[field]}));
      const oldIssues=new Set((before.issues||[]).map(i=>i.code)),newIssues=new Set((row.issues||[]).map(i=>i.code));
      const introduced=[...newIssues].filter(c=>!oldIssues.has(c)),resolved=[...oldIssues].filter(c=>!newIssues.has(c));
      if(diff.length||introduced.length||resolved.length)changes.push({url:row.url,type:'changed',fields:diff,introduced,resolved});
    }
    for(const row of this.iterate(a,{tab:'internal'}))if(!seen.has(row.url))changes.push({url:row.url,type:'removed',fields:[]});
    return {summary:{added:changes.filter(c=>c.type==='added').length,removed:changes.filter(c=>c.type==='removed').length,changed:changes.filter(c=>c.type==='changed').length},changes};
  }
  close(){this.db.close();closeSync(this.lockFd);try{if(JSON.parse(readFileSync(this.lockPath,'utf8')).token===this.lockToken)unlinkSync(this.lockPath);}catch{}}
}

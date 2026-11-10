export function buildGraph(store,id,{mode='crawl',limit=1000,offset=0}={}) {
 limit=Math.max(1,Math.min(5000,Number(limit)||1000));offset=Math.max(0,Number(offset)||0);
 const query="job=? AND internal=1 AND state='done' AND contentType LIKE '%html%'";
 const total=store.db.prepare('SELECT count(*) n FROM urls WHERE '+query).get(id).n;
 const rows=store.db.prepare('SELECT * FROM urls WHERE '+query+' ORDER BY depth,id LIMIT ? OFFSET ?').all(id,limit,offset).map(row=>store.decode(row));
 if(mode==='directory') {
  const nodes=new Map(),edges=new Map();
  for(const row of rows){const parsed=new URL(row.url),segments=parsed.pathname.split('/').filter(Boolean);let parent=parsed.origin;
   if(!nodes.has(parent))nodes.set(parent,{id:parent,label:parsed.hostname,url:parsed.origin,depth:0,count:0});nodes.get(parent).count++;
   for(let index=0;index<segments.length;index++){const key=parsed.origin+'/'+segments.slice(0,index+1).join('/');if(!nodes.has(key))nodes.set(key,{id:key,label:segments[index],url:key,depth:index+1,count:0});nodes.get(key).count++;edges.set(parent+'\n'+key,{source:parent,target:key});parent=key;}
  }
  return {mode,nodes:[...nodes.values()],edges:[...edges.values()],total,examined:rows.length,offset,limit,complete:rows.length===total};
 }
 const nodes=rows.map(row=>({id:row.url,url:row.url,label:row.title||new URL(row.url).pathname,depth:row.depth,indexable:row.indexable,statusCode:row.statusCode,issues:row.issues?.length||0,linkScore:row.linkScore||0})),selected=new Set(nodes.map(node=>node.id)),edges=[];
 for(const link of store.db.prepare("SELECT DISTINCT source,target FROM links WHERE job=? AND type='anchor'").iterate(id))if(selected.has(link.source)&&selected.has(link.target))edges.push({source:link.source,target:link.target});
 return {mode,nodes,edges,total,examined:rows.length,offset,limit,complete:rows.length===total};
}

export function computeLinkScores(store,id) {
 const pages=store.db.prepare("SELECT url FROM urls WHERE job=? AND internal=1 AND state='done' AND contentType LIKE '%html%' AND statusCode BETWEEN 200 AND 299").all(id),index=new Map(pages.map((page,i)=>[page.url,i])),count=pages.length;
 if(!count)return;
 const out=Array.from({length:count},()=>new Set());
 for(const link of store.db.prepare("SELECT source,target FROM links WHERE job=? AND type='anchor' AND follow=1").iterate(id)){const from=index.get(link.source),to=index.get(link.target);if(from!==undefined&&to!==undefined)out[from].add(to);}
 let ranks=new Float64Array(count).fill(1/count);
 for(let pass=0;pass<25;pass++){const next=new Float64Array(count).fill(.15/count);let dangling=0;for(let i=0;i<count;i++){if(!out[i].size){dangling+=ranks[i];continue;}const share=.85*ranks[i]/out[i].size;for(const target of out[i])next[target]+=share;}for(let i=0;i<count;i++)next[i]+=.85*dangling/count;ranks=next;}
 const maximum=ranks.reduce((maximum,value)=>Math.max(maximum,value),0);
 for(let i=0;i<count;i++)store.merge(id,pages[i].url,{linkScore:Math.round(ranks[i]/maximum*10000)/100});
}

export function applySegments(url,segments=[]) {
 return segments.filter(segment=>{try{return segment.name&&new RegExp(segment.pattern||'.*','i').test(url);}catch{return false;}}).map(segment=>segment.name);
}

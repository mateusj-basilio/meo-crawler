// Run on an isolated SQLite backup, never on the user's live data directory.
import {performance} from 'node:perf_hooks';
import {Store} from '../lib/store.mjs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

const path=resolve(process.argv[2]||'');
if(!path.startsWith(resolve(tmpdir())+'/'))throw new Error('Benchmark requires a temporary SQLite copy.');
const store=new Store(path);
try {
  const id=store.db.prepare('SELECT job,count(*) n FROM urls GROUP BY job ORDER BY n DESC LIMIT 1').get().job;
  const measure=(name,fn,repeats=5)=>{
    const times=[];let cpu=process.cpuUsage(),value;
    for(let i=0;i<repeats;i++){const start=performance.now();value=fn();times.push(performance.now()-start);}
    cpu=process.cpuUsage(cpu);
    return {name,firstMs:+times[0].toFixed(3),warmMedianMs:+times.slice(1).sort((a,b)=>a-b)[Math.floor((repeats-1)/2)].toFixed(3),cpuMs:+((cpu.user+cpu.system)/1000).toFixed(3),responseBytes:Buffer.byteLength(JSON.stringify(value))};
  };
  console.log(JSON.stringify({id,urls:store.db.prepare('SELECT count(*) n FROM urls WHERE job=?').get(id).n,measurements:[
    measure('stats',()=>store.stats(id)),
    measure('overview',()=>store.overview(id)),
    measure('overviewAfterWrite',()=>{store.db.prepare('UPDATE jobs SET updatedAt=updatedAt WHERE id=?').run(id);return store.overview(id);}),
    measure('rows',()=>store.rows(id,{tab:'internal',pageSize:100,sort:'url'})),
  ],peakRssKiB:process.resourceUsage().maxRSS},null,2));
}finally{store.close();}

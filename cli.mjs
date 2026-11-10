import { Store } from './lib/store.mjs';
import { Crawler } from './lib/engine.mjs';
import { exportJob } from './lib/export.mjs';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import { createWriteStream } from 'node:fs';

const args=process.argv.slice(2),option=name=>{const n=args.indexOf('--'+name);return n<0?undefined:args[n+1];};
if(!args.length||args.includes('--help')){
 console.log('Uso: npm run crawl -- https://site.com [--render] [--config config.json] [--output resultado.csv] [--format csv|xlsx|json|sitemap] [--max-urls 0] [--data DIRETORIO]\nSem --max-urls, não há teto comercial de URLs. Sessões e resultados são salvos no banco local.');
}else{
 const temporary=!option('data'),directory=option('data')||await mkdtemp(join(tmpdir(),'csw-crawler-cli-'));await mkdir(directory,{recursive:true});
 const store=new Store(join(directory,'spider.sqlite')),crawler=new Crawler(store,directory);
 const config=option('config')?JSON.parse(await readFile(option('config'),'utf8')):{};config.url=args[0];if(args.includes('--render'))config.renderJavaScript=true;if(option('max-urls')!==undefined)config.maxUrls=Number(option('max-urls'));
 let interrupted=false;process.on('SIGINT',()=>{interrupted=true;crawler.shutdown();});
 try{const job=await crawler.create(config);console.log('Sessão: '+job.id);const runtime=crawler.active.get(job.id);await runtime.promise;
  const finished=store.job(job.id);console.log(JSON.stringify({status:finished.status,stats:finished.stats,error:finished.error,notes:finished.notes},null,2));
  if(option('output')){const stream=createWriteStream(option('output'));await exportJob(store,job.id,{tab:'internal',format:option('format')||option('output').split('.').pop()},stream);}
  if(finished.status==='failed'||interrupted)process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}finally{await crawler.shutdown();store.close();if(temporary)await rm(directory,{recursive:true,force:true});}
}

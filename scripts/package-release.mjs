import {mkdir,mkdtemp,cp,copyFile,readFile,chmod,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(await readFile(join(root,'package.json')));
const portable=process.argv.includes('--portable');
if(portable&&(process.platform!=='linux'||process.arch!=='x64'))throw new Error('O pacote portátil atual é Linux x64.');
const stage=await mkdtemp(join(tmpdir(),'csw-release-')),name='csw-sites-crawler-'+pkg.version+(portable?'-linux-x64':'-source'),folder=join(stage,name);
const files=['server.mjs','cli.mjs','lib','public','scripts','test','package.json','package-lock.json','start-spider.sh','Start-Spider.cmd','QUICKSTART.md','docs/features.json','docs/brand-source.md'];
try{
 await mkdir(folder,{recursive:true});
 for(const file of files)await cp(join(root,file),join(folder,file),{recursive:true});
 if(portable){
  await cp(join(root,'node_modules'),join(folder,'node_modules'),{recursive:true});
  await mkdir(join(folder,'runtime'));await copyFile(process.execPath,join(folder,'runtime','node'));await chmod(join(folder,'runtime','node'),0o755);
  await copyFile(resolve(process.execPath,'../../LICENSE'),join(folder,'runtime','LICENSE')).catch(()=>{});
  const browsers=JSON.parse(await readFile(join(root,'node_modules/playwright-core/browsers.json'))).browsers;
  for(const browser of browsers.filter(browser=>['chromium','chromium-headless-shell','ffmpeg'].includes(browser.name))){
   const directory=browser.name.replaceAll('-','_')+'-'+browser.revision;
   await cp(join(process.env.PLAYWRIGHT_BROWSERS_PATH||join(process.env.HOME,'.cache/ms-playwright'),directory),join(folder,'browsers',directory),{recursive:true});
  }
 }
 await chmod(join(folder,'start-spider.sh'),0o755);
 const output=join(root,'release');await mkdir(output,{recursive:true});
 const target=join(output,name+'.zip');execFileSync('zip',['-qr','-y',target,name],{cwd:stage});console.log(target);
}finally{await rm(stage,{recursive:true,force:true});}

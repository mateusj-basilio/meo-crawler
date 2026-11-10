import {createApplication} from '../server.mjs';
import {spawn} from 'node:child_process';
const hostname=process.env.SPIDER_HOST||'127.0.0.1',port=Number(process.env.SPIDER_PORT)||4318;
try{
 const app=await createApplication({dataDir:process.env.SPIDER_DATA_DIR||undefined,hostname,port});
 console.log(`CSW Sites Crawler — ${app.url}\nSessão ${process.env.SPIDER_DATA_DIR?'com histórico local':'temporária: exporte antes de encerrar'}. Ctrl+C encerra o aplicativo.`);
 let closing=false;
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await app.close();process.exit(0);});
 if(process.env.SPIDER_OPEN_BROWSER!=='0'){
  const command=process.platform==='win32'?'rundll32':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',app.url]:[app.url];
  const child=spawn(command,args,{stdio:'ignore',detached:true});child.on('error',()=>console.log('Abra o endereço acima no seu navegador.'));child.unref();
 }
}catch(error){console.error(error.code==='EADDRINUSE'?`A porta ${port} já está em uso. Feche a instância anterior ou defina SPIDER_PORT.`:error.message);process.exitCode=1;}

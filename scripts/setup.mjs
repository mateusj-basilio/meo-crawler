import {launchBrowser} from '../lib/engine.mjs';
import {execFileSync} from 'node:child_process';
try{const browser=await launchBrowser();await browser.close();console.log('Navegador pronto para renderização, screenshots e acessibilidade.');}
catch{
 console.log('Instalando Chromium para as auditorias opcionais…');
 const env={...process.env};
 if(process.platform==='linux'&&process.arch==='x64'){
  const {readFile}=await import('node:fs/promises');
  const os=await readFile('/etc/os-release','utf8').catch(()=>'');
  if(os.includes('ID=ubuntu')&&/VERSION_ID="(?:25|26)\./.test(os))env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE='ubuntu24.04-x64';
 }
 execFileSync(process.execPath,['node_modules/playwright/cli.js','install','chromium'],{stdio:'inherit',env});
 const browser=await launchBrowser();await browser.close();console.log('Chromium instalado e verificado.');
}

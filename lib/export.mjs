import ExcelJS from 'exceljs';
import {finished} from 'node:stream/promises';
import {auditReport} from './audit-report.mjs';
const columns=[['URL','url'],['URL final','finalUrl'],['Tipo','kind'],['Status HTTP','statusCode'],['Status','statusText'],['Content-Type','contentType'],['Indexável','indexable'],['Motivo','indexabilityReason'],['Title','title'],['Title: caracteres','titleLength'],['Description','description'],['Description: caracteres','descriptionLength'],['Meta keywords','keywords'],['Meta keywords: caracteres','keywordsLength'],['H1','h1'],['H1: caracteres','h1Length'],['H2','h2'],['H2: caracteres','h2Length'],['Canonical','canonical'],['Robots','metaRobots'],['Idioma','lang'],['Palavras','wordCount'],['Bytes','bytes'],['Tempo (ms)','responseTime'],['Profundidade','depth'],['Hreflang','hreflang'],['Problemas','issues'],['Extrações','custom']];
columns.push(['Corpo completo','bodyComplete'],['Análise completa','analysisComplete'],['Segmentos','segments'],['Link Score','linkScore'],['Dados estruturados (JSON-LD)','structuredData'],['Validação AMP','ampValidation'],['Lighthouse Mobile','mobile'],['Acessibilidade','accessibility'],['Ortografia e gramática','spelling'],['JavaScript personalizado','customJavaScript'],['PageSpeed Insights','pagespeed'],['Google Analytics','analytics'],['Search Console','searchConsole'],['IA','ai']);
const valueFor=(row,field)=>field==='statusText'?row.statusText||row.statusLabel:row[field];
function cell(value){if(value==null)return '';if(Array.isArray(value))return value.map(v=>typeof v==='object'?JSON.stringify(v):v).join(' | ');return typeof value==='object'?JSON.stringify(value):value;}
function safe(value){const v=cell(value);return typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v;}
export function csvCell(value){return '"'+String(safe(value)).replaceAll('"','""')+'"';}
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
async function write(stream,text){
 if(stream.destroyed)throw new Error('Exportação interrompida.');
 if(!stream.write(text))await new Promise((resolve,reject)=>{
  const clean=()=>{stream.off('drain',drain);stream.off('error',error);stream.off('close',close);};
  const drain=()=>{clean();resolve();},error=e=>{clean();reject(e);},close=()=>error(new Error('Exportação interrompida.'));
  stream.once('drain',drain);stream.once('error',error);stream.once('close',close);
 });
}
export async function exportJob(store,id,options,stream) {
  const format=options.format||'csv',rows=store.iterate(id,options);
  if(!['csv','json','sitemap','xlsx','html'].includes(format))throw new Error('Formato de exportação inválido.');
  const completion=finished(stream,{readable:false,cleanup:true});completion.catch(()=>{});
  try{
  if(format==='html'){await write(stream,auditReport(store,id));stream.end();}
  else if(format==='csv'){
    await write(stream,'\uFEFF'+columns.map(c=>csvCell(c[0])).join(',')+'\r\n');
    for(const row of rows)await write(stream,columns.map(([,field])=>csvCell(valueFor(row,field))).join(',')+'\r\n');stream.end();
  }else if(format==='json'){
    await write(stream,'[');let first=true;for(const row of rows){delete row.text;await write(stream,(first?'':',')+JSON.stringify(row));first=false;}stream.end(']');
  }else if(format==='sitemap'){
    await write(stream,'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n');
    for(const row of rows)if(row.indexable&&row.internal&&row.kind==='page'&&row.statusCode>=200&&row.statusCode<300)await write(stream,'<url><loc>'+xml(row.url)+'</loc></url>\n');stream.end('</urlset>');
  }else if(format==='xlsx'){
    const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({stream,useStyles:false,useSharedStrings:false});let sheet=workbook.addWorksheet('URLs'),count=0,part=1,truncated=0;
    sheet.addRow(columns.map(c=>c[0])).commit();
    for(const row of rows){if(++count>=1048576){sheet.commit();sheet=workbook.addWorksheet('URLs '+(++part));sheet.addRow(columns.map(c=>c[0])).commit();count=1;}sheet.addRow(columns.map(([,field])=>{const value=safe(valueFor(row,field));if(typeof value==='string'&&value.length>32767)truncated++;return typeof value==='string'?value.slice(0,32767):value;})).commit();}
    sheet.commit();if(truncated){const warnings=workbook.addWorksheet('Avisos');warnings.addRow(['Limites da exportação']).commit();warnings.addRow([truncated+' células excederam o limite de 32.767 caracteres do Excel e foram reduzidas. Exporte JSON para obter os valores integrais.']).commit();warnings.commit();}await workbook.commit();
  }else throw new Error('Formato de exportação inválido.');
  await completion;
  }catch(error){stream.destroy(error);await completion.catch(()=>{});throw error;}
}

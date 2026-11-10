// Shared MIME categories for the queue, SQL filters and overview counts.
export const resourceTypes = [
  {key:'html',label:'HTML',patterns:['%html%']},
  {key:'javascript',label:'JavaScript',patterns:['%javascript%','%ecmascript%']},
  {key:'css',label:'CSS',patterns:['text/css%']},
  {key:'image',label:'Imagens',patterns:['image/%']},
  {key:'media',label:'Mídia',patterns:['audio/%','video/%']},
  {key:'font',label:'Fontes',patterns:['font/%','%font-woff%','%fontobject%','%font-sfnt%']},
  {key:'xml',label:'XML',patterns:['%xml%']},
  {key:'pdf',label:'PDF',patterns:['application/pdf%']},
  {key:'flash',label:'Plugins',patterns:['%shockwave%']},
  {key:'other',label:'Outros',patterns:['_%']},
  {key:'unknown',label:'Desconhecido',patterns:[]},
];
export function classifyContentType(value) {
  const type=String(value||'').toLowerCase();
  for(const category of resourceTypes)if(category.patterns.some(pattern=>new RegExp('^'+pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replaceAll('%','.*').replaceAll('_','.')+'$').test(type)))return category.key;
  return 'unknown';
}
export const categorySQL='CASE '+resourceTypes.filter(t=>t.patterns.length).map(type=>'WHEN ('+type.patterns.map(pattern=>"lower(coalesce(contentType,'')) LIKE '"+pattern+"'").join(' OR ')+") THEN '"+type.key+"'").join(' ')+" ELSE 'unknown' END";

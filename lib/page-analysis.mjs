import {fork} from 'node:child_process';
import {analyzePage} from './analyze.mjs';

// Ordinary SEO parsing stays in-process. User regex runs over the complete HTML
// in a disposable worker, so backtracking cannot block the local API or scheduler.
export async function analyzeFetchedPage(input, {signal, timeoutMs = 2000} = {}) {
  const config = input.config || {};
  const extractions = config.customExtractions || [], searches = config.customSearch || [];
  const rules = [
    ...extractions.filter(item => item?.name && item.type === 'regex').map(item => ({name: item.name, pattern: item.selector ?? item.pattern, extraction: true})),
    ...searches.filter(item => item?.name).map(item => ({name: item.name, pattern: item.pattern, extraction: false})),
  ];
  if (!rules.length) return analyzePage(input);
  const result = analyzePage({...input, config: {...config, customSearch: [], customExtractions: extractions.filter(item => item.type !== 'regex')}});
  let worker, timer, abort;
  try {
    const matches = await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Análise cancelada.')); return; }
      worker = fork(new URL('./custom-regex-worker.mjs', import.meta.url), [], {
        stdio:['ignore','ignore','ignore','ipc'],
        execArgv: ['--max-old-space-size=128'],
      });
      worker.send({html:input.html||'',rules},error=>{if(error)reject(error);});
      timer = setTimeout(() => reject(new Error('Pesquisa excedeu o prazo de '+timeoutMs+' ms. Simplifique as expressões.')), timeoutMs);
      abort = () => reject(new Error('Análise cancelada.'));
      signal?.addEventListener('abort', abort, {once: true});
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error('Pesquisa interrompida (código '+code+').')));
    });
    for (const item of matches) {
      result.custom[item.name] = item.extraction ? item.matches : {...item, name: undefined, extraction: undefined};
      if (item.error || item.resultsTruncated) result.issues.push({
        code: item.error ? item.extraction ? 'CUSTOM_EXTRACTION_INVALID' : 'CUSTOM_SEARCH_INVALID' : 'CUSTOM_RESULTS_TRUNCATED',
        category: 'Extraction', severity: item.error ? 'warning' : 'info',
        message: item.error ? `${item.name}: ${item.error}` : `${item.name}: HTML completo examinado; ${item.totalMatches} resultados. Exibidos até 100 valores de até 16.384 caracteres.`,
      });
    }
  } catch (error) {
    for (const rule of rules) result.custom[rule.name] = rule.extraction ? [] : {matches: [], complete: false, examinedCharacters: 0, error: error.message};
    result.issues.push({code: 'CUSTOM_SEARCH_INCOMPLETE', category: 'Extraction', severity: 'warning', message: error.message});
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
    if(worker&&worker.exitCode===null&&worker.signalCode===null){
      const closed=new Promise(resolve=>worker.once('close',resolve));
      worker.kill('SIGKILL');await closed;
    }
  }
  return result;
}

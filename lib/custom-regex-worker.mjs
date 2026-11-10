import {safeExpression} from './analyze.mjs';

process.once('message',({html,rules})=>{
const results = [];
for (const rule of rules) {
  try {
    const expression = safeExpression(rule.pattern);
    const matches = [];
    let totalMatches = 0, valuesTruncated = false;
    for (const match of html.matchAll(expression)) {
      totalMatches++;
      if (matches.length < 100) {
        const value = rule.extraction ? match[1] ?? match[0] : match[0];
        valuesTruncated ||= value.length > 16384;
        matches.push(value.slice(0, 16384));
      }
    }
    results.push({name: rule.name, extraction: rule.extraction, matches, totalMatches,
      examinedCharacters: html.length, complete: true,
      resultsTruncated: totalMatches > matches.length || valuesTruncated});
  } catch (error) {
    results.push({name: rule.name, extraction: rule.extraction, matches: [], complete: false, error: error.message});
  }
}
process.send(results,()=>process.disconnect());
});

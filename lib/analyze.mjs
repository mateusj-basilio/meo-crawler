import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';

const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => compact(value).toLowerCase();
const digest = text => createHash('sha256').update(text).digest('hex');
const tokens = value => lower(value).split(/[\s,]+/).filter(Boolean);
const nonempty = value => value !== undefined && value !== null && value !== '';

/** Resolve crawlable HTTP(S) references, preserving queries and removing fragments. */
export function normalizeUrl(value, base) {
  if (!nonempty(value) || !String(value).trim()) return null;
  try {
    const result = new URL(String(value).trim(), base);
    if (!['http:', 'https:'].includes(result.protocol)) return null;
    result.hash = '';
    return result.href;
  } catch { return null; }
}

function headerMap(headers) {
  if (headers && typeof headers.entries === 'function') return Object.fromEntries([...headers.entries()].map(([key, value]) => [lower(key), String(value)]));
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [lower(key), Array.isArray(value) ? value.join(', ') : String(value)]));
}

export function safeExpression(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 256 || !pattern.length) throw new Error('Use a non-empty pattern of at most 256 characters.');
  // Restrict to a predictable subset. Pattern length alone does not prevent ReDoS.
  const outsideClasses = pattern.replace(/\[(?:\\.|[^\]\\])*\]/g, 'x').replace(/\\./g, 'x');
  if (/\\[1-9]|\(\?|\|/.test(pattern) || /\)[*+?{]/.test(outsideClasses)) throw new Error('Groups with repetition, lookarounds, backreferences and alternatives are unsupported.');
  if ((outsideClasses.match(/[*+]|\{\d/g) ?? []).length > 2) throw new Error('Use at most two repetition operators.');
  return new RegExp(pattern, 'giu');
}

function extractCustom($, html, config, issue) {
  const custom = {};
  let dom;
  for (const item of config.customExtractions ?? []) {
    if (!item?.name) continue;
    try {
      if (item.type === 'regex') {
        const expression = safeExpression(item.selector ?? item.pattern);
        custom[item.name] = [...html.slice(0, 8192).matchAll(expression)].slice(0, 100).map(match => match[1] ?? match[0]);
        if (html.length > 8192) issue('CUSTOM_REGEX_TRUNCATED', 'Extraction', 'info', `Regex "${item.name}" examined the first 8,192 characters.`);
      } else if (item.type === 'xpath') {
        if (typeof item.selector !== 'string' || item.selector.length > 2048) throw new Error('XPath must be a string of at most 2,048 characters.');
        dom ??= new DOMParser({ onError: () => {} }).parseFromString($.xml(), 'text/xml');
        const found = xpath.select(item.selector, dom);
        custom[item.name] = Array.isArray(found) ? found.slice(0, 100).map(node => item.attribute ? node.getAttribute?.(item.attribute) ?? '' : compact(node.nodeValue ?? node.textContent)) : [String(found)];
      } else {
        if (typeof item.selector !== 'string' || item.selector.length > 2048) throw new Error('CSS selector must be a string of at most 2,048 characters.');
        custom[item.name] = $(item.selector).toArray().slice(0, 100).map(element => item.attribute ? $(element).attr(item.attribute) ?? '' : compact($(element).text()));
      }
    } catch (error) {
      custom[item.name] = [];
      issue('CUSTOM_EXTRACTION_INVALID', 'Extraction', 'warning', `Extraction "${item.name}": ${error.message}`);
    }
  }
  for (const item of config.customSearch ?? []) {
    if (!item?.name) continue;
    try {
      const expression = safeExpression(item.pattern);
      custom[item.name] = { matches: [...html.slice(0, 8192).matchAll(expression)].slice(0, 100).map(match => match[0]), examinedCharacters: Math.min(html.length, 8192), complete: html.length <= 8192 };
    } catch (error) {
      custom[item.name] = { matches: [], error: error.message };
      issue('CUSTOM_SEARCH_INVALID', 'Extraction', 'warning', `Search "${item.name}": ${error.message}`);
    }
  }
  return custom;
}

/** Analyze fetched HTML only; performs no network requests or script execution. */
export function analyzePage({ url, html = '', headers = {}, status = 200, config = {} }) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new TypeError('Page URL must be an absolute HTTP(S) URL.');
  html = String(html);
  const $ = load(html);
  const pageUrl = new URL(normalized);
  const responseHeaders = headerMap(headers);
  const issues = [];
  const issue = (code, category, severity, message) => issues.push({ code, category, severity, message });
  const firstMeta = name => $('meta').filter((_, element) => lower($(element).attr('name') ?? $(element).attr('property')) === name).first().attr('content') ?? '';
  const baseValue = $('base[href]').first().attr('href');
  const base = normalizeUrl(baseValue, normalized) ?? normalized;
  if (baseValue && !normalizeUrl(baseValue, normalized)) issue('BASE_INVALID', 'Links', 'warning', 'The base URL cannot be resolved to HTTP(S).');
  const title = compact($('title').first().text());
  const description = compact(firstMeta('description'));
  const keywords = compact(firstMeta('keywords'));
  const h1 = $('h1').toArray().map(element => compact($(element).text()));
  const h2 = $('h2').toArray().map(element => compact($(element).text()));
  const lang = compact($('html').attr('lang'));
  const canonicalElements = $('link').filter((_, element) => tokens($(element).attr('rel')).includes('canonical')).toArray();
  const htmlCanonical = canonicalElements.length ? $(canonicalElements[0]).attr('href') ?? '' : null;
  const httpCanonicals = [...(responseHeaders.link ?? '').matchAll(/<([^>]+)>\s*;[^,]*?\brel\s*=\s*["']?canonical\b/gi)].map(match => match[1]);
  const canonicalRaw = htmlCanonical ?? httpCanonicals[0] ?? null;
  const canonical = canonicalRaw === null ? null : normalizeUrl(canonicalRaw, htmlCanonical !== null ? base : normalized);
  const canonicalSource = htmlCanonical !== null ? 'html' : httpCanonicals.length ? 'http' : null;
  if (canonicalRaw !== null && !canonical) issue('CANONICAL_INVALID', 'Canonicals', 'error', 'Canonical reference is empty or cannot be resolved to HTTP(S).');
  if (canonicalElements.length > 1 || httpCanonicals.length > 1) issue('CANONICAL_MULTIPLE', 'Canonicals', 'warning', 'Multiple canonical declarations were found.');
  const httpCanonical = normalizeUrl(httpCanonicals[0], normalized);
  if (canonical && httpCanonical && canonical !== httpCanonical) issue('CANONICAL_CONFLICT', 'Canonicals', 'error', 'HTML and HTTP canonical declarations disagree.');
  if (canonical && canonical !== normalized) issue('CANONICAL_OTHER', 'Canonicals', 'info', 'This URL declares another URL as canonical.');

  const robotsValues = $('meta').filter((_, element) => ['robots', 'googlebot'].includes(lower($(element).attr('name')))).toArray().map(element => $(element).attr('content') ?? '');
  if (responseHeaders['x-robots-tag']) robotsValues.push(responseHeaders['x-robots-tag']);
  const metaRobots = robotsValues.map(compact).filter(Boolean).join(', ');
  const robotTokens = tokens(metaRobots.replace(/\b[a-z][a-z0-9_-]*\s*:/gi, ''));
  const noindex = robotTokens.includes('noindex') || robotTokens.includes('none');
  const pageNofollow = robotTokens.includes('nofollow') || robotTokens.includes('none');
  let indexabilityReason = status >= 200 && status < 300 ? 'Indexable' : `HTTP ${status}`;
  if (noindex) indexabilityReason = 'Noindex';
  else if (status >= 200 && status < 300 && canonical && canonical !== normalized) indexabilityReason = 'Canonicalised';
  const indexable = indexabilityReason === 'Indexable';
  if (noindex) issue('NOINDEX', 'Directives', 'info', 'A robots directive requests exclusion from indexing.');
  if (pageNofollow) issue('PAGE_NOFOLLOW', 'Directives', 'info', 'A robots directive requests links not be followed.');
  if (status >= 400) issue('HTTP_ERROR', 'Response Codes', 'error', `The response returned HTTP ${status}.`);
  else if (status >= 300 && status < 400) issue('HTTP_REDIRECT', 'Response Codes', 'info', `The response returned HTTP ${status}.`);
  if (!title) issue('TITLE_MISSING', 'Page Titles', 'error', 'Page title is missing or empty.');
  if (title.length > 60) issue('TITLE_LONG', 'Page Titles', 'warning', 'Page title exceeds the 60 character review threshold.');
  if (title && title.length < 15) issue('TITLE_SHORT', 'Page Titles', 'info', 'Page title is shorter than 15 characters.');
  if ($('title').length > 1) issue('TITLE_MULTIPLE', 'Page Titles', 'warning', 'Multiple title elements were found.');
  if (!description) issue('DESCRIPTION_MISSING', 'Meta Description', 'warning', 'Meta description is missing or empty.');
  if (description.length > 160) issue('DESCRIPTION_LONG', 'Meta Description', 'warning', 'Meta description exceeds the 160 character review threshold.');
  if (!h1.length || h1.every(value => !value)) issue('H1_MISSING', 'H1', 'warning', 'No non-empty H1 heading was found.');
  if (h1.length > 1) issue('H1_MULTIPLE', 'H1', 'info', 'Multiple H1 headings were found.');
  for (const [name, values] of [['H1', h1], ['H2', h2]]) {
    if (new Set(values.map(lower)).size !== values.length) issue(`${name}_DUPLICATE`, name, 'warning', `The page repeats a ${name} heading.`);
  }
  if (!lang) issue('LANG_MISSING', 'International', 'warning', 'The HTML lang attribute is missing.');
  if (/[A-Z]/.test(pageUrl.pathname)) issue('URL_UPPERCASE', 'URL', 'info', 'URL path contains uppercase characters.');
  if (normalized.length > 115) issue('URL_LONG', 'URL', 'info', 'URL exceeds the 115 character review threshold.');
  if (pageUrl.pathname.includes('_')) issue('URL_UNDERSCORE', 'URL', 'info', 'URL path contains underscores.');
  if (/[^\x00-\x7F]|%[89a-f]/i.test(pageUrl.pathname)) issue('URL_NON_ASCII', 'URL', 'info', 'URL path contains encoded or non-ASCII characters.');

  const links = [];
  $('a[href],area[href],link[href],script[src],iframe[src],source[src],video[src],audio[src],img[src]').each((_, element) => {
    const node = $(element);
    const target = normalizeUrl(node.attr('href') ?? node.attr('src'), base);
    if (!target) return;
    const tag = lower(element.tagName);
    const rel = compact(node.attr('rel'));
    const type = ['a', 'area'].includes(tag) ? 'anchor' : 'resource';
    const resourceType = ['a','area'].includes(tag) ? 'document' : tag === 'img' || tag === 'link' && tokens(rel).some(value=>['icon','apple-touch-icon'].includes(value)) ? 'image' : tag === 'script' ? 'javascript' : tag === 'link' && tokens(rel).includes('stylesheet') ? 'css' : tag === 'link' && tokens(rel).includes('canonical') ? 'canonical' : tag === 'link' && tokens(rel).includes('amphtml') ? 'amp' : tag === 'iframe' ? 'document' : ['video','audio','source'].includes(tag) ? 'media' : 'reference';
    links.push({ url: target, tag, resourceType, text: compact(node.text() || node.attr('alt')), rel, type, follow: !pageNofollow && !tokens(rel).includes('nofollow'), internal: new URL(target).origin === pageUrl.origin });
  });
  const images = $('img').toArray().map(element => {
    const node = $(element);
    return { url: normalizeUrl(node.attr('src') ?? node.attr('data-src'), base), alt: node.attr('alt') ?? '', altMissing: node.attr('alt') === undefined, title: node.attr('title') ?? '', width: node.attr('width') ?? '', height: node.attr('height') ?? '' };
  });
  const missingAlt = images.filter(image => image.altMissing).length;
  const emptyAlt = images.filter(image => !image.altMissing && !image.alt.trim()).length;
  if (missingAlt) issue('IMAGE_ALT_MISSING', 'Images', 'warning', `${missingAlt} image(s) have no alt attribute.`);
  if (emptyAlt) issue('IMAGE_ALT_EMPTY', 'Images', 'info', `${emptyAlt} image(s) have an empty alt attribute; confirm they are decorative.`);
  const hreflang = [];
  $('link[hreflang]').each((_, element) => {
    const node = $(element);
    const language = compact(node.attr('hreflang'));
    const target = normalizeUrl(node.attr('href'), base);
    if (!target) issue('HREFLANG_URL_INVALID', 'Hreflang', 'error', `Hreflang "${language}" has an invalid URL.`);
    if (!/^(x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(language)) issue('HREFLANG_LANGUAGE_INVALID', 'Hreflang', 'warning', `Hreflang language "${language}" is malformed.`);
    if (target) hreflang.push({ lang: language, url: target });
  });
  const structuredData = [];
  $('script').filter((_, element) => lower($(element).attr('type')) === 'application/ld+json').each((_, element) => {
    try { structuredData.push(JSON.parse($(element).text())); }
    catch { issue('JSONLD_INVALID', 'Structured Data', 'error', 'A JSON-LD script contains invalid JSON.'); }
  });
  const pagination = { next: null, prev: null };
  for (const direction of ['next', 'prev']) {
    pagination[direction] = normalizeUrl($('link').filter((_, element) => tokens($(element).attr('rel')).includes(direction)).first().attr('href'), base);
  }
  const amp = normalizeUrl($('link').filter((_, element) => tokens($(element).attr('rel')).includes('amphtml')).first().attr('href'), base);
  const openGraph = {};
  const twitter = {};
  $('meta').each((_, element) => {
    const node = $(element);
    const key = lower(node.attr('property') ?? node.attr('name'));
    if (key.startsWith('og:')) openGraph[key.slice(3)] = node.attr('content') ?? '';
    if (key.startsWith('twitter:')) twitter[key.slice(8)] = node.attr('content') ?? '';
  });
  const security = {
    https: pageUrl.protocol === 'https:',
    mixedContent: [...new Set(links.filter(link => link.type === 'resource' && link.url.startsWith('http:')).map(link => link.url))],
    contentSecurityPolicy: responseHeaders['content-security-policy'] ?? '',
    strictTransportSecurity: responseHeaders['strict-transport-security'] ?? '',
    xContentTypeOptions: responseHeaders['x-content-type-options'] ?? '',
    xFrameOptions: responseHeaders['x-frame-options'] ?? '',
    referrerPolicy: responseHeaders['referrer-policy'] ?? '',
  };
  if (!security.https) issue('HTTP_INSECURE', 'Security', 'warning', 'The page was fetched over unencrypted HTTP.');
  if (security.https && security.mixedContent.length) issue('MIXED_CONTENT', 'Security', 'error', `${security.mixedContent.length} resource(s) use HTTP on an HTTPS page.`);
  if (security.https && !security.strictTransportSecurity) issue('HSTS_MISSING', 'Security', 'info', 'The response does not include Strict-Transport-Security.');
  if (!security.contentSecurityPolicy) issue('CSP_MISSING', 'Security', 'info', 'The response does not include Content-Security-Policy.');
  if (!security.xContentTypeOptions) issue('NOSNIFF_MISSING', 'Security', 'info', 'The response does not include X-Content-Type-Options.');
  const custom = extractCustom($, html, config, issue);
  const textDocument = load(html);
  textDocument('script,style,noscript,template,svg').remove();
  textDocument('address,article,aside,blockquote,br,dd,div,dl,dt,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,td,th,tr,ul').each((_, element) => {
    textDocument(element).prepend(' ').append(' ');
  });
  const text = compact(textDocument('body').text());
  const wordCount = text ? (text.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) ?? []).length : 0;
  return {
    title, titleLength: title.length, description, descriptionLength: description.length, keywords,
    h1, h2, h1Length:(h1[0]||'').length, h2Length:(h2[0]||'').length, keywordsLength:keywords.length, canonical, canonicalSource, metaRobots, xRobotsTag:responseHeaders['x-robots-tag']||'', lang, wordCount, textHash: digest(text), text,
    links, images, hreflang, structuredData, issues, custom, security, pagination, amp,
    indexable, indexabilityReason, openGraph, twitter, isAmp:$('html').attr('amp')!==undefined||$('html').attr('⚡')!==undefined,
  };
}

/** Findings for relationships whose targets exist in the supplied completed rows. Unknown targets remain unknown. */
export function analyzeRelationships(rows) {
  const byUrl = new Map(rows.map(row => [normalizeUrl(row.url), row]));
  const findings = [];
  const add = (url, code, category, severity, message) => findings.push({ url, code, category, severity, message });
  for (const row of rows) {
    for (const link of row.links ?? []) {
      const target = byUrl.get(link.url);
      if (target && target.status >= 400) add(row.url, 'BROKEN_LINK', 'Links', 'error', `Link to ${link.url} returns HTTP ${target.status}.`);
    }
    if (row.canonical && row.canonical !== row.url) {
      const target = byUrl.get(row.canonical);
      if (target?.status >= 400) add(row.url, 'CANONICAL_BROKEN', 'Canonicals', 'error', `Canonical target ${row.canonical} returns HTTP ${target.status}.`);
      else if (target && target.indexabilityReason === 'Noindex') add(row.url, 'CANONICAL_NOINDEX', 'Canonicals', 'warning', 'Canonical target declares noindex.');
      if (target?.canonical && target.canonical !== row.canonical) add(row.url, 'CANONICAL_CHAIN', 'Canonicals', 'warning', 'Canonical target declares another canonical URL.');
    }
    for (const alternate of row.hreflang ?? []) {
      const target = byUrl.get(alternate.url);
      if (!target) continue;
      if (target.status >= 400) add(row.url, 'HREFLANG_BROKEN', 'Hreflang', 'error', `Hreflang target ${alternate.url} returns HTTP ${target.status}.`);
      else if (!(target.hreflang ?? []).some(back => back.url === row.url)) add(row.url, 'HREFLANG_RETURN_MISSING', 'Hreflang', 'warning', `Hreflang target ${alternate.url} has no return link.`);
    }
  }
  return findings;
}

/** Jaccard word-trigram similarity. Bounded to 1,000 text-bearing rows and 10,000 words each. */
export function findNearDuplicates(rows, threshold = 0.9) {
  if (!(threshold >= 0 && threshold <= 1)) throw new RangeError('Similarity threshold must be between 0 and 1.');
  const documents = rows.filter(row => row.text?.trim()).slice(0, 1000).map(row => {
    const words = lower(row.text).split(/\s+/).slice(0, 10000);
    const shingles = new Set();
    for (let index = 0; index < Math.max(1, words.length - 2); index++) shingles.add(words.slice(index, index + 3).join(' '));
    return { url: row.url, shingles };
  });
  const pairs = [];
  for (let left = 0; left < documents.length; left++) {
    for (let right = left + 1; right < documents.length; right++) {
      const a = documents[left], b = documents[right];
      if (Math.min(a.shingles.size, b.shingles.size) / Math.max(a.shingles.size, b.shingles.size) < threshold) continue;
      let intersection = 0;
      for (const word of a.shingles) if (b.shingles.has(word)) intersection++;
      const similarity = intersection / (a.shingles.size + b.shingles.size - intersection);
      if (similarity >= threshold) pairs.push({ urlA: a.url, urlB: b.url, similarity: Math.round(similarity * 10000) / 10000 });
    }
  }
  return pairs;
}

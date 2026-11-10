import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, analyzePage, analyzeRelationships, findNearDuplicates } from '../lib/analyze.mjs';

const page = (html, options = {}) => analyzePage({ url: 'https://example.test/start', html, ...options });
const codes = result => result.issues.map(issue => issue.code);

test('URL resolution preserves queries, strips fragments, rejects non-web schemes', () => {
  assert.equal(normalizeUrl('../page?a=1#part', 'https://example.test/a/b'), 'https://example.test/page?a=1');
  assert.equal(normalizeUrl('mailto:test@example.test', 'https://example.test'), null);
  assert.equal(normalizeUrl('javascript:alert(1)', 'https://example.test'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl('/relative'), null);
});

test('extracts SEO fields and honors base URL and per-link nofollow', () => {
  const result = page(`<!doctype html><html lang="pt-BR"><head>
    <base href="/assets/"><title>  Um título de exemplo  </title>
    <meta name="description" content="Descrição de teste">
    <meta name="keywords" content="teste, crawler"><link rel="canonical" href="../start">
    <meta property="og:title" content="Social title"><meta name="twitter:card" content="summary">
    <link rel="next" href="../next"><link rel="amphtml" href="../amp">
    </head><body><h1>Principal</h1><h2>Seção</h2><p>Conteúdo útil.</p>
    <a href="item#details" rel="nofollow external">Leia mais</a>
    <a href="https://other.test/path">Outro</a><script>ignore these words</script>
    <img src="image.png" alt="Descrição" width="120" height="80">
    </body></html>`);
  assert.equal(result.title, 'Um título de exemplo');
  assert.equal(result.description, 'Descrição de teste');
  assert.equal(result.lang, 'pt-BR');
  assert.deepEqual(result.h1, ['Principal']);
  assert.equal(result.canonical, 'https://example.test/start');
  assert.equal(result.indexable, true);
  assert.equal(result.links.find(link => link.type === 'anchor').url, 'https://example.test/assets/item');
  assert.equal(result.links.find(link => link.type === 'anchor').follow, false);
  assert.equal(result.links.find(link => link.url.includes('other.test')).internal, false);
  assert.equal(result.images[0].url, 'https://example.test/assets/image.png');
  assert.equal(result.images[0].width, '120');
  assert.equal(result.openGraph.title, 'Social title');
  assert.equal(result.twitter.card, 'summary');
  assert.equal(result.pagination.next, 'https://example.test/next');
  assert.equal(result.amp, 'https://example.test/amp');
  assert(!result.text.includes('ignore these'));
  assert.equal(result.wordCount, 7);
  assert.equal(result.text, 'Principal Seção Conteúdo útil. Leia mais Outro');
  assert.equal(result.textHash.length, 64);
});

test('combines HTTP and HTML robots directives and differentiates image alt states', () => {
  const result = page(`<meta name="robots" content="nofollow"><h1>Same</h1><h1> Same </h1>
    <h2>Repeated</h2><h2>repeated</h2><img src="/a"><img src="/b" alt=""><img src="/c" alt="Text">
    <a href="/next">next</a>`, { headers: { 'X-Robots-Tag': 'noindex' } });
  assert.equal(result.indexable, false);
  assert.equal(result.indexabilityReason, 'Noindex');
  assert.equal(result.links.find(link => link.type === 'anchor').follow, false);
  assert.deepEqual(result.images.map(image => image.altMissing), [true, false, false]);
  for (const code of ['NOINDEX', 'H1_MULTIPLE', 'H1_DUPLICATE', 'H2_DUPLICATE', 'IMAGE_ALT_MISSING', 'IMAGE_ALT_EMPTY']) assert(codes(result).includes(code), code);
});

test('resolves HTTP canonicals and reports conflicts and malformed references', () => {
  const fromHeader = page('<title>Example document</title>', { headers: { Link: '<https://example.test/canonical>; rel="canonical"' } });
  assert.equal(fromHeader.canonical, 'https://example.test/canonical');
  assert.equal(fromHeader.canonicalSource, 'http');
  assert.equal(fromHeader.indexabilityReason, 'Canonicalised');
  assert(codes(page('<link rel="canonical" href="javascript:alert(1)">')).includes('CANONICAL_INVALID'));
  assert(codes(page('<link rel="canonical" href="">')).includes('CANONICAL_INVALID'));
  const conflict = page('<link rel="canonical" href="/a"><link rel="canonical" href="/b">', { headers: { link: '<https://example.test/c>; rel=canonical' } });
  assert(codes(conflict).includes('CANONICAL_MULTIPLE'));
  assert(codes(conflict).includes('CANONICAL_CONFLICT'));
});

test('validates structured data, hreflang and HTTPS resource security without treating outbound anchors as mixed content', () => {
  const result = page(`<link hreflang="en-GB" rel="alternate" href="/en">
    <link hreflang="not a language" href="mailto:invalid">
    <script type="application/ld+json">{"@type":"Thing","name":"Example"}</script>
    <script type="application/ld+json">{broken}</script>
    <img src="http://example.test/insecure.png" alt="x"><a href="http://other.test/">Other</a>`);
  assert.equal(result.structuredData[0]['@type'], 'Thing');
  assert.deepEqual(result.hreflang, [{ lang: 'en-GB', url: 'https://example.test/en' }]);
  assert.deepEqual(result.security.mixedContent, ['http://example.test/insecure.png']);
  for (const code of ['JSONLD_INVALID', 'HREFLANG_LANGUAGE_INVALID', 'HREFLANG_URL_INVALID', 'MIXED_CONTENT']) assert(codes(result).includes(code));
});

test('custom CSS, XPath and restricted regular expressions yield values and invalid patterns yield diagnostics', () => {
  const result = page('<html><body><h1>Heading</h1><a href="/target" data-id="42">Target</a><p>SKU-123</p></body></html>', {
    config: {
      customExtractions: [
        { name: 'css', type: 'css', selector: 'a', attribute: 'data-id' },
        { name: 'xpath', type: 'xpath', selector: '//h1/text()' },
        { name: 'regex', type: 'regex', selector: 'SKU-([0-9]+)' },
        { name: 'badCss', type: 'css', selector: '[' },
        { name: 'badXPath', type: 'xpath', selector: '//[' },
      ],
      customSearch: [{ name: 'sku', pattern: 'SKU-[0-9]+' }, { name: 'redos', pattern: '(a+)+$' }],
    },
  });
  assert.deepEqual(result.custom.css, ['42']);
  assert.deepEqual(result.custom.xpath, ['Heading']);
  assert.deepEqual(result.custom.regex, ['123']);
  assert.deepEqual(result.custom.sku.matches, ['SKU-123']);
  assert(result.custom.redos.error);
  assert.equal(result.issues.filter(issue => issue.code === 'CUSTOM_EXTRACTION_INVALID').length, 2);
  assert(codes(result).includes('CUSTOM_SEARCH_INVALID'));
});

test('reports search coverage truncation and never executes pathological regex', () => {
  const result = page('a'.repeat(9000), { config: { customSearch: [{ name: 'bounded', pattern: 'a+' }] } });
  assert.equal(result.custom.bounded.complete, false);
  assert.equal(result.custom.bounded.examinedCharacters, 8192);
  assert.equal(result.custom.bounded.matches[0].length, 8192);
});

test('relationship checks only claim failures for known fetched targets', () => {
  const findings = analyzeRelationships([
    { url: 'https://example.test/a', links: [{ url: 'https://example.test/b' }, { url: 'https://example.test/unknown' }], canonical: 'https://example.test/b', hreflang: [{ lang: 'en', url: 'https://example.test/c' }] },
    { url: 'https://example.test/b', status: 404 },
    { url: 'https://example.test/c', status: 200, hreflang: [] },
  ]);
  assert.deepEqual(findings.map(finding => finding.code), ['BROKEN_LINK', 'CANONICAL_BROKEN', 'HREFLANG_RETURN_MISSING']);
  assert(!findings.some(finding => finding.message.includes('unknown')));
});

test('near duplicate detection distinguishes repeated content from unrelated text', () => {
  const rows = [
    { url: 'a', text: 'This is the same useful document with a longer paragraph of shared content' },
    { url: 'b', text: 'This is the same useful document with a longer paragraph of shared content' },
    { url: 'c', text: 'An unrelated page about apples pears gardens and flowers' },
    { url: 'empty', text: '' },
  ];
  assert.deepEqual(findNearDuplicates(rows), [{ urlA: 'a', urlB: 'b', similarity: 1 }]);
  assert.throws(() => findNearDuplicates(rows, 2), RangeError);
});

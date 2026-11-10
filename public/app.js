/* Spider Local: original interface for the local crawler. Crawled content is always rendered as text. */
"use strict";
import issueGuidance from './issue-guidance.js';
window.SpiderIssueGuidance=issueGuidance;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const numberFormat = new Intl.NumberFormat("pt-BR");
const formatNumber = (value) => numberFormat.format(Number(value) || 0);
const tabs = [
  ["internal", "Internos"], ["external", "Externos"], ["security", "Segurança"],
  ["response", "Códigos de resposta"], ["url", "URLs"], ["titles", "Títulos de página"],
  ["descriptions", "Meta descriptions"], ["keywords", "Meta keywords"], ["h1", "H1"],
  ["h2", "H2"], ["content", "Conteúdo"], ["images", "Imagens"], ["canonicals", "Canonicals"],
  ["pagination", "Paginação"], ["directives", "Diretivas"], ["hreflang", "Hreflang"],
  ["javascript", "JavaScript"], ["links", "Links"], ["amp", "AMP"],
  ["structured", "Dados estruturados"], ["sitemaps", "Sitemaps"], ["pagespeed", "PageSpeed"], ["mobile", "Mobile"], ["spelling", "Ortografia e gramática"],
  ["accessibility", "Acessibilidade"], ["customSearch", "Pesquisa personalizada"],
  ["customExtraction", "Extração personalizada"], ["customJavaScript", "JavaScript personalizado"],
  ["analytics", "Analytics"], ["searchConsole", "Search Console"], ["linkMetrics", "Métricas de links"],
  ["ai", "IA"], ["changes", "Alterações"]
];
const details = [["summary", "Detalhes da URL"], ["inlinks", "Inlinks"], ["outlinks", "Outlinks"], ["images", "Imagens"], ["headers", "Cabeçalhos HTTP"], ["source", "Código-fonte"], ["issues", "Problemas"], ["custom", "Dados personalizados"]];
const statuses = { ready: "Pronto", queued: "Na fila", pending: "Na fila", running: "Rastreando", crawling: "Rastreando", paused: "Pausado", completed: "Concluído", complete: "Concluído", done: "Concluído", stopped: "Interrompido", failed: "Falhou", error: "Falhou" };
const configDefaults = { url: "", name: "", mode: "spider", urls: "", concurrency: 4, delayMs: 100, maxUrls: 0, maxDepth: 0, userAgent: "SpiderLocal/1.0", respectRobots: true, customRobots: "", followExternal: false, crawlSubdomains: false, renderJavaScript: false, renderWaitMs: 500, checkImages: true, crawlResources: true, crawlCanonicals: true, discoverSitemaps: false, maxExternalUrls: 0, include: "", exclude: "", customExtractions: [], customSearch: [], customJavaScript: "", accessibility: false, screenshots: false, headers: {}, username: "", password: "", cookie: "", nearDuplicates: false, nearDuplicateThreshold: 0.9, segments: [], crawlAMP: true, validateAMP: false, mobileAudit: false, spellCheck: false, grammarEndpoint: "http://127.0.0.1:8081/v2/check", grammarLanguage: "auto", formLoginUrl: "", formUsername: "", formPassword: "", formUsernameSelector: "input[name=username]", formPasswordSelector: "input[type=password]", formSubmitSelector: "button[type=submit]", formSuccessSelector: "" };
Object.assign(configDefaults,{timeoutMs:20000,maxBodyBytes:16777216});
const state = { job: null, jobs: [], config: { ...configDefaults }, tab: "internal", filter: "all", q: "", page: 1, pages: 1, pageSize: 100, sort: "url", direction: "asc", rows: [], total: 0, selected: null, detailTab: "summary", side: "overview", overview: null, capabilities: null, timer: null, refreshing: false, rowsRequest: 0, selectionRequest: 0, submitting: false };
const common = {
  url: { key: "url", label: "Endereço", width: 390 },
  status: { key: "statusCode", label: "Código de status", width: 115 },
  type: { key: "contentType", label: "Tipo de conteúdo", width: 160 },
  indexable: { key: "indexable", label: "Indexabilidade", width: 125 },
  reason: { key: "indexabilityReason", label: "Status de indexabilidade", width: 195 },
  title: { key: "title", label: "Título 1", width: 300 },
  statusText: { key: "statusText", label: "Status", width: 120 },
  titlePixels: { key: "titlePixelWidth", label: "Título 1: pixels*", width: 110, sortable: false },
  descriptionPixels: { key: "descriptionPixelWidth", label: "Descrição: pixels*", width: 125, sortable: false },
  titleLength: { key: "titleLength", label: "Tamanho do título", width: 115 },
  description: { key: "description", label: "Meta description", width: 340 },
  descriptionLength: { key: "descriptionLength", label: "Tamanho da descrição", width: 145 },
  depth: { key: "depth", label: "Profundidade", width: 100 },
  bytes: { key: "bytes", label: "Tamanho", width: 95 },
  time: { key: "responseTime", label: "Resposta (ms)", width: 110 },
  canonical: { key: "canonical", label: "URL canonical", width: 330 },
  issues: { key: "issues", label: "Problemas", width: 280 },
  words: { key: "wordCount", label: "Palavras", width: 90 }
};
const col = (key, label, width = 200) => ({ key, label, width });
const tabColumns = {
  internal: [common.url, common.type, common.status, common.statusText, common.indexable, common.reason, common.title, common.titleLength, common.titlePixels, common.description, common.descriptionLength, common.descriptionPixels, col("keywords", "Meta keywords 1", 260), col("keywordsLength", "Keywords: caracteres", 125), col("h1", "H1 1", 260), col("h1Length", "H1: caracteres", 95), col("h2", "H2 1", 260), col("h2Length", "H2: caracteres", 95), common.canonical, col("metaRobots", "Meta robots", 180), col("xRobotsTag", "X-Robots-Tag", 180), common.words, col("linkScore", "Link Score (próprio)", 130), col("segments", "Segmentos", 170), common.depth, common.bytes, common.time, common.issues],
  external: [common.url, common.type, common.status, common.time, common.issues],
  security: [common.url, common.status, common.issues, col("headers", "Cabeçalhos", 400)],
  response: [common.url, common.status, col("finalUrl", "URL final", 350), common.time, common.depth, common.issues],
  url: [common.url, common.status, common.indexable, common.depth, common.issues],
  titles: [common.url, common.title, common.titleLength, common.titlePixels, common.indexable, common.issues],
  descriptions: [common.url, common.description, common.descriptionLength, common.descriptionPixels, common.indexable, common.issues],
  keywords: [common.url, col("keywords", "Meta keywords", 330), common.indexable, common.issues],
  h1: [common.url, col("h1", "H1", 370), common.indexable, common.issues],
  h2: [common.url, col("h2", "H2", 370), common.indexable, common.issues],
  content: [common.url, common.words, col("lang", "Idioma", 85), common.bytes, common.issues],
  images: [common.url, common.status, common.type, common.bytes, common.issues],
  canonicals: [common.url, common.canonical, common.indexable, common.reason, common.issues],
  pagination: [common.url, col("pagination", "Paginação", 350), common.indexable, common.issues],
  directives: [common.url, col("metaRobots", "Meta robots", 270), common.indexable, common.reason, common.issues],
  hreflang: [common.url, col("hreflang", "Hreflang", 450), common.issues],
  javascript: [common.url, col("js", "JavaScript", 450), common.issues],
  links: [common.url, col("links", "Links encontrados", 450), common.depth, common.issues],
  amp: [common.url, col("amp", "AMP", 350),col('ampValidation','Validação AMP',300), common.issues],
  structured: [common.url, col("structuredData", "Dados estruturados", 500), common.issues],
  sitemaps: [common.url, common.status, common.indexable, common.canonical, common.issues],
  accessibility: [common.url, common.issues, col("accessibility", "Auditoria de acessibilidade", 400)],
  pagespeed: [common.url, col("pagespeed", "PageSpeed Insights", 600)],
  mobile: [common.url, col("mobile", "Lighthouse Mobile", 700), common.issues],
  spelling: [common.url, col("spelling", "Ortografia e gramática", 700), common.issues],
  customSearch: [common.url, col("custom", "Resultados de pesquisa", 600)],
  customExtraction: [common.url, col("custom", "Dados extraídos", 600)],
  customJavaScript: [common.url, col("customJavaScript", "JavaScript personalizado", 600)],
  analytics: [common.url, col("analytics", "Google Analytics", 600)],
  searchConsole: [common.url, col("searchConsole", "Search Console", 600)],
  linkMetrics: [common.url, col("linkMetrics", "Métricas de links", 600)],
  ai: [common.url, col("ai", "Resultados de IA", 600)],
  changes: [common.url, common.status, common.title, common.issues]
};
const providerTabs = new Set(["pagespeed", "analytics", "searchConsole", "linkMetrics", "ai"]);

function element(tag, attrs = {}, content) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "class") node.className = value;
    else if (name === "style") node.style.cssText = value;
    else node.setAttribute(name, String(value));
  }
  if (content !== undefined) node.textContent = String(content);
  return node;
}
function display(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item !== null ? JSON.stringify(item) : String(item)).join(" · ") || "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function dateLabel(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function running(job = state.job) {
  return !!job && ["running", "crawling", "queued", "pending", "pausing", "stopping", "analyzing"].includes(job.status);
}
function showError(error) {
  $("#error-text").textContent = error instanceof Error ? error.message : String(error);
  $("#error-banner").hidden = false;
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { cache: "no-store", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  } catch {
    throw new Error("Não foi possível conectar ao motor local. Confirme que o servidor do Spider Local está em execução.");
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(`O motor local retornou uma resposta inesperada (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(value.error?.message || value.error || value.message || `A operação falhou (HTTP ${response.status}).`);
  return value;
}
function bindTabKeys(container) {
  container.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = $$('[role="tab"]', container).filter(button => button.getClientRects().length);
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    let next = current + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    const target = buttons[(next + buttons.length) % buttons.length];
    target.focus();
    target.click();
  });
}
function renderTabs() {
  const container = $("#analysis-tabs");
  const groups = [
    ["Rastreamento", "03", ["internal","external","response","security","url","images","links","sitemaps"]],
    ["Conteúdo e SEO", "02", ["titles","descriptions","keywords","h1","h2","content","canonicals","pagination","directives","hreflang","amp","structured"]],
    ["Experiência", "08", ["javascript","pagespeed","mobile","accessibility","spelling"]],
    ["Personalização", "14", ["customSearch","customExtraction","customJavaScript"]],
    ["Dados e integrações", "09", ["analytics","searchConsole","linkMetrics","ai","changes"]],
  ];
  const names = {internal:"URLs internas",external:"Links externos",response:"Status e redirecionamentos",url:"Endereços",descriptions:"Descrições",keywords:"Palavras-chave",changes:"Comparar análises"};
  for (const [label,icon,keys] of groups) {
    const group = element("details", {class:"analysis-group",name:"analysis-navigation"});
    group.open = keys.includes(state.tab);
    const summary = element("summary");
    summary.append(element("img",{src:`/brand/icon-${icon}.svg`,alt:"",width:18,height:18}), document.createTextNode(label));
    group.append(summary);
    for (const key of keys) {
      const name = names[key] || tabs.find(([tab])=>tab===key)[1];
      const button = element("button",{type:"button","data-analysis":key,id:`tab-${key}`,"aria-controls":"results","aria-current":key===state.tab?"page":"false",tabindex:0},name);
      button.addEventListener("click",()=>selectTab(key));
      group.append(button);
    }
    container.append(group);
  }
  const detailContainer = $("#detail-tabs");
  for (const [key,name] of details) {
    const button = element("button",{type:"button",role:"tab",id:`detail-${key}`,"aria-controls":"detail-content","aria-selected":key===state.detailTab,tabindex:key===state.detailTab?0:-1},name);
    button.addEventListener("click",()=>{state.detailTab=key;updateTabSelection(detailContainer,`detail-${key}`);renderDetails();});
    detailContainer.append(button);
  }
  bindTabKeys(detailContainer);
  bindTabKeys($(".side-tabs"));
}
function updateTabSelection(container, id) {
  const navigation = container.id === "analysis-tabs";
  for (const button of $$(navigation ? "[data-analysis]" : '[role="tab"]', container)) {
    const active = button.id === id;
    if (navigation) button.setAttribute("aria-current",active?"page":"false");
    else button.setAttribute("aria-selected",String(active));
    button.tabIndex = navigation ? 0 : active ? 0 : -1;
    if (active && navigation) {
      const group=button.closest(".analysis-group");
      if(group) group.open=true;
      $("#analysis-title").textContent=button.textContent;
    }
  }
}
async function selectTab(key, filter = "all") {
  window.SpiderIssues.close();
  state.tab = key;
  state.filter = filter;
  state.page = 1;
  state.selected = null;
  state.selectionRequest += 1;
  state.rowsRequest += 1;
  updateJobDisplay();
  updateTabSelection($("#analysis-tabs"), `tab-${key}`);
  $("#results").setAttribute("aria-labelledby", `tab-${key}`);
  setFilterOption(filter);
  renderHead();
  renderDetails();
  await loadRows().catch(showError);
}
function setFilterOption(filter) {
  const select = $("#row-filter");
  for (const option of $$("option[data-dynamic]", select)) option.remove();
  if (![...select.options].some((option) => option.value === filter)) {
    const issue = (state.overview?.issues || []).find((item) => item.code === filter);
    const option = element("option", { value: filter, "data-dynamic": "true" }, issue?.message || (filter.startsWith("type:") ? (state.overview?.groups||[]).flatMap(group=>group.children||[]).find(type=>type.key===filter)?.label : null) || filter);
    select.append(option);
  }
  select.value = filter;
}
let measurementCanvas;
function measuredWidth(value,font) {
  measurementCanvas ||= document.createElement('canvas');
  const context=measurementCanvas.getContext('2d');
  if(!context)return '—';context.font=font;
  return String(Math.round(context.measureText(value||'').width));
}

function rowValue(row, key) {
  if(key==='ampValidation')return row.ampValidation?row.ampValidation.error||`${row.ampValidation.status} · ${row.ampValidation.errors?.length||0} ocorrências`:'Validação não executada';
  if(key==='spelling')return row.spelling?row.spelling.error||`${row.spelling.matches?.length||0} ocorrências · ${row.spelling.charactersChecked||0} caracteres verificados`:'—';
  if(key==='mobile')return row.mobile?row.mobile.error||Object.entries(row.mobile.scores||{}).map(([name,score])=>`${name}: ${score==null?'não disponível':Math.round(score*100)+'%'}`).join(' · '):'—';
  if(key==='statusText')return row.statusText||row.statusLabel||'—';
  if(key==='titlePixelWidth')return measuredWidth(row.title,'20px Arial');
  if(key==='descriptionPixelWidth')return measuredWidth(row.description,'14px Arial');
  if(key==='h1Length')return row.h1Length??(row.h1?.[0]||'').length;
  if(key==='h2Length')return row.h2Length??(row.h2?.[0]||'').length;
  if(key==='keywordsLength')return row.keywordsLength??(row.keywords||'').length;
  if(['titleLength','descriptionLength'].includes(key)&&row[key]==null)return '0';
  if (key === "indexable") return row.indexable === true ? "Indexável" : row.indexable === false ? "Não indexável" : "—";
  if (key === "issues") return (row.issues || []).map((item) => item.message || item.code).join(" · ") || "—";
  if (key === "bytes") return row.bytes == null ? "—" : `${formatNumber(row.bytes)} B`;
  if (key === "responseTime") return row.responseTime == null ? "—" : formatNumber(Math.round(row.responseTime));
  if (key === "links") return Array.isArray(row.links) ? formatNumber(row.links.length) : display(row.links);
  if (key === "headers") return Object.keys(row.headers || {}).join(", ") || "—";
  return display(row[key] ?? row.integrations?.[key] ?? row.custom?.[key]);
}
function renderHead() {
  const tr = element("tr");
  const num = element("th", { scope: "col", style: "width:38px" });
  num.append(element("span", {}, "#"));
  tr.append(num);
  for (const column of tabColumns[state.tab] || tabColumns.internal) {
    const th = element("th", { scope: "col", style: `width:${column.width}px;min-width:${column.width}px` });
    if(column.sortable===false){th.append(element('span',{title:'Medido neste navegador: título em Arial 20px; descrição em Arial 14px. Não validado com a métrica do original.'},column.label));tr.append(th);continue;}
    const sorted = state.sort === column.key;
    th.setAttribute("aria-sort", sorted ? (state.direction === "asc" ? "ascending" : "descending") : "none");
    const button = element("button", { type: "button", title: `Ordenar por ${column.label}` }, column.label);
    button.addEventListener("click", async () => {
      if (state.sort === column.key) state.direction = state.direction === "asc" ? "desc" : "asc";
      else { state.sort = column.key; state.direction = "asc"; }
      state.page = 1;
      renderHead();
      await loadRows().catch(showError);
    });
    th.append(button);
    tr.append(th);
  }
  $('#results-table').style.width=(38+(tabColumns[state.tab]||tabColumns.internal).reduce((sum,column)=>sum+column.width,0))+'px';
  $("#results-head").replaceChildren(tr);
}
let rowsRenderSignature;
function renderRows() {
  const body = $("#results-body");
  const columns = tabColumns[state.tab] || tabColumns.internal;
  const values=state.rows.map(row=>columns.map(column=>rowValue(row,column.key)));
  const signature=JSON.stringify([state.job?.id,state.tab,state.page,state.pageSize,state.selected?.id,state.rows.map(row=>[row.id,row.statusCode,(row.issues||[]).map(issue=>[issue.code,issue.severity,issue.message])]),values]);
  if(rowsRenderSignature!==signature){
  const fragment = document.createDocumentFragment();
  for (const [index, row] of state.rows.entries()) {
    const tr = element("tr", { "data-id": row.id, "aria-selected": String(state.selected?.id === row.id) });
    if (state.selected?.id === row.id) tr.classList.add("selected");
    tr.append(element("td", { class: "row-number" }, (state.page - 1) * state.pageSize + index + 1));
    for (const [columnIndex,column] of columns.entries()) {
      const value = values[index][columnIndex];
      const td = element("td", { title: value });
      if (column.key === "url") {
        td.className = "url-cell";
        const button = element("button", { type: "button", class: "url-select", "aria-label": `Ver detalhes de ${row.url}` }, row.url);
        button.addEventListener("click", (event) => { event.stopPropagation(); selectRow(row).catch(showError); });
        td.append(button);
      } else if (column.key === "statusCode") {
        const statusClass = row.statusCode >= 400 || row.statusCode === 0 ? "error" : row.statusCode >= 300 ? "redirect" : !row.statusCode ? "unknown" : "";
        td.append(element("span", { class: `code-pill ${statusClass}` }, row.statusCode ?? "—"));
      } else if (column.key === "issues" && row.issues?.length) {
        const first = row.issues.find((item) => ["error", "high"].includes(item.severity)) || row.issues[0];
        const issueButton = element("button", { type: "button", class: "row-issue-button", title: value, "aria-label": `${row.issues.length} ${row.issues.length === 1 ? "problema" : "problemas"} nesta URL. Ver correções.` });
        issueButton.append(element("span", { class: `issue-dot ${row.issues.some((item) => ["error", "high"].includes(item.severity)) ? "error" : ""}`, "aria-hidden": "true" }), document.createTextNode(`${row.issues.length} ${row.issues.length === 1 ? "problema" : "problemas"} · ver correções`));
        issueButton.addEventListener("click", (event) => { event.stopPropagation(); openIssueWorkspace(first.code); });
        td.append(issueButton);
      } else td.textContent = value;
      tr.append(td);
    }
    tr.addEventListener("click", () => selectRow(row).catch(showError));
    fragment.append(tr);
  }
  body.replaceChildren(fragment);
  rowsRenderSignature=signature;
  }
  $("#result-count").textContent = `${formatNumber(state.total)} resultados`;
  $("#page-info").textContent = state.total ? `${formatNumber((state.page - 1) * state.pageSize + 1)}–${formatNumber(Math.min(state.page * state.pageSize, state.total))} de ${formatNumber(state.total)} URLs` : state.job ? "Nenhum resultado neste filtro" : "Nenhum resultado";
  $("#page-current").textContent = `${state.page} / ${Math.max(1, state.pages)}`;
  $("#previous-page").disabled = state.page <= 1;
  $("#next-page").disabled = state.page >= state.pages;
  $("#export").disabled = !state.job;
  renderEmpty();
}
function renderEmpty() {
  const empty = $("#empty-state");
  empty.hidden = state.rows.length > 0;
  if (state.rows.length) return;
  if (!state.job) {
    if (empty.dataset.state === "initial") return;
    empty.dataset.state = "initial";
    empty.classList.remove("compact");
    const wrap = element("div",{class:"welcome-wrap"});
    const copy = element("div",{class:"welcome-copy"});
    const heading = element("h1",{},"Um olhar completo.");
    heading.append(element("span",{},"Um site melhor."));
    const actions = element("div",{class:"welcome-actions"});
    const begin = element("button",{type:"button",class:"button primary"},"Começar pela URL ↗");
    begin.addEventListener("click",()=>$("#crawl-url").focus());
    const history = element("button",{type:"button",class:"button subtle"},"Abrir análise salva");
    history.addEventListener("click",()=>openHistory().catch(showError));
    actions.append(begin,history);
    copy.append(element("span",{class:"eyebrow"},"CSW SITES / AUDITORIA INTELIGENTE"),heading,element("p",{},"Encontre links quebrados, entenda seu conteúdo e descubra o que pode evoluir. Comece com o endereço do seu site; a gente organiza os detalhes."),actions);
    const art = element("div",{class:"welcome-art","aria-hidden":"true"});
    const tile = element("div");
    tile.append(element("img",{src:"/brand/icon-14.svg",alt:"",width:118,height:118}));
    art.append(tile);
    for (const [icon,label] of [["06","Cada página conta."],["07","Próximo passo: evoluir."]]) {
      const tag=element("span",{class:"art-tag"});
      tag.append(element("img",{src:`/brand/icon-${icon}.svg`,alt:"",width:20,height:20}),document.createTextNode(label));
      art.append(tag);
    }
    wrap.append(copy,art);
    const path = element("div",{class:"welcome-path"});
    for (const [index,title,description] of [["01","Escolha seu site","Cole o endereço no campo acima."],["02","Personalize a análise","Ajuste o escopo em Configurações."],["03","Encontre oportunidades","Explore os resultados por categoria."]]) {
      const step=element("div",{class:"welcome-step"}),text=element("div");
      text.append(element("strong",{},title),element("p",{},description));
      step.append(element("b",{},index),text);
      path.append(step);
    }
    empty.replaceChildren(wrap,path,element("p",{class:"welcome-note"},"Sem teto comercial de URLs. Análises salvas automaticamente nesta máquina."));
    return;
  }
  empty.dataset.state = state.tab;
  empty.classList.add("compact");
  const optionalAnalysis = {
    mobile: ["mobileAudit", "Ative Lighthouse Mobile nas configurações de AMP, Mobile e ortografia para um novo rastreamento."],
    spelling: ["spellCheck", "Ative Ortografia e gramática e configure um servidor LanguageTool nas configurações para um novo rastreamento."],
    accessibility: ["accessibility", "Ative a renderização JavaScript e a auditoria de acessibilidade nas configurações para um novo rastreamento."],
    customSearch:['customSearch','Adicione regras de pesquisa em Configurações para um novo rastreamento.'],
    customExtraction:['customExtractions','Adicione regras de extração em Configurações para um novo rastreamento.'],
    customJavaScript:['customJavaScript','Adicione um snippet em Configurações para um novo rastreamento.'],
  }[state.tab];
  const configured=optionalAnalysis&&state.job.config?.[optionalAnalysis[0]];
  if (optionalAnalysis && (!configured||Array.isArray(configured)&&!configured.length)) {
    const button = element("button", { type: "button", class: "button", style: "margin-top:18px" }, "Configurar próximo rastreamento");
    button.addEventListener("click", openSettings);
    empty.replaceChildren(element("div", { class: "empty-icon", "aria-hidden": "true" }, "⚙"), element("h1", {}, "Esta análise não foi ativada."), element("p", {}, optionalAnalysis[1]), button);
    return;
  }
  if(state.tab==='linkMetrics'){empty.replaceChildren(element('h1',{},'Métricas de links indisponíveis nesta versão.'),element('p',{},'Os conectores de Ahrefs, Majestic e Moz ainda não foram implementados. As demais análises locais continuam disponíveis.'));return;}
  const title = state.tab === "changes" ? "Compare seus rastreamentos." : providerTabs.has(state.tab) ? "Conecte os dados desta análise." : running() ? "Aguardando resultados…" : "Nenhum resultado encontrado.";
  const text = state.tab === "changes" ? "Escolha dois rastreamentos salvos para verificar as alterações." : providerTabs.has(state.tab) ? "Esta análise depende de uma integração configurada e executada. Consulte a disponibilidade do provedor nesta instalação." : "Os resultados aparecem conforme as páginas são analisadas. Você também pode alterar o filtro ou a pesquisa.";
  empty.replaceChildren(element("div", { class: "empty-icon", "aria-hidden": "true" }, providerTabs.has(state.tab) ? "↗" : "⌕"), element("h1", {}, title), element("p", {}, text));
  if (providerTabs.has(state.tab) || state.tab === "changes") {
    const button = element("button", { type: "button", class: "button", style: "margin-top:18px" }, state.tab === "changes" ? "Comparar rastreamentos" : "Configurar integração");
    button.addEventListener("click", () => state.tab === "changes" ? openHistory(true).catch(showError) : openIntegrations());
    empty.append(button);
  }
}
function rowsParams() {
  return new URLSearchParams({ tab: state.tab, filter: state.filter, q: state.q, page: String(state.page), pageSize: String(state.pageSize), sort: state.sort, direction: state.direction });
}
async function loadRows() {
  const jobId = state.job?.id;
  if (!jobId) { state.rows = []; state.total = 0; state.pages = 1; renderRows(); return; }
  const request = ++state.rowsRequest;
  const params=rowsParams(),rowsKey=jobId+':'+params.toString();
  const result = await api(`/api/jobs/${encodeURIComponent(jobId)}/rows?${params}`);
  if (jobId !== state.job?.id || request !== state.rowsRequest) return;
  state.rows = result.rows || [];
  state.total = Number(result.total) || 0;
  state.pages = Number(result.pages) || Math.ceil(state.total / state.pageSize) || 1;
  state.page = Number(result.page) || state.page;
  state.rowsKey=rowsKey;state.rowsRevision=result.revision;
  renderRows();
}
async function selectRow(row) {
  const jobId = state.job?.id;
  const request = ++state.selectionRequest;
  state.selected = row;
  renderRows();
  renderDetails();
  if (!jobId) return;
  const fullRow = await api(`/api/jobs/${encodeURIComponent(jobId)}/rows/${encodeURIComponent(row.id)}`);
  if (request !== state.selectionRequest || jobId !== state.job?.id) return;
  state.selected = fullRow.row || fullRow;
  renderDetails();
}
function detailTable(columns, rows) {
  const table = element("table");
  const head = element("thead");
  const headRow = element("tr");
  for (const label of columns) {
    const th = element("th", { scope: "col" });
    th.append(element("span", {}, label));
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head);
  const body = element("tbody");
  for (const values of rows) {
    const tr = element("tr");
    for (const value of values) {
      const td = element("td", { class: "property-value" }, display(value));
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  return table;
}
function propertyTable(values) {
  const table = element("table");
  const body = element("tbody");
  for (const [key, value] of values) {
    const tr = element("tr");
    tr.append(element("td", { class: "property-key" }, key), element("td", { class: "property-value" }, display(value)));
    body.append(tr);
  }
  table.append(body);
  return table;
}
function renderDetails() {
  const content = $("#detail-content");
  const row = state.selected;
  $("#selected-url").textContent = row?.url || "Selecione uma URL na tabela";
  content.setAttribute("aria-labelledby", `detail-${state.detailTab}`);
  if (!row) {
    content.replaceChildren(element("div", { class: "detail-empty" }, "↖  Os dados da URL selecionada aparecem aqui."));
    return;
  }
  const tab = state.detailTab;
  if (tab === "summary") {
    content.replaceChildren(propertyTable([
      ["Endereço", row.url], ["URL final", row.finalUrl], ["Código de status", row.statusCode], ["Tipo de conteúdo", row.contentType],
      ["Indexabilidade", rowValue(row, "indexable")], ["Motivo", row.indexabilityReason], ["Título", row.title],
      ["Meta description", row.description], ["H1", row.h1], ["H2", row.h2], ["Canonical", row.canonical], ["Meta robots", row.metaRobots],
      ["Idioma", row.lang], ["Palavras", row.wordCount], ["Profundidade", row.depth], ["Tamanho (bytes)", row.bytes], ["Tempo de resposta (ms)", row.responseTime]
    ]));
  } else if (tab === "source") {
    content.replaceChildren(element("pre", {}, row.html ?? row.source ?? "O código-fonte ainda não está disponível para esta URL."));
  } else if (tab === "headers") {
    const entries = Object.entries(row.headers || {});
    content.replaceChildren(entries.length ? propertyTable(entries) : element("div", { class: "detail-empty" }, "Nenhum cabeçalho disponível."));
  } else if (tab === "issues") {
    const issues = row.issues || [];
    if (!issues.length) content.replaceChildren(element("div", { class: "detail-empty" }, "Nenhum problema registrado para esta URL."));
    else {
      const list = element("div", { class: "detail-issue-list" });
      for (const issue of issues) {
        const button = element("button", { type: "button", class: "detail-issue-item" });
        const guide = window.SpiderIssueGuidance?.[issue.code];
        button.append(element("strong", {}, guide?.title || issue.message || issue.code), element("span", {}, issue.message || issue.code), element("small", {}, "Ver detalhes e como corrigir →"));
        button.addEventListener("click", () => openIssueWorkspace(issue.code));
        list.append(button);
      }
      content.replaceChildren(list);
    }
  } else if (tab === "custom") {
    content.replaceChildren(propertyTable(Object.entries(row.custom || {})));
    if (!Object.keys(row.custom || {}).length) content.replaceChildren(element("div", { class: "detail-empty" }, "Nenhuma extração personalizada disponível."));
    for(const [field,label] of [['customJavaScript','JavaScript personalizado'],['ampValidation','Validação AMP'],['mobile','Lighthouse Mobile'],['spelling','Ortografia e gramática'],['accessibility','Acessibilidade'],['pagespeed','PageSpeed Insights'],['analytics','Google Analytics'],['searchConsole','Search Console'],['ai','Análise por IA']]){
      if(row[field]!=null)content.append(element('h3',{},label),element('pre',{},JSON.stringify(row[field],null,2)));
    }
  } else if (tab === "images") {
    const images = row.images || [];
    content.replaceChildren(images.length ? detailTable(["Imagem", "Texto alternativo", "Largura", "Altura", "Carregamento"], images.map((item) => [typeof item === "string" ? item : item.url || item.src, item.alt, item.width, item.height, item.loading])) : element("div", { class: "detail-empty" }, "Nenhuma imagem registrada para esta URL."));
  } else {
    const links = tab === "inlinks" ? row.inlinks || [] : row.links || row.outlinks || [];
    content.replaceChildren(links.length ? detailTable([tab === "inlinks" ? "Origem" : "Destino", "Texto âncora", "Rel", "Tipo"], links.map((item) => typeof item === "string" ? [item, "", "", ""] : [item.url || item.href || item.source || item.from, item.text || item.anchor || item.anchorText, item.rel, item.type || (item.internal === false ? "Externo" : "Interno")])) : element("div", { class: "detail-empty" }, "Nenhum link registrado nesta categoria."));
  }
  if(tab==='summary'&&row.screenshot){
    const image=element('img',{src:row.screenshot,alt:'Captura da página '+row.url,loading:'lazy',style:'max-width:100%;height:auto'});
    content.append(element('h3',{},'Screenshot da página'),image);
  }
}
function updateJobDisplay() {
  let notices=$('#analysis-notes');
  if(!notices){notices=element('details',{id:'analysis-notes',class:'setting-hint',style:'margin:12px 20px;padding:12px;border:1px solid #d6d6cd;border-radius:8px'});$('.metrics').after(notices);}
  const notes=[...(state.job?.notes||[])];
  if(state.capabilities?.storage?.mode==='session')notes.unshift('Sessão temporária: exporte os resultados antes de encerrar o aplicativo. As análises desta sessão serão descartadas ao fechar o servidor.');
  if(state.job&&state.tab==='structured')notes.push('Dados estruturados: extração de JSON-LD e verificação de sintaxe JSON. Não inclui validação completa de Schema.org ou elegibilidade para rich results.');
  if(state.job&&['customSearch','customExtraction'].includes(state.tab))notes.push('Regex: HTML completo examinado com prazo de execução. Até 100 valores por regra; verifique os avisos de truncamento ou pesquisa incompleta.');
  const notesSignature=JSON.stringify(notes);
  notices.hidden=!notes.length;
  if(notices.dataset.signature!==notesSignature){notices.replaceChildren(element('summary',{},'Avisos e limites desta análise ('+notes.length+')'),...notes.map(note=>element('p',{},note)));notices.dataset.signature=notesSignature;}
  document.body.classList.toggle("app-no-session", !state.job);
  const job = state.job || { status: "ready", name: "Nenhum rastreamento selecionado", config: state.config };
  $("#clear").disabled = !state.job || running(job) || state.submitting;
  if (job.error) showError(job.error);
  const stats = job.stats || {};
  const done = Number(stats.done) || 0;
  const found = Number(stats.found) || 0;
  const pending = Number(stats.pending) || 0;
  const percentage = found ? Math.min(100, Math.round(done / found * 100)) : 0;
  const finished = !running(job) && job.status !== "paused";
  $("#job-state").textContent = statuses[job.status] || job.status || "Desconhecido";
  $("#job-state").className = `status-chip ${running(job) ? "running" : ["failed", "error"].includes(job.status) ? "failed" : ""}`;
  $("#job-name").textContent = job.name || job.config?.url || "Rastreamento";
  $("#job-name").title = job.name || job.config?.url || "";
  $("#job-date").textContent = dateLabel(job.createdAt);
  $("#progress-bar").style.width = `${percentage}%`;
  $(".progress-track").setAttribute("aria-valuenow", String(percentage));
  $("#progress-percent").textContent = `${percentage}%`;
  $("#progress-text").textContent = `${formatNumber(done)} de ${formatNumber(found)} URLs`;
  $("#metric-done").textContent = formatNumber(done);
  $("#metric-pending").textContent = formatNumber(pending);
  $("#metric-issues").textContent = formatNumber(stats.issues);
  $("#issues-count").textContent = formatNumber((state.overview?.issues || []).reduce((sum, issue) => sum + (Number(issue.count) || 0), 0));
  $("#footer-status").textContent = `${statuses[job.status] || job.status} · ${job.name || job.config?.url || "Rastreamento"}`;
  $("#footer-total").textContent = `${formatNumber(found)} URLs · ${formatNumber(stats.failed)} falhas`;
  $("#footer-render").textContent = job.config?.renderJavaScript ? "JavaScript" : "HTML";
  $("#pause").disabled = !running(job) || state.submitting;
  $("#stop").disabled = finished || state.submitting;
  $("#start").disabled = running(job) || state.submitting;
  $("#start").replaceChildren(element("span", { "aria-hidden": "true" }, "▶"), document.createTextNode(job.status === "paused" ? "Retomar análise" : "Analisar site"));
  $("#integration-run").disabled = !state.job || state.submitting;
  $("#integration-scope").textContent = `Rastreamento: ${job.name || job.config?.url || job.id}`;
}
function renderTypeChart(overview) {
  const container=$('#type-chart');if(!container)return;
  const scope=state.tab==='external'?'external':'internal';
  const group=(overview.groups||[]).find(item=>item.key===scope);
  container.replaceChildren();container.hidden=!group?.total||!group?.children?.length||state.side!=='overview';
  if(container.hidden)return;
  const colors={html:'#e5c400',javascript:'#414146',css:'#8e8d80',image:'#bcbbae',media:'#6b685a',font:'#a59d7c',xml:'#d4c99e',pdf:'#756f53',flash:'#999482',other:'#c9c5b5',unknown:'#e7e6de'};
  const types=group.children.filter(item=>item.total),chart=element('div',{class:'donut',role:'img','aria-label':group.label+': '+types.map(type=>type.label+' '+type.total).join(', ')});
  let position=0;const gradient=types.map(type=>{const from=position;position+=type.total/group.total*100;return colors[type.type]+' '+from+'% '+position+'%';});
  chart.style.background='conic-gradient('+gradient.join(',')+')';chart.append(element('strong',{},formatNumber(group.total)));
  const legend=element('ul',{class:'chart-legend'});for(const type of types){const item=element('li');item.append(element('span',{class:'chart-dot',style:'background:'+colors[type.type],'aria-hidden':'true'}),document.createTextNode(type.label+' '+type.total));legend.append(item);}
  container.append(element('h3',{},group.label+' por tipo'),chart,legend);
}

function renderOverview() {
  const filter=$('#row-filter'),selectedFilter=filter.value;
  for(const option of filter.querySelectorAll('option[data-segment]'))option.remove();
  for(const segment of state.overview?.segments||[])filter.append(element('option',{value:'segment:'+segment.name,'data-segment':'true'},'Segmento: '+segment.name+' ('+segment.count+')'));
  if([...filter.options].some(option=>option.value===selectedFilter))filter.value=selectedFilter;
  const root = $("#side-content");
  root.setAttribute("aria-labelledby", `side-${state.side}`);
  if (!state.job) {
    renderTypeChart({ groups: [] });
    root.replaceChildren(element("p", { class: "muted side-empty" }, "Nenhum rastreamento selecionado."));
    return;
  }
  const overview = state.overview || { groups: [], issues: [], tree: [] };
  renderTypeChart(overview);
  root.replaceChildren();
  if (state.side === "overview") {
    const heading = element("div", { class: "group-heading" });
    heading.append(element("span", {}, "Resumo de URLs"), element("span", {}, "Total"));
    root.append(heading);
    const groups = overview.groups || [];
    if (!groups.length) root.append(element("p", { class: "muted side-empty" }, "Aguardando dados de análise."));
    const highest = Math.max(1, ...groups.map((group) => Number(group.total) || 0));
    for (const group of groups) {
      if(group.children) {
        const section=element('details',{class:'overview-section',open:''});
        const summary=element('summary');summary.append(element('strong',{},group.label),element('span',{},formatNumber(group.total)));
        section.append(summary);
        const all=element('button',{type:'button',class:'type-row all'});all.append(element('span',{},'Todos'),element('strong',{},formatNumber(group.total)),element('span',{},group.total?'100%':'0%'));all.addEventListener('click',()=>selectTab(group.key));section.append(all);
        for(const type of group.children){const button=element('button',{type:'button',class:'type-row'});button.append(element('span',{},type.label),element('strong',{},formatNumber(type.total)),element('span',{},(type.percent||0).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%'));button.addEventListener('click',()=>selectTab(group.key,type.key));section.append(button);}
        root.append(section);continue;
      }
      const button=element('button',{class:'overview-row',type:'button'});button.append(element('span',{},group.label||group.key),element('strong',{},formatNumber(group.total)));button.addEventListener('click',()=>selectTab(group.key));root.append(button);
    }
    for (const note of state.job.notes || []) root.append(element("p", { class: "muted side-empty" }, note));
    const stats = state.job.stats || {};
    const statsHeading = element("div", { class: "group-heading" }, "Estatísticas do rastreamento");
    root.append(statsHeading);
    for (const [label, value] of [["URLs descobertas", stats.found], ["Páginas HTML", stats.html], ["Falhas de requisição", stats.failed], ["Aguardando análise", stats.pending]]) {
      const item = element("div", { class: "overview-row" });
      item.append(element("span", {}, label), element("strong", {}, formatNumber(value)));
      root.append(item);
    }
  } else if (state.side === "issues") {
    const issues = overview.issues || [];
    if (!issues.length) root.append(element("p", { class: "muted side-empty" }, running() ? "Os problemas aparecem à medida que o rastreamento avança." : "Nenhum problema encontrado nos resultados disponíveis."));
    for (const issue of issues) {
      const button = element("button", { type: "button", class: "issue-row" });
      const meta = element("div");
      const severityLabel = { error: "Erro", warning: "Aviso", info: "Informação", high: "Alta", medium: "Média", low: "Baixa" }[issue.severity] || issue.severity || "Aviso";
      meta.append(element("span", { class: `severity ${issue.severity}` }, severityLabel), element("strong", {}, formatNumber(issue.count)));
      button.append(meta, element("p", {}, issue.message || issue.code), element("small", {}, issue.category || issue.code));
      button.addEventListener("click", () => openIssueWorkspace(issue.code));
      root.append(button);
    }
  } else {
    const tree = overview.tree || [];
    root.append(element("div", { class: "group-heading" }, "Estrutura por caminho"));
    if (!tree.length) root.append(element("p", { class: "muted side-empty" }, "A estrutura aparece após a descoberta de URLs."));
    for (const item of tree) {
      const row = element("div", { class: "tree-row" });
      const path = item.path || item.url || "/";
      row.append(element("span", { title: path, style: `padding-left:${Math.min(7, path.split("/").filter(Boolean).length) * 8}px` }, path), element("strong", {}, formatNumber(item.count)));
      root.append(row);
    }
  }
}
function scheduleRefresh() {
  clearTimeout(state.timer);
  if(document.hidden)return;
  if (running() || state.job?.integration?.status === "running") state.timer = setTimeout(() => refreshJob().catch(showError), 1500);
}
async function refreshJob() {
  const id = state.job?.id;
  if (!id || state.refreshing === id) return;
  state.refreshing = id;
  try {
    const params=rowsParams(),rowsKey=id+':'+params.toString(),rowRequest=state.rowsRequest;
    if(state.overview&&state.overviewJob===id)params.set('sinceOverview',state.overviewRevision||'');
    if(state.rowsKey===rowsKey)params.set('sinceRows',state.rowsRevision||'');
    const snapshot=await api(`/api/jobs/${encodeURIComponent(id)}/view?${params}`);
    if (state.job?.id !== id) return;
    const job=snapshot.job;
    state.job = job;
    if (job.integration && $("#integration-dialog").open) {
      $("#integration-result").textContent = JSON.stringify(job.integration, null, 2);
      $("#integration-result").hidden = false;
      $("#integration-run").disabled = job.integration.status === "running";
    }
    if(snapshot.overview){
      const signature=JSON.stringify(snapshot.overview);
      const changed=state.overviewJob!==id||state.overviewSignature!==signature;
      state.overview=snapshot.overview;state.overviewSignature=signature;
      state.overviewJob=id;state.overviewRevision=snapshot.revision;
      if(changed)renderOverview();
      window.SpiderIssues.refresh(job,state.overview);
    }
    updateJobDisplay();
    if(snapshot.rows&&rowRequest===state.rowsRequest&&rowsKey===id+':'+rowsParams().toString()){
      state.rowsRequest++;
      state.rows=snapshot.rows.rows||[];
      state.total=Number(snapshot.rows.total)||0;state.pages=Number(snapshot.rows.pages)||1;
      state.page=Number(snapshot.rows.page)||state.page;
      state.rowsKey=rowsKey;state.rowsRevision=snapshot.rows.revision;
      renderRows();
    }
  } finally {
    if (state.refreshing === id) state.refreshing = false;
    scheduleRefresh();
  }
}
async function selectJob(job) {
  window.SpiderIssues.close();
  try { sessionStorage.removeItem("spiderLocal.emptyView"); } catch {}
  clearTimeout(state.timer);
  state.selectionRequest += 1;
  state.rowsRequest += 1;
  state.job = job;
  state.rows = [];
  state.selected = null;
  state.overview = null;
  state.rowsKey=null;state.rowsRevision=null;state.overviewJob=null;
  state.page = 1;
  state.total = 0;
  const resumable = running(job) || job.status === "paused";
  state.config = { ...configDefaults, ...job.config, mode: resumable ? job.config?.mode || "spider" : "spider", name: resumable ? job.config?.name || "" : "" };
  // Keep credentials only for this session and never write them to browser storage.
  $("#crawl-url").value = job.config?.url || "";
  $("#crawl-mode").value = state.config.mode;
  updateJobDisplay();
  renderRows();
  renderDetails();
  await refreshJob();
}
function parseJsonField(form, name, fallback, array) {
  const raw = form.elements.namedItem(name).value.trim();
  if (!raw) return fallback;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`JSON inválido no campo ${{ customExtractions: "Regras de extração", customSearch: "Pesquisas no HTML", headers: "Cabeçalhos adicionais" }[name] || name}.`); }
  if (array ? !Array.isArray(parsed) : !parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`O campo ${name} deve conter ${array ? "uma lista JSON" : "um objeto JSON"}.`);
  return parsed;
}
function readSettings() {
  const form = $("#settings-form");
  const config = { ...state.config };
  const booleans = ["respectRobots", "followExternal", "crawlSubdomains", "renderJavaScript", "checkImages", "crawlResources", "crawlCanonicals", "discoverSitemaps", "accessibility", "screenshots", "nearDuplicates", "crawlAMP", "validateAMP", "mobileAudit", "spellCheck"];
  const numbers = ["concurrency", "delayMs", "maxUrls", "maxExternalUrls", "maxDepth", "renderWaitMs", "nearDuplicateThreshold", "timeoutMs", "maxBodyBytes"];
  for (const [key] of Object.entries(configDefaults)) {
    const control = form.elements.namedItem(key);
    if (!control || ["customExtractions", "customSearch", "headers", "segments"].includes(key)) continue;
    config[key] = booleans.includes(key) ? control.checked : numbers.includes(key) ? Number(control.value) : control.value;
  }
  config.segments = parseJsonField(form, "segments", [], true);
  config.customExtractions = parseJsonField(form, "customExtractions", [], true);
  config.customSearch = parseJsonField(form, "customSearch", [], true);
  config.headers = parseJsonField(form, "headers", {}, false);
  for (const key of ["include", "exclude"]) {
    if (config[key]) try { new RegExp(config[key]); } catch { throw new Error(`Expressão regular inválida em ${key === "include" ? "Incluir URLs" : "Excluir URLs"}.`); }
  }
  return config;
}
function showDialog(selector) {
  for (const dialog of $$("dialog[open]")) if (dialog !== $(selector)) dialog.close();
  $$(".menu[open]").forEach((menu) => menu.removeAttribute("open"));
  const dialog = $(selector);
  if (!dialog.open) dialog.showModal();
}
function openSettings() {
  const form = $("#settings-form");
  for (const [key, fallback] of Object.entries(configDefaults)) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    const value = state.config[key] ?? fallback;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else if (["headers", "customExtractions", "customSearch", "segments"].includes(key)) control.value = Array.isArray(value) ? value.length ? JSON.stringify(value, null, 2) : "" : value && Object.keys(value).length ? JSON.stringify(value, null, 2) : "";
    else control.value = Array.isArray(value) ? value.join("\n") : value;
  }
  form.elements.namedItem("mode").value = $("#crawl-mode").value;
  $("#settings-error").hidden = true;
  showDialog("#settings-dialog");
}
async function startCrawl(event) {
  event.preventDefault();
  if (state.submitting || running()) return;
  const config = { ...state.config, url: $("#crawl-url").value.trim(), mode: $("#crawl-mode").value };
  try {
    const normalizeInput = (value) => {
      const input = String(value || "").trim();
      if (!input) return "";
      const hostWithPort = /^[^\s/?#:]+:\d+(?:[/?#]|$)/.test(input);
      const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
      const parsed = new URL(!hasScheme || hostWithPort ? "https://" + input : input);
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error("Informe um endereço de site válido com HTTP ou HTTPS.");
      return parsed.href;
    };
    config.url = normalizeInput(config.url);
    const previousUrl = normalizeInput(state.job?.config?.url);
    if (config.url && previousUrl && config.url !== previousUrl) {
      if (config.name === state.job.name || config.name === state.job.config?.name) config.name = "";
      if (config.mode === "list" && JSON.stringify(config.urls) === JSON.stringify(state.job.config?.urls)) {
        config.mode = "spider";
        config.urls = [];
        $("#crawl-mode").value = "spider";
      }
    }
    if (config.mode === "spider") config.urls = [];
    if (config.mode === "list") {
      const urls = (Array.isArray(config.urls) ? config.urls : String(config.urls || "").split(/\r?\n/)).map(url=>String(url).trim()).filter(Boolean);
      config.urls = urls.length ? urls.map(normalizeInput) : config.url ? [config.url] : [];
      config.url = config.url || config.urls[0] || "";
    }
    if (!config.url) throw new Error("Cole o endereço do site no campo acima para começar.");
    $("#crawl-url").value = config.url;
  } catch (error) {
    showError(error instanceof TypeError ? "Informe um endereço de site válido, por exemplo seusite.com.br." : error);
    $("#crawl-url").focus();
    return;
  }
  if (state.job?.status === "paused" && config.url === (state.job.config?.url || "") && config.mode === (state.job.config?.mode || "spider")) {
    await jobAction("resume");
    return;
  }
  state.submitting = true;
  $("#start").disabled = true;
  $("#footer-status").textContent = "Iniciando análise…";
  try {
    const job = await api("/api/jobs", {method:"POST",body:JSON.stringify(config)});
    state.submitting = false;
    await selectJob(job.job || job);
  } catch (error) {
    showError(error);
    $("#footer-status").textContent = "Falha ao iniciar";
  } finally {
    state.submitting = false;
    $("#start").disabled = running();
    updateJobDisplay();
  }
}
async function jobAction(action) {
  if (!state.job || state.submitting) return;
  state.submitting = true;
  updateJobDisplay();
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(state.job.id)}/${action}`, { method: "POST" });
    state.job = job.job || job;
    state.submitting = false;
    await refreshJob();
  } finally { state.submitting = false; updateJobDisplay(); }
}
function exportResults(format) {
  if (!state.job) { showError("Inicie ou abra um rastreamento antes de exportar os resultados."); return; }
  const params = rowsParams();
  const selectedFormat=format||$('#export-format').value;
  params.set("format",selectedFormat);
  if(selectedFormat==='sitemap'){params.set('tab','internal');params.set('filter','indexable');params.set('q','');$('#footer-status').textContent='Exportando sitemap com as páginas internas indexáveis desta análise.';}
  const link = element("a", { href: `/api/jobs/${encodeURIComponent(state.job.id)}/export?${params}`, download: "" });
  document.body.append(link);
  link.click();
  link.remove();
}
async function loadJobs() {
  const result = await api("/api/jobs");
  state.jobs = Array.isArray(result) ? result : result.jobs || [];
  return state.jobs;
}
async function openHistory(compare = false) {
  showDialog("#history-dialog");
  $("#history-list").replaceChildren(element("p", { class: "muted" }, "Carregando rastreamentos salvos…"));
  const jobs = await loadJobs();
  const root = $("#history-list");
  root.replaceChildren();
  for (const job of jobs) {
    const item = element("article", { class: "history-item" });
    const text = element("div");
    text.append(element("h3", {}, job.name || job.config?.url || job.id));
    const meta = element("p");
    meta.append(element("span", { class: "status-chip" }, statuses[job.status] || job.status), document.createTextNode(`${dateLabel(job.createdAt)} · ${formatNumber(job.stats?.done)} URLs rastreadas`));
    text.append(meta);
    const button = element("button", { type: "button", class: "button" }, "Abrir");
    button.addEventListener("click", () => {
      $("#history-dialog").close();
      selectJob(job).catch(showError);
    });
    item.append(text, button);
    root.append(item);
  }
  if (!jobs.length) root.append(element("p", { class: "muted" }, "Ainda não há rastreamentos salvos. Inicie o primeiro pelo campo de URL."));
  for (const id of ["compare-a", "compare-b"]) {
    const select = $(`#${id}`);
    select.replaceChildren(element("option", { value: "" }, "Selecione um rastreamento"));
    for (const job of jobs) select.append(element("option", { value: job.id }, `${job.name || job.config?.url || job.id} · ${dateLabel(job.createdAt)}`));
  }
  if (jobs.length >= 2) { $("#compare-a").value = jobs[1].id; $("#compare-b").value = jobs[0].id; }
  if (compare) $(".compare-section").scrollIntoView({ block: "nearest" });
}
async function compareJobs(event) {
  event.preventDefault();
  const a = $("#compare-a").value;
  const b = $("#compare-b").value;
  if (!a || !b || a === b) { $("#compare-result").replaceChildren(element("p", { class: "form-error", role: "alert" }, "Selecione dois rastreamentos diferentes.")); return; }
  const root = $("#compare-result");
  root.replaceChildren(element("p", { class: "muted", role: "status" }, "Comparando rastreamentos…"));
  try {
    const result = await api(`/api/compare?${new URLSearchParams({ a, b })}`);
    root.replaceChildren(propertyTable(Object.entries(result.summary || {})));
    if (result.changes?.length) {
      root.append(detailTable(["URL", "Alteração", "Campos"], result.changes.map((change) => [change.url, change.type || change.change, change.fields || change.changes || change])));
    } else root.append(element("p", { class: "muted", style: "margin-top:12px" }, "Nenhuma alteração registrada."));
  } catch (error) { root.replaceChildren(element("p", { class: "form-error", role: "alert" }, error.message)); }
}
function renderCapabilities() {
  const root = $("#capabilities-list");
  root.replaceChildren();
  const features = state.capabilities?.features || [];
  for (const feature of features) {
    const item = element("div", { class: "capability-item" });
    const unavailable = /unavailable|unsupported|not.?implemented|missing|planned|disabled|pending/i.test(feature.status || "");
    const labels = { available: "Disponível", implemented: "Disponível", ready: "Disponível", optional: "Opcional", unavailable: "Indisponível", unsupported: "Não implementado", not_implemented: "Não implementado", requires_setup: "Requer configuração", requires_key: "Requer chave", configured: "Configurado", partial: "Parcial", disabled: "Desativado", unverified: "Validação pendente", planned: "Planejado", "external-service": "Serviço externo" };
    item.append(element("strong", {}, feature.name), element("span", { class: `capability-status ${unavailable ? "unavailable" : ""}` }, labels[feature.status] || feature.status || "Consultar"), element("p", {}, feature.detail || ""));
    root.append(item);
  }
  if (!features.length) root.append(element("p", { class: "muted" }, "O motor não informou a lista de recursos."));
  const browser = state.capabilities?.browserAvailable;
  $("#browser-availability").textContent = browser ? "Chromium disponível nesta instalação para renderização e auditorias." : "Chromium ainda não está disponível nesta instalação. Consulte as instruções de instalação para ativar a renderização e as auditorias que dependem do navegador.";
}
function openIntegrations() {
  $("#integration-error").hidden = true;
  $("#integration-run").disabled = !state.job;
  $("#integration-scope").textContent = state.job ? `Rastreamento: ${state.job.name || state.job.config?.url || state.job.id}` : "Selecione um rastreamento primeiro.";
  showDialog("#integration-dialog");
  const providerForTab={analytics:'ga4',searchConsole:'searchConsole',pagespeed:'pagespeed',ai:'openai'}[state.tab];
  if(providerForTab)$('#integration-provider').value=providerForTab;
  updateIntegrationFields();
}
function updateIntegrationFields(){
  const form=$('#integration-form'),catalog=state.capabilities?.integrations||{};
  for(const option of form.elements.provider.options){if(!catalog[option.value]){option.disabled=true;if(!option.textContent.includes('indisponível'))option.textContent+=' (indisponível)';}}
  const provider=form.elements.provider.value,metadata=catalog[provider],ai=!!metadata?.model;
  form.elements.apiKey.required=['required','oauth-access-token'].includes(metadata?.apiKey);
  form.elements.model.required=ai;form.elements.propertyId.required=!!metadata?.propertyId;
  for(const [key,visible] of [['apiKey',metadata?.apiKey!=='unused'],['model',ai],['propertyId',!!metadata?.propertyId],['strategy',provider==='pagespeed'],['prompt',ai],['endpoint',provider==='ollama']])form.elements.namedItem(key).closest('label').hidden=!visible;
  let hint=$('#integration-provider-hint');if(!hint){hint=element('p',{id:'integration-provider-hint',class:'setting-hint',role:'status'});form.elements.provider.closest('label').after(hint);}
  hint.textContent=!metadata?'Conector indisponível nesta versão.':provider==='ollama'?'Informe o modelo instalado e o endereço do Ollama local.':['ga4','searchConsole'].includes(provider)?'Requer uma propriedade autorizada e um token de acesso OAuth válido. Renovação automática ainda não está disponível.':'Requer sua conta, modelo quando solicitado e eventuais cotas do provedor. A chave não é salva.';
  $('#integration-run').disabled=!state.job||!metadata||state.job.integration?.status==='running';
}
async function runIntegration(event) {
  event.preventDefault();
  if (!state.job) return;
  const form = $("#integration-form");
  const button = $("#integration-run");
  const id = state.job.id;
  const body = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  button.textContent = "Executando…";
  $("#integration-error").hidden = true;
  $("#integration-result").hidden = false;
  $("#integration-result").textContent = "Aguardando resposta do provedor…";
  try {
    const result = await api(`/api/jobs/${encodeURIComponent(id)}/integrate`, { method: "POST", body: JSON.stringify(body) });
    $("#integration-result").textContent = JSON.stringify(result, null, 2);
    form.elements.namedItem("apiKey").value = "";
    if (state.job?.id === id) await refreshJob();
  } catch (error) {
    $("#integration-error").textContent = error.message;
    $("#integration-error").hidden = false;
    $("#integration-result").hidden = true;
  } finally { updateIntegrationFields();button.textContent = "Executar integração"; }
}
function clearView() {
  if (running() || state.submitting) return;
  window.SpiderIssues.close();
  clearTimeout(state.timer);
  state.rowsRequest += 1;
  state.selectionRequest += 1;
  Object.assign(state, { job: null, rows: [], total: 0, page: 1, pages: 1, selected: null, overview: null, timer: null, refreshing: false, tab: "internal", detailTab: "summary", side: "overview", filter: "all", q: "", sort: "url", direction: "asc" });
  state.config = { ...state.config, url: "", name: "", urls: "", mode: "spider" };
  $("#crawl-mode").value = "spider";
  try { sessionStorage.setItem("spiderLocal.emptyView", "1"); } catch {}
  $("#crawl-url").value = "";
  $("#row-search").value = "";
  $("#error-banner").hidden = true;
  setFilterOption("all");
  updateTabSelection($("#analysis-tabs"), "tab-internal");
  updateTabSelection($("#detail-tabs"), "detail-summary");
  updateTabSelection($(".side-tabs"), "side-overview");
  $("#results").setAttribute("aria-labelledby", "tab-internal");
  $("#results").scrollLeft = 0;
  $("#results").scrollTop = 0;
  renderHead();
  renderRows();
  renderDetails();
  renderOverview();
  updateJobDisplay();
  $("#footer-status").textContent = "Tela limpa. Rastreamentos preservados no Histórico.";
  $("#crawl-url").focus();
}

function openIssueWorkspace(code) {
  if (!state.job) return;
  if (window.SpiderIssues.isOpen()) {
    if (code) window.SpiderIssues.select(code);
    return;
  }
  window.SpiderIssues.open({
    job: state.job,
    overview: state.overview || { issues: [] },
    api,
    onReturn: () => updateTabSelection($("#analysis-tabs"), `tab-${state.tab}`)
  }, code);
}

function handleAction(action) {
  $$(".menu[open]").forEach((menu) => menu.removeAttribute("open"));
  if (action === "clear") clearView();
  else if (action === "settings") openSettings();
  else if (action === "history" || action === "compare") openHistory(action === "compare").catch(showError);
  else if (action === "list") {
    $("#crawl-mode").value = "list";
    openSettings();
    $("#settings-form").elements.namedItem("urls").closest("details").open = true;
    $("#settings-form").elements.namedItem("urls").focus();
  } else if (action === "integration") openIntegrations();
  else if (action === "graph" || action === "schedule") window.SpiderExtras[action]({job:state.job,config:state.config,api}).catch(showError);
  else if (action === "export") exportResults();
  else if (action === "sitemap") exportResults("sitemap");
  else if (action === "issues") openIssueWorkspace();
  else if (action === "issue-back") window.SpiderIssues.close();
  else if (action === "capabilities") { renderCapabilities(); showDialog("#capabilities-dialog"); }
  else if (action === "about") showDialog("#about-dialog");
}
function bindEvents() {
  document.addEventListener('visibilitychange',()=>{
    clearTimeout(state.timer);
    if(!document.hidden&&state.job)refreshJob().catch(showError);
  });
  $("#crawl-form").addEventListener("submit", startCrawl);
  $("#pause").addEventListener("click", () => jobAction("pause").catch(showError));
  $("#stop").addEventListener("click", () => jobAction("stop").catch(showError));
  $("#export").addEventListener("click", () => exportResults());
  $("#dismiss-error").addEventListener("click", () => { $("#error-banner").hidden = true; });
  for (const button of $$("[data-action]")) button.addEventListener("click", () => handleAction(button.dataset.action));
  for (const button of $$(".close-dialog")) button.addEventListener("click", () => button.closest("dialog").close());
  for (const dialog of $$("dialog")) dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  for (const menu of $$(".menu")) menu.addEventListener("toggle", () => {
    if (menu.open) for (const other of $$(".menu")) if (other !== menu) other.open = false;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu")) $$(".menu[open]").forEach((menu) => menu.removeAttribute("open"));
  });
  $("#row-filter").addEventListener("change", () => { state.filter = $("#row-filter").value; state.page = 1; loadRows().catch(showError); });
  let searchTimer;
  $("#row-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = $("#row-search").value; state.page = 1; loadRows().catch(showError); }, 250);
  });
  $("#page-size").addEventListener("change", () => { state.pageSize = Number($("#page-size").value); state.page = 1; loadRows().catch(showError); });
  $("#previous-page").addEventListener("click", () => { if (state.page > 1) { state.page--; loadRows().catch(showError); } });
  $("#next-page").addEventListener("click", () => { if (state.page < state.pages) { state.page++; loadRows().catch(showError); } });
  for (const button of $$("[data-side]")) button.addEventListener("click", () => {
    state.side = button.dataset.side;
    updateTabSelection($(".side-tabs"), button.id);
    renderOverview();
  });
  $("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      state.config = readSettings();
      $("#crawl-mode").value = state.config.mode;
      $("#settings-dialog").close();
      $("#footer-status").textContent = "Configuração salva para o próximo rastreamento";
    } catch (error) { $("#settings-error").textContent = error.message; $("#settings-error").hidden = false; }
  });
  $("#crawl-mode").addEventListener("change", () => { state.config.mode = $("#crawl-mode").value; });
  $("#compare-form").addEventListener("submit", compareJobs);
  $("#integration-form").addEventListener("submit", runIntegration);
  $('#integration-provider').addEventListener('change',()=>{$('#integration-form').elements.apiKey.value='';updateIntegrationFields();});
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#crawl-url").focus(); $("#crawl-url").select(); }
    if ((event.ctrlKey || event.metaKey) && event.key === ",") { event.preventDefault(); openSettings(); }
    if (event.key === "Escape") $$(".menu[open]").forEach((menu) => menu.removeAttribute("open"));
  });
}
async function initialize() {
  $('#export-format').prepend(element('option',{value:'html'},'Relatório de auditoria (HTML)'));
  $('#export-format').value='html';
  renderTabs();
  renderHead();
  renderRows();
  updateJobDisplay();
  renderOverview();
  bindEvents();
  const [capabilityResult, jobsResult] = await Promise.allSettled([api("/api/capabilities"), loadJobs()]);
  if (capabilityResult.status === "fulfilled") {
    state.capabilities = capabilityResult.value;
    renderCapabilities();
    if(state.capabilities.storage?.mode==='session'){
      for(const badge of document.querySelectorAll('.local-badge'))badge.textContent='Sessão temporária';
      for(const note of document.querySelectorAll('.welcome-note'))note.textContent='Sem teto comercial de URLs. Exporte seus resultados antes de encerrar.';
      updateJobDisplay();
    }
    $("#engine-status").textContent = "Motor local conectado";
    $("#footer-status").textContent = "Pronto para rastrear";
  } else {
    showError(capabilityResult.reason);
    $("#engine-status").textContent = "Motor local indisponível";
    $("#footer-status").textContent = "Falha de conexão";
  }
  let emptyView = false;
  try { emptyView = sessionStorage.getItem("spiderLocal.emptyView") === "1"; } catch {}
  if (jobsResult.status === "fulfilled" && jobsResult.value.length && !emptyView) await selectJob(jobsResult.value[0]).catch(showError);
  else if (jobsResult.status === "rejected") showError(jobsResult.reason);
}
initialize().catch(showError);

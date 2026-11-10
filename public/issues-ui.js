/* Guided, evidence-first issue workflow for the local crawler. */
"use strict";

window.SpiderIssues = (() => {
  const $ = (selector) => document.querySelector(selector);
  const make = (tag, className = "", value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  };
  const number = (value) => new Intl.NumberFormat("pt-BR").format(Number(value) || 0);
  const severity = { error: ["Erro", 0], high: ["Alta", 0], warning: ["Atenção", 1], medium: ["Média", 1], info: ["Revisar", 2], low: ["Baixa", 2] };
  const categories = { links: "Links", response: "Respostas HTTP", titles: "Títulos", descriptions: "Descrições", content: "Conteúdo", canonicals: "Canonicals", hreflang: "Idiomas", sitemaps: "Sitemaps", directives: "Diretivas", images: "Imagens", security: "Segurança", accessibility: "Acessibilidade", javascript: "JavaScript", amp: "AMP", spelling: "Ortografia", mobile: "Mobile" };
  const fallback = { why: "O rastreamento registrou esta ocorrência. A mensagem e as URLs abaixo mostram o que foi observado; a causa ainda precisa ser confirmada no código do site.", fix: "Identifique no projeto a origem do comportamento registrado, corrija a causa e preserve os fluxos que já funcionam. Se a regra for intencional, documente a decisão antes de alterá-la.", verify: "Repita o rastreamento e confira as páginas afetadas após publicar a correção." };
  const ui = { active: false, bound: false, code: null, page: 1, rows: [], total: 0, selectedId: null, request: 0, signature: "", context: null };

  function currentIssue() {
    return (ui.context?.overview?.issues || []).find((item) => item.code === ui.code);
  }

  function guide(issue) {
    return window.SpiderIssueGuidance?.[issue.code] || { ...fallback, title: issue.message || issue.code };
  }

  function issueOrder(a, b) {
    return (severity[a.severity]?.[1] ?? 2) - (severity[b.severity]?.[1] ?? 2) || Number(b.count) - Number(a.count) || String(a.code).localeCompare(String(b.code));
  }

  function issues() {
    return [...(ui.context?.overview?.issues || [])].sort(issueOrder);
  }

  function renderList() {
    const all = issues();
    const query = $("#issue-search").value.trim().toLocaleLowerCase("pt-BR");
    const visible = all.filter((item) => [item.code, item.message, item.category, guide(item).title].some((part) => String(part || "").toLocaleLowerCase("pt-BR").includes(query)));
    $("#issue-summary-count").textContent = `${number(all.length)} tipos · ${number(all.reduce((sum, item) => sum + Number(item.count || 0), 0))} ocorrências`;
    $("#issue-list-count").textContent = `${number(visible.length)} de ${number(all.length)} problemas`;
    const chooser = $("#issue-select");
    chooser.replaceChildren();
    if (!all.length) chooser.append(new Option("Nenhum problema registrado", ""));
    else for (const item of all) chooser.append(new Option(`${guide(item).title} · ${number(item.count)} URLs`, item.code));
    chooser.value = ui.code || all[0]?.code || "";
    const root = $("#issue-list");
    root.replaceChildren();
    if (!visible.length) {
      root.append(make("p", "issue-list-empty", all.length ? "Nenhum problema corresponde à pesquisa." : "Nenhum problema registrado neste rastreamento."));
      return;
    }
    for (const item of visible) {
      const button = make("button", "issue-list-item");
      button.type = "button";
      button.dataset.issueCode = item.code;
      button.setAttribute("aria-current", item.code === ui.code ? "true" : "false");
      const top = make("span", "issue-list-top");
      const badge = make("span", `issue-severity ${item.severity || "info"}`, severity[item.severity]?.[0] || "Revisar");
      top.append(badge, make("span", "issue-list-total", `${number(item.count)} ${Number(item.count) === 1 ? "URL" : "URLs"}`));
      button.append(top, make("strong", "", guide(item).title), make("small", "", categories[item.category] || item.category || item.code));
      root.append(button);
    }
  }

  function factRows(row, issue) {
    if (!row) return [];
    const code = issue.code || "";
    const facts = [["URL analisada", row.url]];
    if (row.statusCode !== null && row.statusCode !== undefined) facts.push(["Resposta HTTP", row.statusCode || "Sem resposta"]);
    if (row.finalUrl && row.finalUrl !== row.url) facts.push(["URL final", row.finalUrl]);
    if (code.startsWith("TITLE_") || code === "duplicate-title") facts.push(["Título encontrado", row.title || "Ausente"], ["Caracteres", row.titleLength ?? (row.title || "").length]);
    if (code.startsWith("DESCRIPTION_") || code === "duplicate-description") facts.push(["Meta description", row.description || "Ausente"], ["Caracteres", row.descriptionLength ?? (row.description || "").length]);
    if (code.startsWith("H1_")) facts.push(["H1 encontrados", Array.isArray(row.h1) && row.h1.length ? row.h1.join(" · ") : "Nenhum H1 preenchido"]);
    if (code.startsWith("H2_")) facts.push(["H2 encontrados", Array.isArray(row.h2) && row.h2.length ? row.h2.join(" · ") : "Nenhum H2 preenchido"]);
    if (code.startsWith("CANONICAL_") || code === "canonical-broken") facts.push(["Canonical resolvida", row.canonical || "Ausente ou inválida"]);
    if (["NOINDEX", "PAGE_NOFOLLOW"].includes(code)) facts.push(["Diretiva robots", row.metaRobots || row.xRobotsTag || "Não disponível"]);
    if (code.startsWith("IMAGE_")) facts.push(["Imagens na página", Array.isArray(row.images) ? row.images.length : "Não disponível"]);
    if (code.startsWith("HREFLANG_")) facts.push(["Alternativas hreflang", Array.isArray(row.hreflang) ? row.hreflang.map((item) => `${item.lang}: ${item.url}`).join(" · ") || "Nenhuma válida" : "Não disponível"]);
    if (code === "LANG_MISSING") facts.push(["Idioma no HTML", row.lang || "Ausente"]);
    if (["HSTS_MISSING", "CSP_MISSING", "NOSNIFF_MISSING"].includes(code)) {
      const name = { HSTS_MISSING: "strict-transport-security", CSP_MISSING: "content-security-policy", NOSNIFF_MISSING: "x-content-type-options" }[code];
      facts.push([`Cabeçalho ${name}`, row.headers?.[name] || "Ausente"]);
    }
    const records = (row.issues || []).filter((item) => item.code === code).map((item) => item.message).filter(Boolean);
    if (records.length) facts.push(["Registro técnico", [...new Set(records)].join(" · ")]);
    return facts;
  }

  function promptText(issue, row) {
    const item = guide(issue);
    const sample = ui.rows.slice(0, 10).map((entry) => {
      const findings = (entry.issues || []).filter((value) => value.code === issue.code).map((value) => value.message).filter(Boolean);
      return `- ${entry.url} | HTTP ${entry.statusCode ?? "desconhecido"}${findings.length ? ` | ${[...new Set(findings)].join("; ")}` : ""}`;
    }).join("\n");
    const evidence = factRows(row, issue).map(([key, value]) => `- ${key}: ${value}`).join("\n");
    return `Analise e corrija no código deste site o problema abaixo, usando as evidências do rastreamento. Não suponha que a causa já esteja provada; encontre a origem no projeto antes de editar.\n\nSite analisado: ${ui.context.job.config?.url || "não informado"}\nProblema: ${item.title}\nCódigo: ${issue.code}\nCategoria: ${issue.category || "não informada"}\nPrioridade registrada: ${severity[issue.severity]?.[0] || issue.severity || "não informada"}\nURLs afetadas: ${issue.count}\nDescrição observada: ${issue.message || "sem descrição adicional"}\n\nEvidência da URL selecionada:\n${evidence || "Nenhuma URL de exemplo disponível."}\n\nAmostra de URLs afetadas (página ${ui.page}, até 10 das ${ui.rows.length} carregadas):\n${sample || "Nenhuma URL carregada."}\n\nPor que revisar: ${item.why}\nDireção de correção: ${item.fix}\nComo verificar: ${item.verify}\n\nLocalize o template, rota, componente ou configuração responsável. Faça a menor correção que resolva a causa, verifique as URLs afetadas e descreva o que mudou e como testou. Se a correção depender de decisão editorial ou de infraestrutura sem acesso ao ambiente, explique o que falta em vez de inventar valores. Não altere outras páginas sem evidência.`;
  }

  function renderPanel() {
    const root = $("#issue-detail");
    const issue = currentIssue();
    root.replaceChildren();
    if (!issue) {
      root.append(make("p", "issue-detail-empty", issues().length ? "Escolha um problema na lista para ver evidências e correções." : "Nenhum problema registrado. Você pode conferir as URLs na análise."));
      return;
    }
    const item = guide(issue);
    const selected = ui.rows.find((row) => row.id === ui.selectedId) || ui.rows[0];
    const header = make("header", "issue-detail-header");
    const badges = make("div", "issue-badges");
    badges.append(make("span", `issue-severity ${issue.severity || "info"}`, severity[issue.severity]?.[0] || "Revisar"), make("span", "issue-category", categories[issue.category] || issue.category || "Auditoria"));
    const title = make("h3", "", item.title); title.id = "issue-heading";
    header.append(badges, title, make("p", "issue-impact", `${number(issue.count)} ${Number(issue.count) === 1 ? "URL afetada" : "URLs afetadas"} · ${issue.code}`));
    const actions = make("div", "issue-detail-actions");
    const copyTop = make("button", "button primary issue-copy", "Copiar para IA"); copyTop.type = "button"; copyTop.dataset.issueCopy = "";
    const jump = make("button", "button", "Ver URLs afetadas ↓"); jump.type = "button"; jump.dataset.issueJump = "";
    const copyStatus = make("span", "issue-copy-status"); copyStatus.setAttribute("role", "status"); copyStatus.setAttribute("aria-live", "polite");
    actions.append(copyTop, jump, copyStatus); header.append(actions);
    root.append(header);
    const explain = make("div", "issue-explanation");
    const why = make("section", "issue-explain-card");
    why.append(make("h4", "", "O que isso significa"), make("p", "", item.why));
    const fix = make("section", "issue-explain-card issue-fix-card");
    fix.append(make("h4", "", "O que corrigir"), make("p", "", item.fix));
    const verify = make("section", "issue-explain-card");
    verify.append(make("h4", "", "Como confirmar"), make("p", "", item.verify));
    explain.append(why, fix, verify);
    root.append(explain);

    const affected = make("section", "issue-affected");
    const affectedHead = make("div", "issue-section-head");
    affectedHead.append(make("h4", "", "Páginas afetadas"), make("span", "", `${number(ui.total)} URLs`));
    affected.append(affectedHead);
    const list = make("div", "issue-urls");
    if (!ui.rows.length) list.append(make("p", "issue-list-empty", "Aguardando páginas deste problema…"));
    for (const row of ui.rows) {
      const button = make("button", "issue-url-item");
      button.type = "button";
      button.dataset.issueRow = String(row.id);
      button.setAttribute("aria-current", row.id === selected?.id ? "true" : "false");
      button.append(make("span", "issue-url-address", row.url), make("span", "issue-url-status", row.statusCode ? `HTTP ${row.statusCode}` : "Sem resposta"));
      list.append(button);
    }
    affected.append(list);
    if (ui.total > 25) {
      const paging = make("div", "issue-pagination");
      const previous = make("button", "button", "← Anterior"); previous.type = "button"; previous.dataset.issuePage = "previous"; previous.disabled = ui.page <= 1;
      const next = make("button", "button", "Próxima →"); next.type = "button"; next.dataset.issuePage = "next"; next.disabled = ui.page >= Math.ceil(ui.total / 25);
      paging.append(previous, make("span", "", `${ui.page} / ${Math.ceil(ui.total / 25)}`), next);
      affected.append(paging);
    }
    root.append(affected);

    const evidence = make("section", "issue-evidence");
    evidence.append(make("h4", "", "Detalhes técnicos da URL selecionada"));
    const description = (selected?.issues || []).filter((value) => value.code === issue.code).map((value) => value.message).filter(Boolean).join(" · ") || issue.message;
    if (description) evidence.append(make("p", "issue-raw-message", description));
    const facts = make("dl", "issue-facts");
    for (const [name, value] of factRows(selected, issue)) {
      facts.append(make("dt", "", name), make("dd", "", value));
    }
    evidence.append(facts);
    root.append(evidence);

    const handoff = make("section", "issue-handoff");
    handoff.append(make("h4", "", "Levar para seu agente de IA"), make("p", "", "O pedido inclui o problema, a URL selecionada, exemplos afetados e passos de verificação. Revise antes de enviar."));
    const preview = make("details", "issue-prompt-preview");
    preview.append(make("summary", "", "Ver texto que será copiado"));
    const textarea = make("textarea"); textarea.readOnly = true; textarea.value = promptText(issue, selected); textarea.setAttribute("aria-label", "Pedido de correção para copiar");
    preview.append(textarea); handoff.append(preview);
    root.append(handoff);
  }

  async function loadRows() {
    const issue = currentIssue();
    if (!issue || !ui.context?.job) { ui.rows = []; ui.total = 0; renderPanel(); return; }
    const request = ++ui.request;
    const jobId = ui.context.job.id;
    const params = new URLSearchParams({ tab: "issues", filter: issue.code, page: String(ui.page), pageSize: "25", sort: "url" });
    try {
      const result = await ui.context.api(`/api/jobs/${encodeURIComponent(jobId)}/rows?${params}`);
      if (!ui.active || request !== ui.request || jobId !== ui.context?.job?.id || issue.code !== ui.code) return;
      ui.rows = result.rows || [];
      ui.total = Number(result.total) || 0;
      if (!ui.rows.some((row) => row.id === ui.selectedId)) ui.selectedId = ui.rows[0]?.id ?? null;
      renderPanel();
    } catch (error) {
      if (request !== ui.request) return;
      $("#issue-detail").replaceChildren(make("p", "issue-detail-empty", `Não foi possível carregar as páginas afetadas: ${error.message}`));
    }
  }

  function select(code) {
    if (!issues().some((issue) => issue.code === code)) return;
    const restoreFocus = document.activeElement?.dataset.issueCode === code;
    ui.code = code;
    ui.page = 1;
    ui.rows = [];
    ui.total = 0;
    ui.selectedId = null;
    renderList();
    if (restoreFocus) [...$("#issue-list").querySelectorAll("[data-issue-code]")].find((button) => button.dataset.issueCode === code)?.focus();
    renderPanel();
    loadRows();
  }

  function bind() {
    if (ui.bound) return;
    ui.bound = true;
    $("#issue-search").addEventListener("input", renderList);
    $("#issue-select").addEventListener("change", () => select($("#issue-select").value));
    $("#issue-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-issue-code]");
      if (button) select(button.dataset.issueCode);
    });
    $("#issue-detail").addEventListener("click", async (event) => {
      const rowButton = event.target.closest("[data-issue-row]");
      if (rowButton) { ui.selectedId = Number(rowButton.dataset.issueRow); renderPanel(); return; }
      if (event.target.closest("[data-issue-jump]")) { $("#issue-detail .issue-affected")?.scrollIntoView({ block: "start" }); return; }
      const pageButton = event.target.closest("[data-issue-page]");
      if (pageButton) { ui.page += pageButton.dataset.issuePage === "next" ? 1 : -1; ui.selectedId = null; await loadRows(); return; }
      if (!event.target.closest("[data-issue-copy]")) return;
      const textarea = $("#issue-detail textarea");
      const status = $("#issue-detail .issue-copy-status");
      if (!textarea || !status) return;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Área de transferência indisponível");
        await navigator.clipboard.writeText(textarea.value);
        status.textContent = "Copiado. Cole no agente que tem acesso ao projeto do site.";
      } catch {
        textarea.closest("details").open = true;
        textarea.focus(); textarea.select();
        status.textContent = document.execCommand("copy") ? "Copiado. Cole no agente que tem acesso ao projeto do site." : "Texto selecionado. Use Ctrl+C para copiar.";
      }
    });
  }

  function open(context, code) {
    bind();
    ui.context = context;
    ui.active = true;
    ui.signature = issues().map((item) => `${item.code}:${item.count}`).join("|");
    document.body.classList.add("app-issues-view");
    $(".workspace").classList.add("issues-view");
    $(".results-pane").classList.add("issues-view");
    $("#issue-workspace").hidden = false;
    $("#issues-open").hidden = true;
    $("#issues-close").hidden = false;
    $("#graph-open").hidden = true;
    $("#analysis-eyebrow").textContent = "ENTENDA E RESOLVA";
    $("#analysis-title").textContent = "Problemas e correções";
    renderList();
    const chosen = issues().some((issue) => issue.code === code) ? code : issues()[0]?.code;
    if (chosen) select(chosen);
    else renderPanel();
    $("#issue-workspace").scrollTop = 0;
  }

  function close() {
    if (!ui.active) return;
    ui.active = false;
    ui.request++;
    $("#issue-workspace").hidden = true;
    $("#issues-open").hidden = false;
    $("#issues-close").hidden = true;
    $("#graph-open").hidden = false;
    $(".workspace").classList.remove("issues-view");
    $(".results-pane").classList.remove("issues-view");
    document.body.classList.remove("app-issues-view");
    $("#analysis-eyebrow").textContent = "EXPLORAR RESULTADOS";
    ui.context?.onReturn?.();
  }

  function refresh(job, overview) {
    if (!ui.active || ui.context?.job?.id !== job?.id) return;
    ui.context.job = job;
    ui.context.overview = overview;
    const signature = issues().map((item) => `${item.code}:${item.count}`).join("|");
    if (signature === ui.signature) return;
    ui.signature = signature;
    renderList();
    if (!currentIssue()) select(issues()[0]?.code);
    else loadRows();
  }

  return { open, close, refresh, select, isOpen: () => ui.active };
})();

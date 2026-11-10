# CSW Sites Crawler

**Versão 0.2.0: consulte [QUICKSTART.md](QUICKSTART.md) para uso e distribuição atuais.**
O início padrão agora usa uma sessão temporária: exporte antes de encerrar o
servidor. Histórico permanente é opcional via `SPIDER_DATA_DIR`. Os arquivos
antigos em `data/` são preservados. O relatório HTML compartilha diagnóstico,
cobertura, evidências e correções. Pacotes são gerados com `npm run release`
e `npm run release -- --portable` (Linux x64). As seções históricas abaixo
descrevem decisões e validações anteriores à mudança de armazenamento.

Aplicativo independente para rastreamento e auditoria SEO, desenvolvido neste workspace após investigar o REA e inventariar a instalação local do Screaming Frog 24.3. **Versão inicial: não estabelece equivalência exata com o Screaming Frog, nem é uma edição licenciada desse produto.** Não usa chave, logotipo, código decompilado ou mecanismo de ativação do fabricante.

## Estado de desenvolvimento

A interface utiliza a identidade amarela da CSW Sites, com logo, ícones e fontes locais. Veja [docs/brand-source.md](docs/brand-source.md) para a origem dos assets e a validação do novo fluxo de navegação.

Snapshot salvo em 22/10/2026 para continuidade no próximo dia. Veja [HANDOFF.md](HANDOFF.md) para a validação executada e [docs/features.json](docs/features.json) para o escopo Pro solicitado. A paridade integral com o Screaming Frog Pro ainda não foi atingida.

## Abrir

No Linux, execute `./start-spider.sh` nesta pasta, ou `bash start-spider.sh`.
Nesta máquina, Node.js 24.18.0 está instalado em `~/.local/opt/`, com os comandos
`node`, `npm` e `npx` em `~/.local/bin/`. Para um terminal que já estava aberto,
use `export PATH="$HOME/.local/bin:$PATH"`.

```bash
cd '/home/mateus/Projects/Apps & Systems/MEO-Scanner/REA/spider-clone'
./start-spider.sh
```

No Windows, execute `Start-Spider.cmd` nesta pasta. Alternativamente:

```powershell
cd C:\Users\mateus\Documents\ChatGPT\REA\spider-clone
npm.cmd ci
npm.cmd start
```

Acesse <http://127.0.0.1:4318>. Requer Node.js 24.15+ ou 26+. A aplicação procura Chromium do Playwright, Edge e Chrome. Se nenhum estiver instalado, execute `npx.cmd playwright install chromium` para habilitar renderização e axe. Não existe teto comercial de URLs; limites opcionais são definidos por você. Disco, memória, tempo e limites dos sites continuam determinando a capacidade real.

### Acesso por outras máquinas da rede

Por padrão, o servidor escuta somente nesta máquina. Para compartilhar temporariamente na rede local, execute `Start-Spider-LAN.cmd` nesta pasta ou use o PowerShell. Este computador apresentou o IPv4 Ethernet 192.168.0.186 em 23/10/2026. Confirme o IP com `ipconfig` e ajuste-o no comando ou no arquivo `.cmd` caso mude:

```powershell
cd C:\Users\mateus\Documents\ChatGPT\REA\spider-clone
$env:SPIDER_HOST = '192.168.0.186'
$env:SPIDER_PORT = '4318'
npm.cmd start
```

Nas outras máquinas, abra `http://192.168.0.186:4318` — use o IPv4 atual do computador que executa o servidor. `192.168.0.100` é outro equipamento; para usar esse endereço seria preciso configurar nele um encaminhamento para o crawler. Se o Windows Firewall perguntar, permita o Node.js somente em **Rede privada**. O processo precisa continuar aberto e o roteador deve permitir a comunicação entre os dispositivos. Essa exposição não tem autenticação de usuários: qualquer pessoa com acesso à rede que alcançar a porta poderá usar o crawler e consultar as sessões salvas; use-a apenas em uma rede confiável e encerre o servidor quando terminar.

## Funcionalidades disponíveis

- Modo Spider e listas de URLs; fila SQLite, concorrência e intervalos configuráveis, profundidade, includes/excludes, subdomínios, user-agent, robots personalizado e Crawl-delay.
- Status HTTP, erros, redirects/loops, títulos, descrições, H1/H2, canonicals HTML/HTTP, diretivas, hreflang, paginação, referências AMP e JSON-LD.
- Grafo de inlinks/outlinks, âncoras, nofollow, imagens e alt. Status de imagens e externos só são consultados se configurados; os demais permanecem explicitamente não verificados.
- Conteúdo, contagem de palavras, duplicatas exatas e análise aproximada opcional.
- Renderização real em Chromium/Edge/Chrome, HTML original e renderizado, screenshot de viewport, recursos e erros JS, JavaScript personalizado e axe-core.
- Extração CSS/XPath/regex, pesquisa personalizada, filtros, ordenação, paginação e detalhes por URL.
- Sessões salvas automaticamente, pausa, retomada após reiniciar, comparação entre duas sessões e exports CSV, XLSX, JSON e sitemap XML do filtro ativo.
- Conectores de PageSpeed, GA4, Search Console, OpenAI, Gemini, Anthropic e Ollama. Foram exercitados com respostas simuladas; nenhuma conta externa real foi usada na validação.
- CLI e API local de agendamento. Não há bloqueio de licença para recursos implementados.

## Diagnóstico de conexão

Falhas de consulta a robots.txt são registradas como falhas de acesso, sem inventar uma regra Disallow. Se nenhuma página HTML puder ser obtida por erro de rede, a sessão aparece como Falhou, com o motivo nos resultados. EACCES/EPERM indicam acesso à rede negado pelo ambiente que iniciou o servidor; execute Start-Spider.cmd em sua sessão normal do Windows. Bloqueios declarados pelo robots.txt continuam sendo respeitados.

## Limitações e trabalho pendente

A lista atual também está em **Ajuda → Recursos** na interface, alimentada por `/api/capabilities`.

- A aparência é uma interface própria com a organização de um crawler desktop. Correspondência de pixels, colunas, filtros, relatórios e algoritmos com o original ainda não foi validada.
- Durante o crawl, pesquisas e extrações regex examinam o HTML completo em worker isolado, com prazo de 2 segundos e heap de 128 MiB. Aceitam sintaxe restrita e retêm até 100 resultados de 16.384 caracteres por regra, com aviso explícito de truncamento dos resultados ou execução incompleta. O helper síncrono `analyzePage` mantém sua cobertura limitada para chamadas diretas; o motor usa `analyzeFetchedPage`. Extração XPath usa parsing XML compatível com as limitações do DOM fornecido.
- Respostas acima de `maxBodyBytes` preservam status HTTP e cabeçalhos, com `bodyComplete: false`. HTML incompleto não produz conclusões de metadados ou descoberta de links. Robots e sitemaps incompletos não são usados como documentos integrais.
- Duplicatas aproximadas usam Jaccard de shingles, com cobertura de até 1.000 documentos não vazios e 10.000 palavras/documento. O limite é informado na sessão; é uma proteção de custo computacional e o algoritmo difere do original.
- JSON-LD tem validação sintática, sem validação completa de rich results, Microdata ou RDFa. AMP usa amphtml-validator quando a opção de validação está ativada; o primeiro uso baixa o motor oficial do AMP Project.
- Foram adicionados gráficos D3, Link Score próprio, segmentação por regex de URL, login por formulário, Lighthouse Mobile e validador AMP oficial. O conector de ortografia/gramática requer LanguageTool local ou um endpoint configurado. Ainda faltam semântica/embeddings, conectores Majestic/Ahrefs/Moz, modo SERP, MCP, Looker Studio completo e o catálogo integral de relatórios do produto de referência.
- Autenticação disponível: Basic, cookies, cabeçalhos e formulário no mesmo domínio, com seletores configuráveis. Digest, proxy e OAuth assistido ainda não estão implementados. GA4/GSC recebem um access token obtido por você; não há renovação automática.
- A análise de indexabilidade é uma avaliação local das diretivas e respostas recebidas, não uma confirmação de indexação no Google. Não foram implementadas todas as regras de acessibilidade, SEO e internacionalização do produto de referência.
- IA envia metadados e até 20.000 caracteres do texto de cada página apenas quando você executa a integração. Modelo e conta são seus; créditos, permissões e cotas pertencem ao provedor. O padrão é 10 páginas por operação, com campo para mudar ou usar 0 para todas.
- Sessões preservam resultados no disco, incluindo fontes HTML e dados retornados pelos conectores. Credenciais de execução não são gravadas. Para retomar uma sessão autenticada após reiniciar, crie uma nova execução com as credenciais necessárias.
- O servidor deve permanecer aberto para agendamentos. Apenas um processo abre cada banco; CLI e servidor simultâneos devem usar diretórios de dados separados. Duas sessões podem rastrear simultaneamente em cada processo.

## CLI

```powershell
npm.cmd run crawl -- https://example.com --output resultado.csv
npm.cmd run crawl -- https://example.com --render --output resultado.xlsx --format xlsx --data data-cli
npm.cmd run crawl -- https://example.com --config config.json --max-urls 0
```

`--config` aceita as mesmas opções da interface. Resultados e sessão são salvos no diretório de dados. Use Ctrl+C para encerrar. Evite colocar credenciais em arquivos versionados.

## Agendamento local pela API

Exemplo para repetir a cada 1.440 minutos enquanto o servidor estiver ligado:

```powershell
$schedule = @{ intervalMinutes = 1440; config = @{ url = 'https://example.com'; name = 'Auditoria diária' } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://127.0.0.1:4318/api/schedules -Method Post -ContentType application/json -Body $schedule
Invoke-RestMethod -Uri http://127.0.0.1:4318/api/schedules
```

Não envia e-mails nem notificações externas. Os crawls ficam disponíveis no histórico. Credenciais não são mantidas nos agendamentos.

## Validação realizada

`npm.cmd test` executa os testes de análise, crawling e API local. A suíte cobre: mais de 500 páginas, robots/sitemaps, links e redirects, pausa/retomada, persistência, proteção entre origens, credenciais não persistidas, comparação e leitura real de XLSX, além de renderização, screenshot, axe e JavaScript personalizados com Edge. Navegação manual na interface foi feita sobre um servidor de testes local, sem crawlear sites de terceiros.

O site de teste pode ser iniciado com `node test/demo-site.mjs`, em <http://127.0.0.1:4319>.

## Evidência e referência

- REA clonado na pasta pai: commit `bea6b98e8`, pacote CLI oficial `rea-agents@6.7.0` em `.tools/rea`.
- Operação real: `inspect-artifact` sobre `C:\Program Files (x86)\Screaming Frog SEO Spider\ScreamingFrogSEOSpider.jar`.
- Evidência: `../.cache/screaming-frog/jar.evidence.json`, ID `ev_da370d6a1aa2f275213e989b3a87a5c931871e7618887935c2b50836af0e742a`, SHA-256 `5b6fb252e194c9702e6ba8f6bf589e9870175e1478bcd6148a3f8068d4e18d76`.
- O REA fez inventário estático de um ZIP/JAR, não decompilação de classes Java nem observação integral de comportamento. A CLI publicada não ofereceu a operação `inspect-desktop-application` descrita no main. Capturas da janela original falharam. Nenhuma dessas etapas estabelece paridade.
- Referências públicas oficiais: [abas](https://www.screamingfrog.co.uk/seo-spider/user-guide/tabs/), [configurações](https://www.screamingfrog.co.uk/seo-spider/user-guide/configuration/), [recursos](https://www.screamingfrog.co.uk/seo-spider/pricing/).

Os arquivos deste diretório são um projeto separado e não alteram a implementação do REA nem a instalação original do Screaming Frog.

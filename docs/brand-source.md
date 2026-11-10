# Identidade CSW Sites

Aplicação solicitada pelo usuário em 23/10/2026, usando a vertente **amarela de Sites**, distinta das identidades de Marketing e IA.

Fonte de referência, acessada somente para leitura:

```text
\\servercsw\Completa _\Site\CSWsites\public\assets
```

Referências observadas: `css/default.css` define amarelo `#ffd900`, grafite `#19191c` e a família Spline Sans. O SVG `icons/logotipo-horizontal-yellow.svg` utiliza `#ffd800`, adotado como cor principal do aplicativo. `css/custom.css` registra Anek Telugu Expanded. O CSS de Marketing possui azul `#3d6dff`, que não foi adotado como cor de marca deste crawler.

Arquivos copiados para `public/brand/`:

- Logo original amarelo, salvo como `csw-sites.svg`.
- `list.svg` e os ícones originais 01, 02, 03, 04, 05, 06, 07, 08, 09, 11, 14, 15 e 16, salvos como `icon-NN.svg`.
- Spline Sans Regular, Medium, SemiBold e Bold em WOFF2.
- Anek Telugu Expanded Bold em WOFF, usado no título de apresentação.

Os SVGs e fontes foram preservados. A aplicação usa cópias locais e não depende do compartilhamento de rede para carregar sua identidade. Nenhum arquivo do site original foi modificado. Estes arquivos foram fornecidos/indicados pelo usuário como identidade de sua marca; este registro documenta a origem, sem estabelecer novas condições de licença para terceiros.

## Direção de interface

- Barra lateral grafite, marca amarela e navegação em cinco grupos nativos expansíveis.
- Campo de URL e ação de análise em destaque; histórico, configurações e ferramentas com acesso explícito.
- Tela inicial com orientação e ícones originais; estado de resultados com indicadores, tabela, resumo e detalhes.
- Ações e estados de erro preservados, botão Limpar sem excluir o histórico, configurações avançadas mantidas.
- Spline Sans nos controles e dados; Anek no título de apresentação; amarelo para seleção e ações principais.
- Layout responsivo, foco visível, navegação nativa por teclado e respeito a redução de movimento.

## Validação desta alteração

26 testes automatizados do crawler passaram, incluindo o novo teste de início direto por URL. O contrato HTTP dos assets foi exercitado com SVG, WOFF e WOFF2, incluindo MIME e bloqueio de caminhos fora da rota permitida. Smoke test de navegador exercitou resultados reais, navegação por conteúdo, limpeza, histórico e configurações; capturou telas desktop e em 390 px, sem overflow horizontal na tela inicial e sem erros de carregamento de imagens.

O fluxo principal é colar uma URL e clicar em Analisar site. Configurações são opcionais. Ao carregar uma análise concluída, o próximo início usa Site completo; listas antigas não são executadas implicitamente. O modo Lista explícito aceita uma URL diretamente ou uma lista importada, sem abrir configuração obrigatória.

Axe-core, com tags WCAG 2 A/AA e 2.1 AA, não encontrou violações automatizadas nos estados de resultados, início e diálogo de configurações após os ajustes de contraste e semântica. Isso não substitui avaliação manual integral de acessibilidade nem prova cobertura de todos os estados do aplicativo.

Artefatos locais de verificação estão em `output/playwright/`, fora do código versionável. Não foi publicado um site nem enviado código ao GitHub.

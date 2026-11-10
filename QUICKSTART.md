# CSW Sites Crawler 0.2.0

Auditoria técnica de sites no seu computador, com diagnóstico, evidências,
orientações de correção e relatório compartilhável. Não exige servidor de banco.

## Pacote portátil Linux x64

Extraia o ZIP em uma pasta e execute `start-spider.sh` (ou `bash start-spider.sh`).
Node e Chromium estão incluídos. O navegador padrão abre o aplicativo em
http://127.0.0.1:4318. Mantenha o terminal aberto e use Ctrl+C para encerrar.
Validado em Ubuntu 26.04 x64; outras distribuições podem precisar das bibliotecas
de sistema do Chromium. O pacote Windows portátil ainda não foi produzido.

## Pacote de código-fonte: Windows, Linux e macOS

Instale Node.js 24.15+ com npm. Na pasta extraída, execute:

```
npm ci
npm run setup
npm start
```

O setup verifica um navegador existente ou instala Chromium. No Windows,
`Start-Spider.cmd` também instala dependências faltantes e abre a interface.
Linux/macOS usam `bash start-spider.sh`. A execução Windows/macOS precisa de
validação nativa antes de distribuir como instalador para esses sistemas.

## Fazer a auditoria

1. Cole o endereço e clique em **Analisar site**. As opções padrão analisam
   HTML, títulos, descrições, headings, links, status, canonicals, diretivas,
   hreflang declarado, imagens e sintaxe de JSON-LD.
2. Para sites que dependem de JavaScript, ative renderização em Configurações.
   Acessibilidade, screenshots, AMP e Lighthouse são análises opcionais.
   Lighthouse por página pode tornar crawls grandes demorados.
3. Abra **Problemas e correções**. Consulte evidência e orientação; confirme a
   causa no site antes de alterar. É possível copiar o pedido para um agente de IA.
4. Em **Exportar**, escolha o relatório HTML para compartilhar ou imprimir em PDF
   pelo navegador. CSV, Excel e JSON oferecem os dados; sitemap usa páginas
   internas consideradas indexáveis. O relatório HTML descreve toda a análise;
   as exportações de dados respeitam os filtros selecionados.

## Sessão temporária

Por padrão, os dados ficam em uma pasta temporária privada durante a execução.
São removidos ao encerrar normalmente o servidor. Não existe histórico entre
execuções por padrão. Exporte antes de fechar. Fechar só a aba não encerra o
servidor. Interrupção abrupta/queda de energia pode deixar arquivos temporários
até a limpeza do sistema operacional.

Para manter histórico e retomar depois, defina `SPIDER_DATA_DIR` com uma pasta
local antes de iniciar. Isso é opcional. Dados antigos em `data/` não são apagados.

## Cobertura e serviços opcionais

O relatório diferencia análises ativadas, não executadas e incompletas. Respeitar
robots pode deixar URLs sem consulta. Indexabilidade local não confirma indexação
no Google. JSON-LD tem validação sintática, não validação completa de rich results.
Conteúdo semelhante usa Jaccard com cobertura declarada nos avisos (até 1.000
documentos e 10.000 palavras/documento). O produto não garante ausência de todos
os problemas de SEO nem equivalência integral com outras ferramentas.

Google/IA exigem contas e cotas do usuário. Ollama precisa de um modelo instalado.
LanguageTool requer um serviço configurado. Conectores externos não foram
certificados com contas reais nesta entrega. Moz, Majestic e Ahrefs ficam
desabilitados. Auditorias locais não exigem esses serviços.

Este pacote é de uso local, individual. Não publique esta API diretamente na
internet: não possui contas, isolamento entre clientes nem controle de acesso.

Os logotipos/fontes CSW têm proveniência em `docs/brand-source.md`; dependências,
Node e Chromium mantêm seus avisos de licença nos respectivos diretórios.

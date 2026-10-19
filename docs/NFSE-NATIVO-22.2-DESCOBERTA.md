# NFS-e nativa — etapa 22.2 — descoberta no Portal Nacional

O módulo de descoberta faz parte do backend do AutoNacional. Ele lê uma `Page` do Playwright que o fluxo atual já autenticou. Não abre Chromium, não cria contexto, não faz login, não baixa XML ou PDF, não consulta SEFIN ou ADN, não grava no banco e não emite SSE.

O NFSExplorer foi a referência histórica da POC. A descoberta de Cabeloterapia (setembro/2026, 379 documentos) e Ambientale (agosto/2026, 78 documentos, 76 vigentes e 2 canceladas) mostrou que a chave nacional de 50 dígitos está no `href` do download XML e que a listagem precisa ser percorrida por completo. Esse repositório não é dependência de runtime. Nenhum arquivo dele é importado e nenhum caminho absoluto da POC entra no código.

O worker de execução, a fila, o CAPTCHA, os oito navegadores, os certificados, as credenciais e o download atual permanecem como estão. `execution-service.ts`, `playwright-nfse.ts`, `login-credencial-nfse.ts`, `processar-notas-competencia.ts`, `download-operation.ts` e `download-manager.ts` não foram alterados e não importam este módulo.

## Arquivos

```text
Backend/src/automation/nfse/discovery/
  types.ts
  chave.ts
  row-parser.ts
  pagination.ts
  discovery-validation.ts
  discovery-runner.ts
  page-capture.ts
  discovery-service.ts
  index.ts
  discovery.test.ts
```

Os contratos de `Backend/src/automation/nfse/contracts/` continuam os da etapa 22.1. A descoberta os consome. Não houve mudança de regra fiscal.

| Arquivo | Papel |
|---|---|
| `discovery-service.ts` | Função pública `discoverNfse` |
| `page-capture.ts` | Adapta a `Page` autenticada à interface `PortalListagem` |
| `discovery-runner.ts` | Percorre as direções, o filtro e a paginação |
| `chave.ts` | Extrai e valida a chave de 50 dígitos |
| `row-parser.ts` | Lê linhas e evidências brutas de situação |
| `pagination.ts` | Impressão da página, totalizador e limite de segurança |
| `discovery-validation.ts` | Filtro confirmado, duplicidades e fechamento do inventário |
| `types.ts` | Resultado bruto, separado do inventário fiscal |

## Função pública

```ts
discoverNfse({
  page,
  cnpj,
  periodoConsulta,
  tipo,
  maxPaginas,
})
```

| Entrada | Regra |
|---|---|
| `page` | `Page` já autenticada. A função não a encerra. |
| `cnpj` | CNPJ completo. Passa por `normalizarCnpjEmpresa`. Valor com tamanho diferente de 14 dígitos vira `CNPJ_INVALIDO` e o portal não é consultado. |
| `periodoConsulta` | `PeriodoConsultaPortal` (`DD/MM/YYYY`). Período invertido ou em outro formato vira `PERIODO_INVALIDO` antes de qualquer navegação. |
| `tipo` | `EMITIDAS`, `RECEBIDAS` ou `AMBAS`. Outro valor vira `TIPO_CONSULTA_INVALIDO`. |
| `maxPaginas` | Opcional. Padrão `LIMITE_SEGURANCA_PAGINAS` (500). Atingir o limite é falha explícita. |

A navegação real fica em `criarPortalDaPage`. Os testes chamam `executarDescoberta` com um portal simulado e não carregam Playwright.

## Saída

`ResultadoDescobertaNfse` separa o que foi lido do que entrou no inventário fiscal.

- `status`: `DISCOVERY_COMPLETE`, `DISCOVERY_INCOMPLETE` ou `DISCOVERY_FAILED`.
- `registros`: uma linha por registro lido, com chave ou com o problema que impediu a chave, direção e evidência bruta.
- `inventario`: `InventarioNfse` da etapa 22.1. Só entram documentos com chave nacional válida.
- `diagnosticos`: falhas de navegação, filtro, paginação, totalizador e duplicidade.
- `paginasPercorridas`: páginas capturadas nas direções percorridas.

A completude do inventário segue o status da descoberta:

| Descoberta | `inventario.completude` |
|---|---|
| `DISCOVERY_COMPLETE` | `COMPLETO` |
| `DISCOVERY_INCOMPLETE` | `PARCIAL` |
| `DISCOVERY_FAILED` | `INDETERMINADO` |

Todo documento confirmado nesta etapa sai com `situacao: INDETERMINADA` e `origemClassificacao: NAO_CLASSIFICADA`. Nenhuma nota é marcada `VIGENTE`. Nota cancelada não é erro e não é removida da descoberta.

`DISCOVERY_COMPLETE` não libera recuperação nem exportação. `consolidarResultadoExecucao` ainda trata documento indeterminado como bloqueio. A classificação fica para a etapa seguinte.

## Navegação e datas

Para cada direção pedida, na ordem emitidas e depois recebidas:

1. Abre o menu já usado pelo AutoNacional: `li:nth-of-type(3) img` (emitidas) ou `li:nth-of-type(4) img` (recebidas), via `clicarMenuNotasEAguardar`.
2. A URL precisa conter `/EmissorNacional/Notas/Emitidas` ou `/EmissorNacional/Notas/Recebidas`.
3. Preenche `#datainicio` e `#datafim` com `preencherDatasEFiltrar`, em `DD/MM/YYYY`, e clica no botão de pesquisa já usado pelo AutoNacional.
4. Espera a URL da listagem registrar a pesquisa concluída: `executar=1`, `datainicio` e `datafim` iguais ao período consultado. Esse é o GET observado no Portal Nacional, por exemplo `?executar=1&busca=&datainicio=01%2F09%2F2026&datafim=30%2F09%2F2026`.
5. Com a URL confirmada, espera a tabela ter linhas ou a mensagem de lista vazia, e só então relê os campos.
6. A captura das linhas começa depois dessa confirmação.

A confirmação separa três fatos:

| Fato | Evidência |
|---|---|
| Campos preenchidos | `#datainicio` e `#datafim` iguais ao período |
| Pesquisa executada | URL com `executar=1` e as duas datas do período |
| Resultado assentado | Linhas na tabela, ou mensagem de lista vazia com zero linhas |

Linhas visíveis, sozinhas, não comprovam a pesquisa. Se os campos já estão corretos e a URL continua sem essa query, ou ainda traz as datas de uma consulta anterior, o resultado é `FILTRO_NAO_APLICADO` e a tabela não é capturada. Notas iguais às da listagem anterior são aceitas quando a URL confirma o período pedido. A competência do XML não entra nessa decisão.

Navegação que não chega na URL esperada, ou campos que não refletem o período, encerra a direção com `DISCOVERY_FAILED` (`NAV_FALHA` ou `FILTRO_NAO_APLICADO`) e não lê a tabela. Se a primeira direção falha, a segunda não começa. A sessão e a página recebida não são alteradas além do filtro da listagem.

## Chaves

A fonte principal é o `href` do link de download XML da própria linha, no formato `/EmissorNacional/Notas/Download/NFSe/<50 dígitos>`. O link não é clicado. Não há download e não há modal de CAPTCHA.

O fallback é `tr[data-chave]` somente quando o atributo contém uma sequência verificável de 50 dígitos. Token opaco, como os valores observados em produção, não é decodificado. Sem `href` válido, o registro fica com `DATA_CHAVE_NAO_VERIFICAVEL`.

| Leitura | Efeito |
|---|---|
| 50 dígitos no `href` | Chave aceita, fonte `HREF_DOWNLOAD_XML` |
| 50 dígitos em `data-chave`, sem `href` | Chave aceita, fonte `DATA_CHAVE` |
| 44 dígitos nesse caminho | `CHAVE_44_REJEITADA`. Não vira chave nacional |
| Outro tamanho ou conteúdo inválido no caminho de download | `CHAVE_INVALIDA` |
| `href` e `data-chave` com 50 dígitos diferentes | `CONFLITO_IDENTIFICADOR`. A chave não entra no inventário |

Não há chave sintética. Linha sem chave permanece em `registros` e impede `DISCOVERY_COMPLETE`.

## Paginação

Cada página gera uma impressão com a URL, o indicador de página e as chaves ou o texto das linhas. A próxima página usa os mesmos seletores do fluxo atual (`i.fa-angle-right` e equivalentes). O ancestral `li` com classe `disabled` encerra a lista.

O avanço só conta se o clique ocorre e a impressão da página seguinte é diferente. Impressão igual gera `PAGINACAO_NAO_AVANCOU`. Impressão já vista em página anterior gera `PAGINA_REPETIDA`. Os dois casos são `DISCOVERY_FAILED`.

Não há tamanho fixo de página. Quinze linhas foi o que a POC observou, não uma regra. Lista vazia só é completa quando o portal confirma a mensagem de nenhum registro e a tabela não tem linhas. Zero linhas sem essa mensagem é `LISTA_VAZIA_NAO_CONFIRMADA`.

Quando o DOM expõe um totalizador (`N registros` ou `de N registros`), ele é comparado com a quantidade de linhas lidas. Divergência é `TOTALIZADOR_DIVERGENTE` e `DISCOVERY_INCOMPLETE`. Não existe quantidade esperada de 379 ou 78.

O limite de 500 páginas interrompe loop. O código é `LIMITE_PAGINAS` e o status é `DISCOVERY_FAILED`. O limite pode ser reduzido em `maxPaginas` para o mesmo efeito.

## Duplicidades

A chave nacional é o identificador.

- Repetida na mesma direção: o primeiro registro entra no inventário, os demais ficam só em `registros`, com diagnóstico `DUPLICIDADE`. O status deixa de ser completo.
- Presente em emitidas e recebidas: os dois registros brutos são preservados. A chave sai do inventário confirmado, com `CHAVE_EM_AMBAS_DIRECOES`, para a origem ser investigada depois.

Nada é descartado em silêncio.

## Evidência de situação

A coluna de situação é a `td` cujo token de classe contém `situacao` e não contém `acao`, `acoes` ou `menu`. A comparação é por token, porque o texto `situacao` contém a sequência `acao`.

De cada linha saem, sem classificação:

- `tr[data-situacao]`
- texto e classe de `td.td-situacao`
- `src`, `title`, `data-original-title`, `alt` e `aria-label` dos ícones dessa célula

Ícones do menu de ações, inclusive o botão Cancelar, não entram na evidência. Essas descrições são gravadas em `evidencias` do documento, ainda com origem `NAO_CLASSIFICADA`.

## Completude

`DISCOVERY_COMPLETE` exige, ao mesmo tempo:

- CNPJ e período válidos
- navegação na listagem pedida
- filtro confirmado nos campos, na URL da pesquisa e no estado da tabela
- todas as páginas percorridas até o fim comprovado
- todas as linhas avaliadas
- chave nacional em cada linha
- nenhum diagnóstico de paginação, duplicidade ou chave nas duas direções

Lista vazia confirmada é completa. Cancelamento capturado na evidência não impede a completude.

`DISCOVERY_FAILED` prevalece sobre incompleto. `DISCOVERY_INCOMPLETE` cobre chave ausente, duplicidade, chave nas duas direções e totalizador divergente, quando a navegação em si terminou.

## Testes

`Backend/src/automation/nfse/discovery/discovery.test.ts` cobre a extração, a paginação, as duplicidades e a confirmação do filtro. A confirmação inclui pesquisa concluída na URL, pesquisa que não atualiza a URL, tabela antiga ainda visível, resultado idêntico ao da listagem anterior, lista vazia confirmada, datas divergentes e falha de navegação.

Fixtures são HTML sintético e um portal em memória. Não há Portal Nacional, certificado, SEFIN nem Chromium.

Validação desta etapa, em `Backend`:

- `npm run typecheck` — sucesso
- `npm test` — 21 arquivos, 210 testes, todos passando (25 em `discovery.test.ts`)

Não foram executados `test:smoke-db`, `test:smoke-storage` nem `test:playwright`.

## Limitações

- A situação fiscal não é classificada. Toda nota confirmada permanece `INDETERMINADA`.
- Descoberta completa de notas ainda não classificadas bloqueia o processamento automático pelos contratos da etapa 22.1.
- XML, PDF e DANFS-e continuam no caminho atual do navegador. Este módulo não os baixa.
- `data-chave` opaco não é interpretado. A chave precisa aparecer em claro no `href` ou no atributo.
- O serviço ainda não é chamado por `execution-service.ts`. A execução das empresas segue o fluxo anterior.
- Seletores de menu, data e próxima página são os mesmos do AutoNacional hoje. Mudança no Portal Nacional exige revisão desses pontos.

## Próxima etapa

Classificar a situação fiscal a partir das evidências brutas já capturadas, sem tratar nota como vigente por ausência de evidência. A ligação com a execução real continua fora deste módulo até essa classificação existir.

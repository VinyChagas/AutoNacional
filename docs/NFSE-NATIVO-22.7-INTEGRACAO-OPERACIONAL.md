# NFS-e nativa — etapa 22.7 — integração operacional (Commit 07)

Integração incremental e reversível dos módulos fiscais nativos (Commits 01–06) ao fluxo operacional do AutoNacional. Desativada por padrão. Sem consultas reais à SEFIN ou ao Portal Nacional nesta etapa. Sem alteração de worker, PQueue, browser manager, login, CAPTCHA, PDF legado, Prisma ou frontend.

**Produção não está homologada.**

## Revisão 22.7.1 — ativação e exclusividade

A flag global **não basta** para iniciar recuperação SEFIN real. Exige-se também autorização explícita por execução (`autorizacaoNativa: { autorizada: true }`), tipada, verificável e **desativada por padrão**. O `execution-service` **não** fornece essa autorização (nenhum `true` hardcoded). Sem mecanismo operacional seguro de autorização nesta etapa, o nativo permanece **bloqueado em produção**; testes offline injetam o contexto autorizado.

A sequência crítica (checkpoint → retomada → planejamento → SEFIN → XML → reconciliação → auditoria) roda sob **uma** `CheckpointStore.comTrava` (Commit 05) via `RepositorioFiscalNfse.executarComExclusividadeFiscal`. Operações internas usam `jaComTrava: true` para evitar deadlock por aquisição aninhada. A trava libera no `finally` de `comTrava` (sucesso ou falha). Limite: exclusividade por processo/host via trava em disco; multi-host depende do filesystem compartilhado — **não declarado** sem evidência.

## Relatório de integração (auditoria prévia)

### Ponto exato de integração

Arquivo: `Backend/src/services/execution-service.ts`, função `executarFluxoCompleto`.

Momento: **após autenticação concluída** (`stage: auth_ok`, `Page` já válida em `resultadoAuth.page`) e **antes** de `processarTabelaEmitidas` / `processarTabelaRecebidas`.

Assinatura do gancho:

```ts
decidirIntegracaoNativa(contexto)
tentarFluxoNativoControlado(contexto) // só se executarNativo === true
```

Contexto mínimo: `page`, `cnpj`, `dataInicio`, `dataFim`, `tipo`, `baixarPdf`, `execucaoId`, `tipoAutenticacao`, `certificadoEmMemoria?`, `autorizacaoNativa?` (omitida no worker).

### Situações de decisão

| Situação | Quando | Efeito |
|---|---|---|
| `LEGADO_SOLICITADO` | Flag off/inválida **ou** sem autorização | Executa legado; sem efeitos nativos |
| `NATIVO_SOLICITADO` | Flag + autorização + pré-condições | Executa orquestrador nativo |
| `NATIVO_RECUSADO` | Autorização explícita com pré-condição inválida | Erro estruturado; **sem** fallback legado |

Não declarar sucesso nativo quando o legado rodou.

### Fluxo legado (preservado)

1. Entrada: worker / PQueue enfileira execução.
2. Criação de navegador + slot visual (inalterados).
3. Login A1 ou credenciais + CAPTCHA (inalterados).
4. `Page` autenticada.
5. Período via `preencherDatasEFiltrar` nas tabelas emitidas/recebidas.
6. Downloads XML/PDF via `processarTabela*`.
7. Persistência operacional em `downloadsBasePath`.
8. Contagens + SSE + `finalizarExecucao`.

Com a flag **desativada** ou **sem autorização**: comportamento legado equivalente — sem descoberta nativa, sem A1 adicional, sem SEFIN, sem storage fiscal, sem stage `nfse_nativo`.

### Fluxo nativo controlado

Ordem:

1. Feature flag `NFSE_NATIVE_RECOVERY_ENABLED=true`.
2. Autorização explícita `autorizacaoNativa.autorizada === true`.
3. Pré-condições (ver abaixo); falha → `NATIVO_RECUSADO`.
4. Descoberta (`discoverNfse`) na **mesma** `Page` (fora da trava).
5. Carga A1 sob demanda (fora da trava).
6. **Aquisição da trava** fiscal (CNPJ + período).
7. Planejamento → checkpoint → retomada → SEFIN → persistência → reconciliação → auditoria.
8. **Liberação da trava** no `finally`.

### Dependências necessárias

- Módulos: `contracts`, `discovery`, `classification` (via discovery), `recovery`, `checkpoint`, `infrastructure`.
- Env (somente quando nativo): `NFSE_NATIVE_RECOVERY_ENABLED`, `NFSE_FISCAL_STORAGE_PATH`.
- Certificado A1 do cadastro (sob demanda) ou buffer já em memória da execução.

### Riscos de alterar o fluxo

| Risco | Mitigação |
|---|---|
| Quebrar PDF/DANFS-e | `baixarPdf === true` força LEGADO |
| Misturar dois fluxos | Sem híbrido implícito; nativo ou legado |
| Fallback silencioso pós-efeito | Erro tipado `OrquestracaoNfseError`; sem retorno ao legado após NATIVO |
| Concorrência | Sem nova fila/worker; mesma PQueue |
| Segredos em SSE | Stage genérico `nfse_nativo`; sem PFX/senha/XML/chaves completas |

### Estratégia de rollback

Remover ou deixar ausente `NFSE_NATIVE_RECOVERY_ENABLED` (ou `false`). Fluxo legado imediato. Sem migração de schema. Sem alteração de produção obrigatória.

### Compatibilidade com PDF

O módulo SEFIN recupera **XML**. Não gera PDF. Enquanto `baixarPdf` estiver ativo, a substituição integral do legado é **bloqueada** (`BLOQUEIA_SUBSTITUICAO`). Homologação de equivalência PDF fica para Commit 08+.

### Autenticação

| Método | Nesta etapa |
|---|---|
| Credenciais + CAPTCHA | Mantidos no legado; nativo **não** ativa com `tipoAutenticacao === 'credenciais'` |
| A1 (certificado) | Login legado inalterado; recuperação SEFIN reutiliza A1 via `AdaptadorCertificadoA1` / buffer da execução |
| CAPTCHA | Não solicitado de novo pelo orquestrador |

## Feature flag

`NFSE_NATIVE_RECOVERY_ENABLED`

| Valor | Efeito |
|---|---|
| Ausente / vazio | Desativada |
| `false` | Desativada |
| `true` | Habilitável (ainda exige autorização + pré-condições) |
| Qualquer outro | Falha segura: desativada |

Não adicionada ao `.env` automaticamente. Não ativa na importação. Não carrega certificado nem cria navegador ao avaliar a flag. **Configurar só a flag no ambiente não inicia SEFIN.**

## Autorização por execução

```ts
autorizacaoNativa?: { autorizada: true; motivo?: string } | null
```

- Interna, tipada, verificável.
- Desativada por padrão (ausente / não-`true`).
- Não inferida por A1, `baixarPdf=false`, storage ou login.
- Sem endpoint, frontend, Prisma ou nova variável `.env` nesta etapa.
- Fornecida só por injeção em testes / futuro canal operacional seguro.

## Pré-condições do nativo (após flag + autorização)

- `baixarPdf === false`
- `Page` autenticada
- `tipoAutenticacao === 'certificado'`
- `NFSE_FISCAL_STORAGE_PATH` configurada e distinta de downloads
- CNPJ e período válidos
- Inventário completo, sem indeterminada
- Certificado A1 disponível sob demanda

Sem autorização → legado. Com autorização e pré-condição inválida → erro tipado (`NATIVO_RECUSADO`), sem fallback silencioso.

## Exclusividade (trava)

- Identidade: CNPJ + período de consulta do portal.
- Mecanismo: `CheckpointStore.comTrava` (mkdir atômico + dono pid/token).
- Aquisição: início da sequência crítica no orquestrador.
- Liberação: `finally` de `comTrava` (inclusive falha SEFIN, persistência ou auditoria).
- `jaComTrava`: evita segunda aquisição na mesma pilha (deadlock).
- Duas execuções nativas no mesmo CNPJ/período → `EXECUCAO_EM_USO`.
- Empresas ou períodos distintos não compartilham a trava.
- Limite PID/host: trava em disco; processo morto pode ser recuperado pelas regras do Commit 05; multi-host sem FS compartilhado não é suportado declaradamente.

## Módulo

```text
Backend/src/automation/nfse/orchestration/
  types.ts
  feature-flag.ts
  native-orchestrator.ts
  integration-adapter.ts
  orchestration.test.ts
  index.ts
```

Função principal: `executarFluxoFiscalNativo({ page, cnpj, periodoConsulta, ... dependencias })`.

## Tratamento de erros

`OrquestracaoNfseError` com códigos: `CNPJ_INVALIDO`, `PERIODO_INVALIDO`, `PAGE_AUSENTE`, `DESCOBERTA_INCOMPLETA`, `SITUACAO_INDETERMINADA`, `CERTIFICADO_INDISPONIVEL`, `PDF_EXIGE_LEGADO`, `FALHA_ORQUESTRACAO`, entre outros.

Após decisão `NATIVO_CONTROLADO`, falhas sobem ao `catch` de `executarFluxoCompleto` (status `falhou`). Sem misturar contagens legado+nativo.

## Checkpoint, auditoria e reconciliação

Reutilizam Commits 05 e 06. Não re-recuperar `PERSISTIDO` íntegro. Não declarar `RECONCILIADA` com pendências. Auditoria sem PFX, senha, XML integral, tokens, cookies, CPF ou chaves completas em logs.

## Concorrência

Inalterada. Mesma PQueue e mesmo worker. Sem scheduler paralelo.

## Segurança

- Sem efeitos na importação
- A1 sob demanda
- Máscara de chave em resultados
- SSE sem segredos
- Sem escrita em `./downloads` no caminho nativo

## Limitações

- PDF não coberto pelo nativo
- Login por credenciais não dispara recuperação SEFIN nesta etapa
- Sem retry automático sem contrato
- Sem chamadas reais nos testes desta etapa
- Exportação ZIP legado não substituída

## Retomada

- XML `PERSISTIDO` íntegro: não reconsulta SEFIN.
- Órfão válido: promovido na retomada sem sobrescrever.
- Corrompido / hash divergente: `INCONSISTENTE`; não apaga nem sobrescreve.
- Fingerprint incompatível: bloqueio `IDENTIDADE_DIVERGENTE`.
- Falha parcial: checkpoint preserva estados por chave.

## Testes

Offline em `orchestration.test.ts`: flag, autorização, legado, `NATIVO_RECUSADO`, exclusividade, retomada, sem Playwright/SEFIN reais.

Validação: `cd Backend && npm run typecheck && npm test`.

## Bloqueios para homologação

1. Canal seguro de autorização por execução (sem inferência).
2. Evidência de equivalência PDF (ou aceite XML-only).
3. Homologação SEFIN mTLS em ambiente controlado.
4. Política credenciais + A1.
5. Evidência de exclusividade multi-host (se aplicável).
6. Runbook de rollback operacional.

## Pendências para Commit 08

- Estratégia PDF / DANFS-e em paralelo ou pós-XML
- Contrato híbrido explícito (se necessário)
- Observabilidade operacional (métricas nativas)
- Soft-launch por contabilidade/empresa
- Documentação de operação e feature flag em staging

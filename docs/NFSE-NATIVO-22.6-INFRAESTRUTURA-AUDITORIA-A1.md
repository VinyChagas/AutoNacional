# NFS-e nativa — etapa 22.6 — infraestrutura, auditoria e adaptador A1

Este módulo prepara a integração operacional futura. Não inicia automação, não altera o worker e não consulta o Portal Nacional nem a SEFIN.

## Arquitetura

```text
Backend/src/automation/nfse/infrastructure/
  types.ts
  a1-adapter.ts
  storage-resolver.ts
  fiscal-repository.ts
  audit-service.ts
  infrastructure.test.ts
  index.ts
```

| Peça | Papel |
|---|---|
| `AdaptadorCertificadoA1` | Fonte A1 → `CredencialMtls` do Commit 04 |
| `criarResolvedorRaizInjetada` | Raiz fiscal isolada, fora de `./downloads` |
| `RepositorioFiscalNfse` | Fachada sobre o checkpoint do Commit 05 |
| `montarAuditoriaFiscal` / `persistirAuditoriaFiscal` | Relatório estruturado e arquivo atômico |

## Fonte operacional do certificado A1

Auditoria somente leitura do AutoNacional:

| Ponto | Situação atual |
|---|---|
| Cadastro | Tela de Empresas / importação em lote |
| Arquivo | Storage de certificados (`CERT_STORAGE_PATH` ou SFTP) |
| Senha | `senhaCriptografada` + `decryptPassword` |
| Loader | `carregarCertificadoPorCnpj(cnpj)` em `Backend/src/services/certificate-loader.ts` |
| Retorno | `{ pfx: Buffer; passphrase: string }` (`CertificadoEmMemoria`) |
| Playwright | Usa o mesmo loader no login A1 do navegador |
| Expiração | Campo `dataValidade` no cadastro; o Commit 04 também rejeita `notAfter` vencido no PKCS#12 |

O login Playwright, o storage de certificados e o loader operacional **não foram modificados**.

## Interface do adaptador

```ts
interface FonteCertificadoA1 {
  carregar(cnpj: string): Promise<{ pfx: Buffer; passphrase: string }>;
}

class AdaptadorCertificadoA1 implements ProvedorCredencialMtls {
  obter(cnpj: string): Promise<CredencialMtls>; // { pfx, senha }
}
```

`criarProvedorA1DoCadastro()` importa `carregarCertificadoPorCnpj` só na primeira chamada a `carregar`. Não há leitura na importação do módulo nem cache de PFX entre chamadas.

Depois do carregamento, `inspecionarCredencialMtls` (Commit 04) confere senha, PKCS#12 e validade. Não há segundo cliente HTTPS.

## Segurança das credenciais

- Senha e PFX não entram em log, auditoria, checkpoint nem mensagem pública de erro.
- Erros estruturados: `CNPJ_INVALIDO`, `CERTIFICADO_INEXISTENTE`, `CERTIFICADO_INACESSIVEL`, `SENHA_INDISPONIVEL`, `SENHA_INVALIDA`, `PFX_INVALIDO`, `CERTIFICADO_EXPIRADO`, `ERRO_DESCRIPTOGRAFIA`, `ERRO_LEITURA`.
- O adaptador não retorna opções HTTPS completas nem empilha o erro original com dados sensíveis.
- Cada `obter` devolve uma **cópia** do Buffer PFX; mutar a credencial não altera o buffer original da fonte.
- Não há cache de credencial entre chamadas. Só a referência da função do loader operacional é memorizada após o primeiro import dinâmico.

### Limitações PKCS#12 e memória no Node.js

Buffers e strings com material criptográfico ficam sujeitos ao GC do V8. Zerar o `Buffer` ajuda, mas não garante limpeza imediata de cópias internas. Esta etapa não mantém PFX em variável de módulo; a limpeza absoluta de memória não é prometida.

## Integração com recovery

O adaptador implementa `ProvedorCredencialMtls` esperado por `recuperarXmlNfse`. Não duplica `https.Agent`, não altera TLS global e não usa `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Resolução do armazenamento

Não existe variável de ambiente dedicada ao repositório fiscal nativo. A raiz é **injetada** por `criarResolvedorRaizInjetada(raiz)`.

A configuração operacional conhecida:

- Downloads: `downloadsBasePath` / `./downloads` (worker).
- Certificados: `CERT_STORAGE_PATH` / SFTP.

Esta etapa **não escreve** em `./downloads` nem no storage de certificados. `raizFiscalDistintaDeDownloads` rejeita raiz igual ou dentro da pasta de downloads.

Estrutura sob a raiz injetada:

```text
{raiz}/
  checkpoints/{cnpj}/{periodo}/checkpoint.json
  xml/{cnpj}/{periodo}/{chave}.xml
  auditoria/{cnpj}/{periodo}/{execucaoId}/{snapshotId}.json
```

O período é o de consulta do Portal Nacional. `dCompet` não organiza pastas.

## Reutilização do checkpoint

`RepositorioFiscalNfse` instancia `CheckpointStore`, `XmlStore` e `CheckpointService` do Commit 05. Preserva:

- escrita atômica
- idempotência
- SHA-256
- retomada e XML órfão
- validação fiscal `CONFIRMADA`
- trava por CNPJ/período

Não há segundo checkpoint nem segunda regra fiscal.

## Auditoria e política de snapshots (revisão 22.6.1)

`montarAuditoriaFiscal` produz relatório com CNPJ, período, execução, `snapshotId`, fingerprint, totais, cobertura percentual, conclusão da reconciliação e estado:

| Estado | Quando |
|---|---|
| `RECONCILIADA` | Reconciliação `RECONCILIADA` e sem indeterminada |
| `BLOQUEADA` | Há situaçao `INDETERMINADA` |
| `PARCIAL` | Demais casos incompletos |

O `snapshotId` é o SHA-256 (32 hex) do conteúdo fiscal canônico **sem** `auditadoEm`. Assim:

- Snapshot parcial (60%) e snapshot reconciliado (100%) da mesma execução convivem em arquivos distintos.
- O mesmo conteúdo fiscal é idempotente, mesmo com `auditadoEm` diferente.
- Empresa, período e `execucaoId` isolam o diretório; não há mistura entre identidades.
- `listarSnapshotsAuditoria` devolve o histórico ordenado por `auditadoEm`.
- `obterAuditoriaMaisRecente` devolve o último snapshot da execução.

Diagnósticos usam chave mascarada (`1234…5678`). XML integral, senha e PFX não entram.

`persistirAuditoriaFiscal` grava JSON atômico sob a trava do checkpoint. `snapshotId` forjado (divergente do conteúdo) é recusado com `AUDITORIA_INCOMPATIVEL`.

## Exportação: documento apto × lote liberado (revisão 22.6.1)

`listarDocumentosExportaveis` devolve dois contratos:

| Campo | Significado |
|---|---|
| `aptos` | Documentos **individualmente** aptos |
| `lote` | Liberação do **lote contábil** completo |

Documento individualmente apto exige:

- situação `VIGENTE`
- estado `PERSISTIDO`
- arquivo existente, tamanho e SHA-256 conferidos
- CNPJ e direção do inventário
- validação fiscal `CONFIRMADA` via `validarXmlNfse` (Commit 04)

Cancelada não entra em `aptos`. Indeterminada não entra em `aptos`. Hash, nome de arquivo ou checkpoint sozinhos não bastam.

Lote liberado (`lote.liberado`) exige:

- inventário `COMPLETO`
- nenhuma indeterminada
- reconciliação `RECONCILIADA`
- nenhuma inconsistência bloqueante
- todos os vigentes presentes em `aptos`

Um lote parcial pode ter documentos em `aptos` sem `lote.liberado`. Não gera ZIP, PDF nem altera o exportador atual.

## Concorrência

A trava é a do Commit 05 (diretório `.travas` + dono pid/token). O repositório e a auditoria compartilham essa identidade CNPJ/período. Limitações de PID, namespace e trava órfã permanecem as documentadas na etapa 22.5. Não há suporte irrestrito a múltiplos processos. `PQueue` não foi alterada.

## Testes

`infrastructure.test.ts` cobre 60 comportamentos offline. A revisão 22.6.1 acrescenta snapshots (parcial → reconciliado, histórico, idempotência, empresa/período/execução, mais recente), exportação com validação fiscal (chave, empresa, direção, malformado, lote parcial × reconciliado) e A1 (cópia do PFX, ausência de cache de credencial, sem vazamento).

Validação desta revisão, em `Backend`:

- `npm run typecheck` — sucesso
- `npm test` — 25 arquivos, 386 testes, todos passando (60 em `infrastructure.test.ts`)

Não foram executados `test:smoke-db`, `test:smoke-storage` nem `test:playwright`.

## Riscos

- Sem raiz fiscal configurada no `.env`, o Commit 07 precisa injetar um caminho isolado antes de gravar em produção.
- O loader operacional ainda acessa Prisma e storage; falhas de banco/storage só aparecem quando `obter` é chamado.
- Reuso de PID na trava do checkpoint continua limitando recuperação automática de travas.

## Limitações

- Não liga o worker.
- Não adapta o cadastro além do wrapper sob demanda.
- Não gera ZIP/PDF.
- Não altera downloads legados.
- Não há limpeza garantida de memória criptográfica no Node.js.

## Pendências para Commit 07

- Integrar descoberta → classificação → plano SEFIN → repositório → auditoria no worker, só com inventário completo e sem indeterminada.
- Escolher e configurar a raiz fiscal isolada em produção.
- Emitir eventos SSE compatíveis sem vazar segredos.
- Homologar certificado A1 real e consulta SEFIN em ambiente controlado.

## Pendências para homologação

- PFX ICP-Brasil real.
- mTLS contra SEFIN de homologação/produção com limites observados.
- Volume de XMLs e tempo de reconciliação.
- Política de retenção de auditoria e acesso ao relatório.

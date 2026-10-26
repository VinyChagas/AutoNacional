# NFS-e nativo — H2.2.2-B Preparação final para descoberta real autorizada

**Status:** preparação OFFLINE concluída. Homologação real **não** declarada.

**Branch:** `nfsexplorer`

## Objetivo

Preparar a primeira execução real de `DISCOVERY_ONLY` no Portal Nacional sem abrir o gate global, sem env genérica e sem endpoint público. Esta etapa permanece offline: sem Portal, SEFIN, browser, login ou certificado real.

## Alterações realizadas

1. **Ticket com ativação individual** (`ativacaoDiscoveryReal`, `ativacaoMotivo`, `ativacaoEm`).
2. **Canal:** `ativarDiscoveryReal(autorizacaoId, motivo)` — só no ticket `DISPONIVEL`; não afeta outras execuções.
3. **Ponte:** descoberta só com ticket válido + ativação individual + `Page` + `discover`; gate global aberto sozinho → `BLOQUEADA_GATE_REAL`.
4. **execution-service:** injeta `discoverNfse` existente na ponte (sem novo mecanismo).
5. **Consumo único** antes da descoberta; falha/timeout/cancelamento **não** liberam o ticket.
6. Testes offline H2.2.2-B + docs.

## Por que `discoverNfse` não estava injetado antes?

Na H2.2.2-A o caminho operacional omitia `discover` de propósito: o gate fechado bloqueava a descoberta, e injetar o discover real no serviço aumentaria o risco se o gate fosse aberto por engano em teste. A autorização efetiva passou a ser a **ativação individual do ticket**, então a injeção de `discoverNfse` fica segura: sem ativação a ponte não chama o discover.

## Menor alteração para disponibilizá-lo

Passar `discover: discoverNfse` em `avaliarPonteHomologacaoDiscoveryOnly` no `execution-service` (após `auth_ok`), reutilizando a `Page` já autenticada. Sem novo browser, login, CAPTCHA, worker, PQueue ou cliente HTTP.

## Canal de autorização

Reutiliza o canal H2.2.1 (memória ou arquivo):

| Campo / regra | Exigência |
|---------------|-----------|
| Ticket válido | `autorizada`, versão 1, `DISCOVERY_ONLY` |
| `autorizacaoId` | único |
| `execucaoId` | vínculo 1:1 |
| CNPJ / período / diretório | devem bater com a execução |
| Expiração | `validoAte` |
| Limites | `maxPaginas`, `maxDocumentos`, `timeoutMs`, `maxRequisicoesSefin=0` |
| Consumo | único; não reutilizável |

## Ativação individual

```text
emitir(ticket)           → DISPONIVEL, ativacaoDiscoveryReal=false
ativarDiscoveryReal(id)  → mesma execução, motivo rastreável
ponte + discoverNfse     → consumir 1× → Discovery-Only → encerrar sem legado
```

- Uma ativação **não** habilita outras execuções.
- Gate global (`GATE_EXECUCAO_REAL_DISCOVERY_ONLY = false`) permanece fechado e **não** basta.
- Sem painel admin, scheduler, segunda aplicação ou env de ativação.

## Bloqueios

| Condição | Resultado |
|----------|-----------|
| Sem canal / sem ticket | legado (`SEM_AUTORIZACAO`) |
| Ticket inválido / CNPJ / período / expirado | `RECUSADA` / `FALHA`, sem consumo |
| Sem ativação individual | `BLOQUEADA` (`ATIVACAO_INDIVIDUAL_AUSENTE`) |
| Gate aberto sem ativação | `BLOQUEADA_GATE_REAL` |
| Ticket já consumido | `AUTORIZACAO_JA_CONSUMIDA` |
| Inventário incompleto / limite / timeout | não `CONCLUIDA` / não inventário completo |
| Falha de evidência | `FALHA` (`FALHA_EVIDENCIA`) |

## Limites e cancelamento

Reutiliza `ControleDescoberta` + `ControladorLimitesHomologacao`:

- `maxPaginas` / `maxDocumentos` globais (EMITIDAS + RECEBIDAS)
- `timeoutMs` + `AbortSignal` cooperativo
- Truncamento → inventário não completo; cancelamento → ticket permanece consumido

## Evidências

`persistirEvidenciasHomologacao` registra (sanitizado):

- `autorizacaoId`, `execucaoId`, CNPJ mascarado, período
- direções, quantidades, limites, estado final, erros sanitizados
- motivo/em de ativação individual (quando aplicável)

**Não registra:** senhas, PFX, cookies, tokens, CPF, XML integral, chaves fiscais completas.

## Procedimento para a primeira execução real

1. Confirmar branch `nfsexplorer` e revisão desta preparação.
2. Configurar canal operacional (arquivo absoluto seguro — **não** via env de ativação automática).
3. Emitir ticket H1 `DISCOVERY_ONLY` vinculado a `execucaoId`, CNPJ, período, diretório e limites.
4. Chamar `ativarDiscoveryReal(autorizacaoId, motivoRastreavel)` **somente** para essa execução.
5. Iniciar a execução normal do AutoNacional (login/browser existentes do fluxo).
6. Após `auth_ok`, a ponte reutiliza a `Page`, consome o ticket e chama `discoverNfse`.
7. Revisar evidências no diretório autorizado; encerramento **sem** legado SEFIN/XML.

**Interromper se:** ativação exigir mudança em worker/CAPTCHA/browser manager/PQueue; ticket de outra empresa/período; gate aberto sem ativação; evidência falhar; inventário truncado for tratado como sucesso.

## Riscos restantes

- Operador precisa emitir + ativar o ticket correto (erro humano de vínculo).
- Descoberta real ainda não foi executada — comportamento do Portal pode divergir dos mocks.
- Canal em arquivo exige diretório compartilhado seguro entre processos.
- Sem UI: ativação é ferramenta interna / código privilegiado.

## Critérios de interrupção

- Qualquer pedido de abrir gate global por env/endpoint.
- Necessidade de alterar CAPTCHA, worker, PQueue, browser manager ou PDF.
- Tentativa de autorização hardcoded ou painel administrativo.
- Declaração de homologação real sem evidências da execução autorizada.

## Não declarado

Homologação real no Portal Nacional **não** está concluída. Esta etapa é apenas preparação offline.

# NFS-e Nativo — H2.2.5 Homologação integrada offline (Discovery-Only)

**Etapa:** OFFLINE  
**Homologação real:** NÃO autorizada nesta etapa.

## Objetivo

Validar ponta a ponta, sem Portal/SEFIN/navegador/login/certificado:

```
CLI/UDS → Preparar → Prisma(mock) → Ticket → Ativar → Liberar →
PQueue(mock enqueue) → auth_ok simulada → Ponte (validações reais) →
Discovery-Only (discover injetado) → Evidências → Encerramento sem legado
```

## Fluxo integrado (positivo)

1. Inicializar canal admin UDS + handlers preparar/liberar.
2. `admin preparar` → `homologacao_preparada` + `execucaoId` (sem enqueue).
3. Emitir ticket `DISCOVERY_ONLY` vinculado ao `execucaoId`.
4. Ativar ticket individual (`ativacaoDiscoveryReal`).
5. `admin liberar` → valida ticket → `homologacao_liberada` → **1×** enqueue.
6. Simular `auth_ok` (`pagePresente` + Page mock).
7. Ponte `avaliarPonteHomologacaoDiscoveryOnly` (não mockada):
   - valida ticket / escopo / ativação;
   - **consome ticket 1×** antes da descoberta;
   - executa Discovery-Only com `discover` injetado;
   - persiste evidências no diretório fiscal autorizado.
8. Encerrar etapa fiscal **sem** fluxo legado (`encerrarEtapaFiscal: true` após autorização).

### Critérios confirmados no positivo

| Critério | Resultado |
|----------|-----------|
| Enqueue | exatamente 1 |
| Consumo de ticket | exatamente 1 (`CONSUMIDA`) |
| Ponte | `DESCOBERTA_CONCLUIDA` / `CONCLUIDA` |
| SEFIN / XML / checkpoint recuperação | ausentes |
| Gate global | permanece fechado |
| Evidências | arquivo `evidencia-h2-*.json` sem segredos |
| Segunda liberação | recusada |

## Dependências simuladas

| Real | Offline |
|------|---------|
| Prisma | Map in-memory (`criar` / `atualizarSeStatus`) |
| PQueue worker | `enfileirar` registra payload (sem Playwright) |
| Portal / navegador / login / certificado | Page stub + `discover` mock |
| Transporte SEFIN / XML / checkpoint | não invocados; contadores de efeito = 0 |
| UDS / canal / ponte / evidências | **componentes reais** |

A ponte **não** é short-circuitada: validações, consumo e adaptador Discovery-Only são exercitados.

## Testes executados

Arquivo: `Backend/src/automation/nfse/homologacao/homologacao-h2.2.5-integracao-offline.test.ts`

- Fluxo positivo integrado (UDS → evidências).
- Negativos: ticket ausente / não ativado / expirado / cancelado / consumido; CNPJ/período/execucaoId; timeout; inventário parcial; cancelamento; prep duplicada; liberação duplicada/concorrente; falha pós-create; falha pré/pós enqueue; reinício Map vazio; bloqueada; falha de evidência; UDS sem handler.
- Legado: sem ticket → `SEM_AUTORIZACAO`; `pendente` não liberável; health UDS sem enqueue; gate fechado.

## Estados

| Status | Uso no fluxo |
|--------|----------------|
| `homologacao_preparada` | após preparar |
| `homologacao_liberada` | após liberar com sucesso |
| `homologacao_bloqueada` | falha parcial (create/enqueue) |
| `CONSUMIDA` (ticket) | após ponte consumir 1× |

Estados bloqueada/liberada **não** permitem re-liberação nem reenqueue automático.

## Evidências

- Vinculadas ao `execucaoId`.
- CNPJ mascarado + período da autorização.
- Limites aplicados + veredito.
- Persistência atômica append-only no diretório fiscal.
- Colisão de arquivo → `FALHA_EVIDENCIA` explícita.
- Sem senha/PFX/token.

## Preservação do legado

- Sem ticket / canal null → ponte não encerra legado (`encerrarEtapaFiscal: false`).
- Status `pendente` não passa por `admin liberar`.
- Gate global fechado; health UDS não enfileira jobs fiscais.
- Frontend / login / CAPTCHA / browser manager / PDF não alterados nesta etapa.

## Limitações

- Prisma e PQueue de produção não são exercitados (mocks).
- “auth_ok” é presença de Page, não login real.
- Discover é injetável; não há HTML do Portal.
- Não cobre crash de processo Backend operacional.

## Riscos restantes / pré-requisitos para 1ª homologação real

1. Backend operacional com UDS + store de tickets + canal bootstrap.
2. Gate e ativação individual sob procedimento controlado (ainda **não** liberados por H2.2.5).
3. Certificado/credenciais e Page autenticada reais.
4. Diretório fiscal seguro e observabilidade de evidências.
5. Reconciliação manual para `bloqueada` / restart (B2-R1).
6. Plano de rollback se a ponte encerrar etapa sem legado em produção.

## Não declarado

Esta etapa **não** autoriza homologação Discovery-Only real contra Portal Nacional ou SEFIN.

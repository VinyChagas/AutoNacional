# NFS-e Nativo — H2.2.4-B2 Preparação e liberação controlada

**Etapa:** OFFLINE (inclui revisão B2-R1)  
**Homologação real:** NÃO autorizada / NÃO liberada nesta etapa.

## Objetivo

Fluxo administrativo:

`PREPARAR → AUTORIZAR (ticket CLI) → LIBERAR → EXECUTAR (PQueue)`

Elimina a race em que `adicionarExecucao` criava o `execucaoId` e enfileirava no mesmo passo.

## Arquitetura

| Peça | Papel |
|------|--------|
| Admin UDS | `admin preparar` / `admin liberar` (+ health/status) |
| CLI tickets | `emitir` / `ativar` / `consultar` / `cancelar` |
| Canal H1 | Validação de escopo/limites/ativação; **sem consumo** em B2 |
| Registry in-memory | Payload do job **somente no processo proprietário** |
| PQueue existente | Única fila; `liberar` chama `fila.add` do mesmo worker |
| Ponte Discovery-Only | Consome o ticket **antes** da descoberta |

## Ordem exata — preparação

1. Autenticação admin UDS (token).
2. Validar `empresaId`, CNPJ, período DD/MM/YYYY, tipo `DISCOVERY_ONLY`.
3. `Prisma.create` → status `homologacao_preparada` → obtém `execucaoId`.
4. `Map.set(execucaoId, payload)` (inclui `processoPid`).
5. Retornar identificador + flags `enfileirado: false`.

**Não ocorre:** `fila.add`, navegador, login, descoberta, consumo de ticket.

### Falhas parciais na preparação

| Janela | Persistido | Payload | Ação |
|--------|------------|---------|------|
| Antes do create | nada | — | erro; nada a reconciliar |
| Após create, antes do Map | `homologacao_preparada` | ausente | tenta `homologacao_bloqueada`; **não** reconstrói payload |
| Após Map, falha no retorno | pode ir a `bloqueada` | removido no catch | reconciliação manual |
| Crash do processo entre 3–4 | `preparada` órfã | perdido | liberar recusa (payload ausente) |

## Ordem exata — liberação

Sob mutex **por `execucaoId` neste processo**:

1. Autenticação admin UDS.
2. Localizar execução; recusar se inexistente / `liberada` / `bloqueada` / outro status ≠ `preparada`.
3. Exigir payload in-memory deste processo (proprietário).
4. Conferir payload ↔ Prisma (CNPJ, período, `empresaId`).
5. Validar ticket: ativado, `DISPONIVEL`, escopo, limites, expiração, `DISCOVERY_ONLY`, `execucaoId` exato — **`validarSemConsumir`**.
6. Reserva: `updateMany` `preparada → liberada` (exige `count === 1`).
7. Atualizar Map (`liberadoEm`).
8. `PQueue.add` / `enfileirar`.
9. Resposta administrativa (`enfileirado: true`, `ticketConsumido: false`).

### Falhas parciais na liberação

| Janela | Resultado |
|--------|-----------|
| Antes do `updateMany` | status permanece `preparada`; sem enqueue |
| `updateMany` count=0 | `AUTORIZACAO_CONCORRENCIA`; sem enqueue |
| Após `updateMany`, antes/durante enqueue | tenta `liberada → bloqueada`; payload removido; **sem reenqueue** |
| Após enqueue, falha ao responder CLI | job já na fila; ticket ainda não consumido |
| Segunda tentativa após falha | `bloqueada` ou `liberada` → recusa |
| Reinício | Map vazio → recusa; **não** reenfileira |

**Não existe atomicidade** entre Prisma e PQueue.

## Estados persistidos

| Status | Significado | Liberável? |
|--------|-------------|------------|
| `homologacao_preparada` | Aguarda ticket + liberação no processo que preparou | sim, se payload local |
| `homologacao_liberada` | Reserva feita; job enfileirado (ou falha antes do bloqueio) | não |
| `homologacao_bloqueada` | Falha parcial / estado incerto | não |
| `pendente` / legado | Fluxo HTTP normal | não (admin) |

- Schema Prisma: `status` é `String` — sem migração.
- Não são tratados como `pendente` pelo shutdown da fila (`pararFilaExecucao` só marca `pendente`).
- Rotas/SSE legado não enfileiram essas execuções automaticamente.

## Payload in-memory

- Chave: `execucaoId` (string numérica).
- Contém CNPJ, período, flags de job, `processoPid`.
- **Perdido no reinício** e **não compartilhado** entre instâncias Backend.
- Divergência payload ↔ Prisma → liberação recusada.
- **Nunca** reconstruir payload a partir só do Prisma.

## Concorrência e múltiplas instâncias

- Mutex local por `execucaoId` + `updateMany` otimista.
- Duas liberações simultâneas no mesmo processo → uma sucesso, outra recusa.
- Duas instâncias Backend: só a que possui o Map pode passar da checagem de payload; a outra bloqueia conservadoramente.
- **Não** há coordenação distribuída, lease nem outbox nesta etapa.

## Autorização

- Ticket ativado individualmente (`ativacaoDiscoveryReal`).
- Gate global permanece fechado (`GATE_EXECUCAO_REAL_DISCOVERY_ONLY = false`).
- Liberar **não** consome ticket; consumo na ponte.
- Escopo: `execucaoId`, CNPJ, período, `DISCOVERY_ONLY`, diretório fiscal, limites, expiração.

## UDS

- Token obrigatório (timing-safe); sem `--secret` em argv.
- Ops: `health` \| `status` \| `preparar` \| `liberar`; demais recusados.
- Envelope validado; limites de tamanho; timeout; respostas sanitizadas (sem segredos).

## Recuperação manual

1. Identificar `execucaoId` e status Prisma.
2. Se `preparada` sem payload (após restart): **não** liberar via admin; decidir cancelar ticket / criar nova preparação.
3. Se `liberada` ou `bloqueada` sem certeza de job: **não** reenfileirar; inspecionar logs/fila/processo.
4. Ticket pode continuar `DISPONIVEL` se a ponte não rodou — cancelar se necessário.

## Garantias que existem

- Preparar não enfileira.
- `execucaoId` disponível antes da autorização por ticket.
- Liberação exige ticket ativado e payload do processo atual.
- Ticket não é consumido em preparar/liberar.
- Liberação duplicada/concorrente no processo é recusada.
- Falha parcial conhecida tende a `homologacao_bloqueada`.

## Garantias que NÃO existem

- Atomicidade Prisma ↔ PQueue.
- Sobrevivência do payload após reinício.
- Idempotência distribuída entre múltiplos Backends.
- Reenqueue automático seguro.
- Homologação Discovery-Only real autorizada.
- Ativação global do gate.

## Comandos

```bash
npm run homologacao:cli -- admin preparar \
  --socket-dir /abs/admin --secret-file /abs/secret \
  --empresa-id 1 --cnpj 11222333000181 \
  --periodo-inicio 01/01/2024 --periodo-fim 31/01/2024

npm run homologacao:cli -- emitir --store /abs/store --execucao-id <id> ...
npm run homologacao:cli -- ativar --store /abs/store --autorizacao-id <id> --motivo "..."

npm run homologacao:cli -- admin liberar \
  --socket-dir /abs/admin --secret-file /abs/secret \
  --execucao-id <id>
```

## Evidências

- Testes B2 + B2-R1 em `homologacao-h2.2.4-b2-preparacao-liberacao.test.ts`.
- Typecheck + `npm test` (Backend).

## Riscos restantes

1. Crash entre create e Map deixa `preparada` órfã até intervenção manual.
2. Após `fila.add`, falha de resposta CLI não reverte o enqueue.
3. `pararFilaExecucao` com jobs `homologacao_liberada` em memória: fila limpa sem marcar `bloqueada` (janela de shutdown).
4. Homologação real fora do escopo offline.

## Não declarado

Esta etapa **não** autoriza nem libera homologação Discovery-Only real em produção.

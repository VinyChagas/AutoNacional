# NFS-e nativo — H2.2.1 Canal seguro de autorização operacional

Canal que permite **preparar** DISCOVERY_ONLY com a Page autenticada do AutoNacional, sem executar navegação real.

**Offline nesta etapa.** Gate de execução real permanece **fechado**.

---

## 1. Arquitetura

```text
Ferramenta privilegiada
    → emitir TicketAutorizacaoOperacional (DISCOVERY_ONLY)
    → configurarCanalHomologacaoOperacional(canal)

execution-service (após login, Page pronta)
    → avaliarPonteHomologacaoDiscoveryOnly({ execucaoId, cnpj, período, pagePresente })
         ├─ sem canal / sem ticket → legado idêntico
         ├─ ticket válido + gate fechado → valida SEM consumir, evidências, ENCERRA etapa fiscal
         │                                 (descobertaExecutada=false, ticketConsumido=false)
         └─ recusa de validação → encerra sem legado; ticket permanece no estado anterior
```

**H2.2.1-R1:** com gate fechado o ticket **não** é consumido. O consumo atômico (`consumir` + lease) fica reservado à execução real (H2.2.2).

| Componente | Papel |
|------------|--------|
| `canal-autorizacao.ts` | Emitir / consultar / consumir / cancelar |
| `canal-autorizacao-types.ts` | Ticket + estados |
| `gate-execucao-real.ts` | `GATE_EXECUCAO_REAL_DISCOVERY_ONLY = false` |
| `ponte-execution-homologacao.ts` | Decisão operacional |
| `diretorio-seguro.ts` | Absoluto, anti-traversal, anti-symlink |
| `execution-service.ts` | Ponte mínima pós-`auth_ok` |

Não modifica: worker, PQueue, browser manager, login, CAPTCHA, frontend, Prisma, PDF.

---

## 2. Ponto de integração

Em `execution-service`, **após autenticação** (`page` disponível, `execucaoDbId`, `cnpj`, `dataInicio`/`dataFim`):

1. Chama `avaliarPonteHomologacaoDiscoveryOnly`.
2. Se `encerrarEtapaFiscal` e `PREPARADA_GATE_FECHADO` → não entra em nativo SEFIN nem download legado; finaliza com `HOMOLOGACAO_DISCOVERY_ONLY_PREPARADA`.
3. Se `SEM_AUTORIZACAO` → comportamento legado/nativo **idêntico** ao anterior.
4. `finalizarExecucao` no `finally` existente libera page/browser/slot como antes.

---

## 3. Contrato

### Ticket

- `autorizacaoId` — único
- `autorizacao: AutorizacaoHomologacaoNfse` — H1 completo
- `estado`: DISPONIVEL | CONSUMIDA | EXPIRADA | CANCELADA | FALHA
- Operação **somente** `DISCOVERY_ONLY` (`maxRequisicoesSefin = 0`)
- Recusa `{ autorizada: true }` genérico e SEFIN

### Vínculos obrigatórios no consumo

CNPJ, período, `execucaoId`, diretório fiscal, não expirado.

---

## 4. Consumo único

- `validarSemConsumir`: só leitura; não altera estado (usado com gate fechado).
- `consumir`: transição atômica DISPONIVEL → CONSUMIDA (ou FALHA se validação falhar após lease).
- Ticket consumido **nunca** volta a DISPONIVEL.
- Reuso após consumo / cancelamento → `AUTORIZACAO_JA_CONSUMIDA`.
- Preparação com gate fechado pode repetir enquanto o ticket estiver DISPONIVEL e válido.

---

## 5. Concorrência e lease

| Backend | Mecanismo |
|---------|-----------|
| Memória | Mutex em cadeia de Promises (processo único / testes) |
| Arquivo | `*.lease` criado com `flag: 'wx'` — um vencedor entre processos no **mesmo** store |

**Lease órfão (crash entre lease e escrita CONSUMIDA):** o `.lease` permanece; novos `consumir` falham com `AUTORIZACAO_CONCORRENCIA`. **Não** há remoção automática de lease alheio. Limpeza exige operador com comprovação de propriedade.

**Limites de garantia:**
- Mesmo host / FS local POSIX: `wx` + rename costumam ser suficientes.
- NFS / multi-host: atomicidade **não** é universal — **bloquear multi-host** até store com lock distribuído revisado.
- Memória: não cobre multi-processo.

**Dependência:** canal em arquivo exige diretório absoluto **injetado**. Sem Prisma. Sem env de ativação.

---

## 6. Segurança do diretório

`validarDiretorioFiscalSeguro`:

- Caminho absoluto resolvido
- Rejeita `\0` e segmentos `..`
- Opcionalmente confina sob `raizPermitida` via `realpath` (bloqueia escape por symlink)
- Evidências só sob o diretório do ticket (persistência H2.1.1)

---

## 7. Gate operacional

```ts
GATE_EXECUCAO_REAL_DISCOVERY_ONLY === false
execucaoRealDiscoveryOnlyHabilitada() === false
```

Mesmo com autorização válida:

- Não chama `discoverNfse`
- Não navega no Portal
- Não inicia SEFIN / XML / checkpoint
- Não cria browser/login
- Não declara PASS / cobertura fiscal
- **Não consome** o ticket (`ticketConsumido=false`, `descobertaExecutada=false`)

H2.2.2: com gate aberto, `consumir(..., 'EXECUCAO_REAL')` e então `executarDiscoveryOnlyHomologacao`.

---

## 8. Isolamento

- Sem canal configurado (`configurarCanalHomologacaoOperacional(null)`, padrão) → zero efeito.
- Sem endpoint público, sem env de ativação, sem auth hardcoded.
- Sem execução dupla: homologação preparada não cai no download legado.

---

## 9. Limitações

1. Gate real fechado — descoberta Portal fica para H2.2.2.
2. Canal memória não cobre multi-processo; use canal arquivo em deploy multi-worker.
3. Page ausente recusa **antes** do consumo (ticket permanece DISPONIVEL).
4. Playwright em voo (quando H2.2.2 abrir o gate) ainda terá limites cooperativos H2.1.1.

---

## 10. Procedimento futuro H2.2.2

1. Revisar e abrir `GATE_EXECUCAO_REAL_DISCOVERY_ONLY` por mecanismo explícito (não env genérico).
2. Emitir novo ticket DISCOVERY_ONLY para a execução alvo.
3. Na ponte, com gate aberto: chamar `executarDiscoveryOnlyHomologacao({ discover: discoverNfse, page, persistirEvidencias: true })`.
4. Manter encerramento sem legado após efeitos fiscais.
5. Validar evidências e inventário COMPLETO antes de declarar PASS real.

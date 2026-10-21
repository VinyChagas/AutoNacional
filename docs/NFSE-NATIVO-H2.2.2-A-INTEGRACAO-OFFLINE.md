# NFS-e nativo — H2.2.2-A Integração offline Discovery-Only

Integra canal H2.2.1 + adaptador H2.1 + evidências H2.1.1 + ponte no `execution-service`.

**Offline.** Gate de execução real permanece **fechado** por padrão. Sem Portal, SEFIN, env ou endpoint de ativação.

---

## 1. Arquitetura integrada

```text
execution-service (após auth_ok, Page pronta)
    → avaliarPonteHomologacaoDiscoveryOnly({ execucaoId, cnpj, período, page })
         │
         ├─ sem canal/ticket → legado idêntico
         │
         ├─ gate FECHADO (padrão)
         │     → validarSemConsumir
         │     → estadoOperacional BLOQUEADA
         │     → encerrarEtapaFiscal (sem legado)
         │
         └─ gate ABERTO (somente definirGateExecucaoRealSomenteTeste em testes)
               → consumir ticket 1×
               → executarDiscoveryOnlyHomologacao({ discover injetado, page, persistirEvidencias })
               → CONCLUIDA | INCOMPLETA | FALHA | CANCELADA
               → encerrarEtapaFiscal (sem legado)
```

Não modifica: worker, PQueue, browser manager, login, CAPTCHA, frontend, PDF.

---

## 2. Ponto exato de execução

Arquivo: `Backend/src/services/execution-service.ts`  
Momento: após autenticação, antes de `decidirIntegracaoNativa` / download legado.

Em produção H2.2.2-A: `discover` **não** é passado → mesmo com gate hipoteticamente aberto, falharia sem injeção. Gate constante = `false`.

---

## 3. Estados operacionais

| Estado | Origem |
|--------|--------|
| `BLOQUEADA` | Gate fechado + ticket válido |
| `CONCLUIDA` | Veredito PASS + inventário COMPLETO |
| `INCOMPLETA` | Limite/paginação/timeout/inventário parcial |
| `FALHA` | Erro técnico, auth inválida, persistência |
| `CANCELADA` | AbortSignal / INTERRUPCAO |

`null` quando `SEM_AUTORIZACAO` (legado).

Não declara CONCLUIDA/PASS com inventário incompleto nem cobertura fiscal parcial.

---

## 4. Autorização e consumo

- Ticket H1 completo, só `DISCOVERY_ONLY`.
- Gate fechado: **não consome**.
- Gate aberto (teste): consome **uma vez**; falha/cancel/timeout **não** liberam.
- CNPJ / período / `execucaoId` / diretório vinculados.

---

## 5. Gate

```ts
GATE_EXECUCAO_REAL_DISCOVERY_ONLY === false
definirGateExecucaoRealSomenteTeste(true|false|null) // só testes
```

Sem env, sem endpoint, sem hardcoded operacional.

---

## 6. Evidências

`persistirEvidenciasHomologacao` no diretório do ticket:

- Atômico, append-only
- CNPJ mascarado, diagnósticos sanitizados
- Falha de escrita → `FALHA` (não aprova)

---

## 7. Tratamento de falhas

| Caso | Estado | Legado |
|------|--------|--------|
| Sem ticket | — | Continua |
| Gate fechado | BLOQUEADA | Não |
| Auth inválida | FALHA | Não |
| Discover falhou | FALHA/INCOMPLETA | Não |
| Persistência falhou | FALHA | Não |
| Abort | CANCELADA | Não |

`finally` / `finalizarExecucao` do execution-service preservados.

---

## 8. Isolamento do legado

- Sem ticket → idêntico ao pré-H2.2.1.
- Com ticket + gate fechado → encerra fiscal sem download legado / SEFIN nativo.
- Após início da homologação autorizada (gate teste) → sem fallback legado.
- Sem SEFIN, XML, checkpoint, segundo browser/login.

---

## 9. Limitações

1. Gate fechado em produção — sem descoberta real.
2. `discoverNfse` real não é ligado no execution-service nesta etapa.
3. Playwright em voo (quando H2.2.2-B abrir gate) permanece cooperativo.
4. Lease multi-host: mesmas restrições H2.2.1.

---

## 10. Pré-requisitos H2.2.2-B (execução real)

1. Revisar e abrir gate por mecanismo explícito (não env genérico).
2. Passar `discover: discoverNfse` e `page` autenticada na ponte.
3. Emitir ticket com limites curtos e diretório autorizado.
4. Operar em ambiente controlado com certificado/sessão válidos.
5. Aceitar apenas `CONCLUIDA` + inventário `COMPLETO` + evidências íntegras.
6. Manter SEFIN desligado.

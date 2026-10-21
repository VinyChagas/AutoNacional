# NFS-e Nativo — H2.2.7 Runbook operacional Discovery-Only

**Escopo:** documentação operacional da *primeira* homologação real controlada.  
**Esta etapa NÃO autoriza a execução.** Homologação real só após **autorização humana** no campo final.

Fontes de verdade (código + docs): H2.2.4-A, B1, B2/B2-R1, H2.2.5, auditoria H2.2.6, CLI/`cli-homologacao.ts`, UDS admin, canal H1, ponte, `discovery-only-adapter`, evidências.

> Divergência corrigida neste runbook: B1 descrevia `preparar`/`liberar` como não implementados. **B2+** já os implementa via UDS. Preferir este runbook e H2.2.4-B2 / H2.2.5.

---

## 1. Objetivo

Orientar operadores a executar, **quando autorizados**, o fluxo:

```
admin health/status
→ admin preparar → execucaoId
→ emitir ticket → ativar (individual)
→ consultar
→ admin liberar → PQueue (1×)
→ autenticação existente do worker (certificado/credenciais)
→ ponte consome ticket 1× → Discovery-Only
→ evidências em {diretorioFiscal}/homologacao/
```

Sem SEFIN, sem recuperação XML, sem ativação global de gate.

---

## 2. Pré-requisitos (como verificar — sem executar contra produção neste doc)

| Item | Como verificar (procedimento) |
|------|-------------------------------|
| Instância única | Um único processo Backend com o UDS/store; não subir segundo Backend no mesmo store/socket |
| Filesystem local | Store, socket dir e diretório fiscal em FS local (não NFS compartilhado sem procedimento) |
| Backend operacional | Processo ativo; `GET /health` responde; bootstrap canal + admin não `recusado` |
| Canal administrativo | Env `AUTONACIONAL_HOMOLOGACAO_ADMIN_SOCKET_DIR` + secret file; `admin health` OK |
| Store | Env `AUTONACIONAL_HOMOLOGACAO_STORE`; path absoluto; permissões `0700`; sem symlink |
| Segredo admin | Arquivo via `AUTONACIONAL_HOMOLOGACAO_ADMIN_SECRET_FILE`; modo `0600`; ≥32 chars; **nunca** em argv (`--secret` recusado) |
| Diretório fiscal | Absoluto, distinto de downloads operacionais; gravável pelo uid do Backend |
| Jobs ativos | `GET /health` → `queue.pending` / `queue.running` = 0 (ou apenas jobs conhecidos); `admin status` |
| Certificado A1 | Empresa com certificado disponível no storage configurado (não detalhar segredos) |
| Empresa cadastrada | `empresa-id` existente no Prisma; CNPJ coerente |
| Período | DD/MM/YYYY início ≤ fim (contrato portal) |
| Limites | Definidos na emissão (`max-documentos`, `max-paginas`, `timeout-ms`); SEFIN=0 forçado |

### Variáveis de ambiente (nomes)

| Variável | Papel |
|----------|--------|
| `AUTONACIONAL_HOMOLOGACAO_STORE` | Store de tickets (arquivo) |
| `AUTONACIONAL_HOMOLOGACAO_ADMIN_SOCKET_DIR` | Diretório do socket UDS |
| `AUTONACIONAL_HOMOLOGACAO_ADMIN_SECRET_FILE` | Arquivo do token admin |
| `AUTONACIONAL_HOMOLOGACAO_ADMIN_SECRET` | Apenas não-produção (evitar) |

Socket: `{ADMIN_SOCKET_DIR}/homologacao-admin.sock`.

---

## 3. Checklist pré-execução

Marcar antes de qualquer `preparar` / `emitir` / `liberar` **autorizados**:

- [ ] Autorização humana assinada (seção 12)
- [ ] Uma instância Backend
- [ ] Store e UDS configurados e seguros
- [ ] `admin health` e `admin status` OK
- [ ] Fila idle (`queue.pending`/`running` aceitáveis)
- [ ] Gate global permanece fechado (`gateExecucaoReal: false` no status)
- [ ] Empresa + CNPJ + período + diretório fiscal definidos
- [ ] Limites definidos; `maxRequisicoesSefin` será 0
- [ ] Certificado/credenciais da empresa disponíveis
- [ ] Operador preparado para STOP (seção 6)
- [ ] Plano de reconciliação manual (sem reenqueue automático)

---

## 4. Procedimento (comandos existentes — placeholders)

Todos a partir de `Backend/`:

```bash
npm run homologacao:cli -- <comando> ...
```

Placeholders (fictícios):

| Placeholder | Significado |
|-------------|-------------|
| `/ABS/ADMIN` | Diretório absoluto do UDS (não produção real neste texto) |
| `/ABS/SECRET` | Arquivo absoluto do segredo (nunca colar conteúdo) |
| `/ABS/STORE` | Store absoluto de tickets |
| `/ABS/FISCAL` | Diretório fiscal absoluto para evidências |
| `EMPRESA_ID` | ID numérico da empresa |
| `CNPJ_DEMO` | CNPJ de demonstração (14 dígitos; **não** usar CNPJ real neste doc) |
| `EXEC_ID` | `execucaoId` retornado por `preparar` |
| `AUTH_ID` | `autorizacaoId` retornado por `emitir` |
| `VALIDO_ATE` | ISO-8601 futuro (ex.: `2099-01-01T00:00:00.000Z` em lab) |

### 4.1 Health administrativo

```bash
npm run homologacao:cli -- admin health \
  --socket-dir /ABS/ADMIN \
  --secret-file /ABS/SECRET
```

Esperado: `ok: true`, `data.status: "ok"`.

### 4.2 Status administrativo

```bash
npm run homologacao:cli -- admin status \
  --socket-dir /ABS/ADMIN \
  --secret-file /ABS/SECRET
```

Conferir: `canalHomologacao`, `gateExecucaoReal: false`, `prepararLiberar: true`, `handlersRegistrados: true`, `sefin: false`.

### 4.3 Preparar execução

```bash
npm run homologacao:cli -- admin preparar \
  --socket-dir /ABS/ADMIN \
  --secret-file /ABS/SECRET \
  --empresa-id EMPRESA_ID \
  --cnpj CNPJ_DEMO \
  --periodo-inicio 01/01/2024 \
  --periodo-fim 31/01/2024
```

Opcional: `--tipo DISCOVERY_ONLY` (default), `--tipo-autenticacao certificado|credenciais`.

Esperado: `enfileirado: false`, status `homologacao_preparada`, **sem** navegador/login.

### 4.4 Obter execucaoId

Do JSON de resposta: `data.execucaoId` → usar como `EXEC_ID` em todos os passos seguintes.

### 4.5 Emitir ticket

```bash
npm run homologacao:cli -- emitir \
  --store /ABS/STORE \
  --execucao-id EXEC_ID \
  --cnpj CNPJ_DEMO \
  --periodo-inicio 01/01/2024 \
  --periodo-fim 31/01/2024 \
  --diretorio-fiscal /ABS/FISCAL \
  --valido-ate VALIDO_ATE \
  --motivo "motivo rastreavel da emissao" \
  --max-documentos 50 \
  --max-paginas 20 \
  --timeout-ms 60000
```

Defaults de limites se omitidos: documentos 50, páginas 20, timeout 60000; **`maxRequisicoesSefin` sempre 0**.  
`ativacaoDiscoveryReal` inicia `false`.

### 4.6 Ativar ticket (individual)

```bash
npm run homologacao:cli -- ativar \
  --store /ABS/STORE \
  --autorizacao-id AUTH_ID \
  --motivo "ativacao individual rastreavel"
```

Não abre gate global. Afeta **somente** este ticket.

### 4.7 Consultar ticket

```bash
npm run homologacao:cli -- consultar \
  --store /ABS/STORE \
  --execucao-id EXEC_ID
```

Antes da ponte: `estado: DISPONIVEL`, `ativacaoDiscoveryReal: true`.  
Após ponte bem-sucedida no consumo: `CONSUMIDA`.

### 4.8 Liberar execução

```bash
npm run homologacao:cli -- admin liberar \
  --socket-dir /ABS/ADMIN \
  --secret-file /ABS/SECRET \
  --execucao-id EXEC_ID
```

Esperado: `enfileirado: true`, `ticketConsumido: false`, status `homologacao_liberada`.  
Ticket **ainda não** consumido (consumo na ponte).

### 4.9 Acompanhar resultado

- `GET /health` → `queue` (pending/running)
- Logs do Backend (worker / ponte / discovery)
- Status da execução no Prisma / API de execução existente (`homologacao_liberada` → andamento → conclusão/falha)
- SSE/Socket.IO legados, se já usados operacionalmente (não alterados por H2.2.x)

### 4.10 Inspecionar evidências

```text
/ABS/FISCAL/homologacao/evidencia-h2-{EXEC_ID}-{timestamp}.json
```

Somente leitura: listar diretório, abrir JSON, verificar `execucaoId`, CNPJ mascarado, período, `veredito`, `limitesAplicados`, `efeitosProibidos`, ausência de senha/PFX/token.

Auditoria CLI (store): `{STORE}/_auditoria/cli-audit.jsonl`.

### Cancelamento (se STOP antes da liberação/consumo)

```bash
npm run homologacao:cli -- cancelar \
  --store /ABS/STORE \
  --autorizacao-id AUTH_ID \
  --motivo "stop operacional"
```

---

## 5. Limites

| Limite | Default CLI | Notas |
|--------|-------------|--------|
| `maxDocumentos` | 50 | Orçamento global EMITIDAS+RECEBIDAS |
| `maxPaginas` | 20 | Idem |
| `timeoutMs` | 60000 | Relógio da homologação |
| `maxRequisicoesSefin` | **0** | Forçado; emissão recusa se >0 em DISCOVERY_ONLY |
| `validoAte` | obrigatório na emissão | Expiração do ticket |
| Cancelamento | `cancelar` CLI | Estado `CANCELADA`; não reutilizável |

**Inventário parcial / limite atingido / timeout:** resultado `INCOMPLETA` / veredito `INCOMPLETO` (ou `FALHA`) — **nunca** apresentar como descoberta completa (`CONCLUIDA` / `PASS`).

---

## 6. Critérios STOP (interromper imediatamente)

| Condição | Ação |
|----------|------|
| Instância Backend duplicada | STOP; não liberar |
| Jobs ativos inesperados na PQueue | STOP; não liberar |
| Store/UDS/segredo inseguros | STOP; corrigir permissões offline |
| Ticket divergente (CNPJ/período/id/dir) | STOP; não liberar / não forçar |
| Ticket expirado / cancelado / consumido | STOP |
| UDS indisponível | STOP |
| Falha de autenticação (login) | STOP; não reenqueue automático |
| CAPTCHA não resolvido | STOP |
| HTML inesperado / navegação falha | STOP; coletar evidências se houver |
| Timeout | Tratar como incompleto/falha; STOP reexecução automática |
| Cancelamento | STOP |
| Evidência ausente após descoberta | STOP; marcar não aprovada |
| `homologacao_bloqueada` | STOP; reconciliação manual |
| `homologacao_liberada` sem job confiável | STOP; **não** reenfileirar automaticamente |
| Resultado incerto | STOP; escalar |

**Proibido:** reenfileiramento automático de execução com resultado incerto.

---

## 7. Critérios de sucesso (GO técnico da *execução*, não autorização política)

Só após autorização humana (seção 12):

| Critério | Verificação |
|----------|-------------|
| Autorização individual | `ativacaoDiscoveryReal: true` no ticket usado |
| Ticket consumido 1× | `consultar` → `CONSUMIDA` após ponte |
| Somente DISCOVERY_ONLY | ticket.operacao |
| Zero SEFIN | evidências `efeitosProibidos.sefin: false`; limites SEFIN=0 |
| Zero recuperação XML | `escritaXml: false` / sem checkpoint de recuperação |
| Inventário classificado | `estadoInventario` COMPLETO ou PARCIAL explícito |
| Paginação verificada | páginas nos limites / evidências |
| Evidências persistidas | arquivo `evidencia-h2-*.json` |
| Sem fallback legado | após ticket autorizado, ponte encerra etapa fiscal sem legado |
| Coerência com limites | se limite atingido → **INCOMPLETA**, não CONCLUIDA |

### Estados operacionais (ponte)

| Estado | Significado |
|--------|-------------|
| **CONCLUIDA** | Veredito PASS; inventário completo dentro dos limites |
| **INCOMPLETA** | Parcial, limite, timeout mapeado como incompleto |
| **FALHA** | Erro técnico / evidência / validação |
| **CANCELADA** | AbortSignal / interrupção |
| **BLOQUEADA** | Sem ativação individual (ou gate insuficiente sozinho) |

Estados Prisma admin: `homologacao_preparada` | `homologacao_liberada` | `homologacao_bloqueada`.

---

## 8. Pós-execução

1. Localizar `{diretorioFiscal}/homologacao/evidencia-h2-*.json`.
2. Conferir integridade (arquivo único, sem sobrescrita, campos esperados).
3. Resultado por direção (EMITIDAS / RECEBIDAS) e totais.
4. Quantidade de páginas e documentos vs limites.
5. Situações fiscais classificadas (sem exportar chaves sensíveis em relatório público).
6. Limites atingidos (flags/diagnósticos).
7. Erros / códigos Homologacao.
8. Auditoria CLI no store.
9. Estado final do ticket (`CONSUMIDA` / outros) e da execução Prisma.
10. Relatório interno (modelo seção 11) **sem** CNPJ completo, senha, PFX, XML, cookies.

---

## 9. Recuperação manual

| Situação | Recuperação |
|----------|-------------|
| `preparada` sem payload (reinício) | Não liberar; cancelar ticket se emitido; nova preparação se autorizado |
| `bloqueada` | Investigar logs; **não** liberar/reenfileirar |
| `liberada` sem certeza de job | Inspecionar fila/logs; **não** reenqueue automático |
| Ticket `DISPONIVEL` órfão | `cancelar` com motivo |
| Evidência colidiu / falhou | Não declarar PASS; nova janela só com novo ticket/autorização |

Sem coordenação multi-host: nunca assumir que outro processo “completa” a liberação.

---

## 10. Limitações

- Payload de preparação é in-memory (perdido no restart).
- PQueue compartilhada com fluxo HTTP legado.
- Sem atomicidade Prisma ↔ PQueue.
- Gate global permanece fechado por padrão; ativação é **por ticket**.
- H2.2.5 validou integração **offline** (mocks Prisma/PQueue/discover); Portal real não coberto por aquela etapa.
- Este runbook **não** substitui autorização humana.

---

## 11. Modelo de relatório (pós-run, uso interno)

```text
Data/hora (UTC):
Operador:
Autorização humana (ref.):
execucaoId:
autorizacaoId: (parcial mascarado se necessário)
empresaId:
CNPJ: (mascarado)
Período portal:
Limites: docs= / págs= / timeout= / SEFIN=0
Estado ticket final:
Estado operacional ponte: CONCLUIDA | INCOMPLETA | FALHA | CANCELADA | BLOQUEADA
Enqueue count esperado: 1
Consumo ticket: 1
SEFIN: 0
XML recovery: 0
Evidência path: (relativo/seguro)
Limites atingidos: sim/não
STOP acionado: sim/não — motivo:
Observações (sem dados sensíveis):
```

---

## 12. Autorização humana

Homologação Discovery-Only **real** (Portal / certificado / login) **não** está autorizada apenas por existir este runbook ou pelas etapas H2.2.4–H2.2.6.

| Campo | Preenchimento |
|-------|----------------|
| Autorizo a execução real controlada? | [ ] SIM / [ ] NÃO |
| Nome | |
| Papel | |
| Data/hora | |
| Escopo (empresaId / período / limites) | |
| Instância Backend / host | |
| Observações / restrições | |
| Assinatura / registro | |

Sem `SIM` explícito neste campo: **NO-GO** — não executar `preparar`/`emitir`/`ativar`/`liberar` operacionais nem login/Portal.

---

## Referências

- `docs/NFSE-NATIVO-H2.2.4-A-BOOTSTRAP-CLI.md`
- `docs/NFSE-NATIVO-H2.2.4-B1-CANAL-ADMIN.md` (histórico; preparar/liberar → ver B2)
- `docs/NFSE-NATIVO-H2.2.4-B2-PREPARACAO-LIBERACAO.md`
- `docs/NFSE-NATIVO-H2.2.5-HOMOLOGACAO-INTEGRADA-OFFLINE.md`
- Código: `cli-homologacao.ts`, `preparacao-liberacao.ts`, `ponte-execution-homologacao.ts`, `gate-execucao-real.ts`

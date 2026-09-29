# Migração Database → PostgreSQL VPS (fase de teste)

**Data:** 2026-08-25  
**Objetivo:** preparar a aplicação para testar o PostgreSQL próprio (`vinylab-postgres` / `autonacional`) mantendo Supabase **apenas** como Storage de certificados PFX.  
**Escopo:** código do Backend — sem cutover definitivo, sem migrations na VPS, sem exposição da porta 5432.

---

## Checklist pré-teste (item 19)

| Item | Status |
|------|--------|
| PostgREST removido do acesso a dados | **SIM** |
| Supabase Database ainda acessado (via SDK `.from` / `.rpc`) | **NÃO** |
| Supabase Storage preservado | **SIM** |
| Prisma apontando para `DATABASE_URL` | **SIM** |
| Models necessários adicionados | **SIM** |
| Migration Prisma executada na VPS | **NÃO** |
| Frontend alterado funcionalmente | **NÃO** |
| Risco de split-brain eliminado | **SIM** (todo dado relacional passa só por Prisma) |

**Bloqueio operacional para teste na VPS:** o `.env` local ainda aponta `DATABASE_URL` para o host Supabase (`db.*.supabase.co`). A aplicação está pronta no código; para testar o PostgreSQL da VPS é preciso apontar `DATABASE_URL` para `vinylab-postgres` (container na rede `vinylab_internal`) ou via **SSH tunnel** local — **sem** abrir `0.0.0.0:5432`.

---

## Nova arquitetura de acesso aos dados

```
Angular Frontend
        │
        ▼
Express Backend
   ├── Prisma  ──────────► PostgreSQL VPS (database autonacional, role autonacional_app)
   └── Supabase SDK ─────► Storage (bucket certificados / PFX)
```

- **Não** usar `vinylab_admin` na aplicação.
- **Não** usar PostgREST / `supabase.from()` para tabelas ou views.

---

## Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `Backend/prisma/schema.prisma` | Models novos + relação em Contabilidade |
| `Backend/prisma.config.ts` | Comentário (VPS / DATABASE_URL) |
| `Backend/src/services/automation-metrics.service.ts` | PostgREST → Prisma |
| `Backend/src/services/logs-execucao.service.ts` | PostgREST → Prisma |
| `Backend/src/routers/metrics.ts` | View via `prisma.$queryRaw` |
| `Backend/src/config/env.ts` | Separação DB vs Storage; helpers de log seguro |
| `Backend/src/config/supabase.ts` | Comentários: Storage only |
| `Backend/src/db/client.ts` | Comentário: PostgreSQL próprio |
| `Backend/src/main.ts` | Logs de startup (host/db sem secrets) |
| `Backend/src/routers/config.ts` | `supabaseStorageConfigured` |
| `Backend/src/services/supabase-example.ts` | Removido exemplo PostgREST |
| `Backend/.env.example` | Formato VPS + Storage separado |
| `Backend/package.json` | `prisma` alinhado a 7.x; script `test:smoke-db` |
| `Backend/scripts/smoke-vps-database.mjs` | Smoke read-only |

---

## Models Prisma adicionados

| Model | Tabela física | Notas |
|-------|---------------|--------|
| `ExecucaoLogBatch` | `execucao_log_batch` | FK → `contabilidades` |
| `ExecucaoLogItem` | `execucao_log_item` | FK → `execucao_log_batch` |
| `AutomationExecutionBatch` | `automation_execution_batches` | UUID `gen_random_uuid()` |
| `AutomationExecution` | `automation_executions` | Unique `(batch_id, empresa_id)` |

View `billing_monthly_summary` **não** foi modelada; consulta via `$queryRaw` parametrizado.

**Não** foi executado `prisma migrate` / `db push` contra a VPS.

---

## Chamadas `supabase.from` removidas (produção)

| Antes | Depois |
|-------|--------|
| `automation-metrics.service.ts` → `automation_execution_batches` / `automation_executions` | `prisma.automationExecutionBatch` / `prisma.automationExecution` |
| `logs-execucao.service.ts` → `execucao_log_batch` / `execucao_log_item` | `prisma.execucaoLogBatch` / `prisma.execucaoLogItem` |
| `routers/metrics.ts` → `billing_monthly_summary` | `prisma.$queryRaw` |

`supabase.rpc`: **0** ocorrências (já era o caso).

---

## Chamadas `supabase.storage` preservadas

- `cadastro-certificado.service.ts` — upload
- `import-certificados.service.ts` — download / upload
- `certificate-loader.ts` — download (Playwright)
- `certificado-storage.service.ts` — remove
- `config/supabase.ts` — `ensureCertificadosBucket`

Metadados em `certificados_digitais` continuam no PostgreSQL (Prisma); arquivos PFX no Supabase Storage.

---

## Como configurar `DATABASE_URL`

### Backend na rede Docker `vinylab_internal`

```env
DATABASE_URL=postgresql://autonacional_app:<SENHA>@vinylab-postgres:5432/autonacional?schema=public
```

### Desenvolvimento local (sem expor 5432 publicamente)

Use SSH tunnel, por exemplo:

```bash
ssh -N -L 5433:vinylab-postgres:5432 user@sua-vps
```

```env
DATABASE_URL=postgresql://autonacional_app:<SENHA>@127.0.0.1:5433/autonacional?schema=public
```

Storage (inalterado nesta fase):

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
CERT_STORAGE_BUCKET=certificados
CRYPTO_KEY=...
# USE_SUPABASE=true  → valida apenas Storage (não o banco)
```

**Não** versionar senhas / `.env` / service role key.

---

## Como executar o Backend para teste

```bash
cd Backend
# 1) Ajuste DATABASE_URL no .env para a VPS (Docker ou tunnel)
# 2) Mantenha variáveis de Supabase Storage
npm install
npx prisma generate   # se necessário
npm run test:smoke-db # smoke somente leitura
npm run dev           # API em http://localhost:4321
```

Logs esperados na subida (sem password / connection string):

```
Database: PostgreSQL próprio conectado
Database host: vinylab-postgres   # ou 127.0.0.1 via tunnel
Database: autonacional
Supabase Storage: conectado
```

---

## Como executar o Frontend

Sem alterações funcionais. Continua consumindo a API Express / SSE / Socket.IO:

```bash
cd Frontend
npm start
# ou o script habitual do projeto (ex.: ng serve na porta configurada)
```

---

## Testes realizados

| Teste | Resultado |
|-------|-----------|
| `npm test` (Vitest) | **122/122 OK** (15 arquivos) |
| `npx tsc --noEmit` | **OK** |
| `npm run test:smoke-db` | **OK** (somente leitura) |
| Contagens smoke (via DATABASE_URL atual) | empresas=323, certificados=374, execucoes=3949, automation_executions=5393, view billing OK |

**Observação:** o smoke local rodou contra o host ainda configurado no `.env` (Supabase). Isso valida os models Prisma e as queries; **não** substitui o smoke com `DATABASE_URL` apontando para a VPS.

Não executados (conforme pedido): Playwright NFSe em lote, exclusões massivas, uploads de certificados, automações destrutivas.

---

## Erros encontrados

1. **Desalinhamento Prisma CLI 6 vs Client 7** — `postinstall` / `prisma generate` falhavam sem `url` no schema (estilo Prisma 7). **Correção:** `prisma` em `package.json` alinhado a `^7.4.0`.
2. **Tipo Json `null` em `execucao_log_batch`** — corrigido com `Prisma.DbNull`.
3. **Bug no smoke** — `assertOk('conexão Prisma')` sem condição; corrigido.

---

## Pendências

1. Atualizar `DATABASE_URL` local/servidor para `autonacional_app` @ `vinylab-postgres` (ou tunnel).
2. Rodar `npm run test:smoke-db` **depois** de apontar para a VPS.
3. Teste manual de UI: Dashboard, Empresas, Contabilidades, Credenciais, Certificados, Histórico, Logs, Métricas, Rentabilidade, Configurações, SSE, Socket.IO.
4. Migração futura do Storage (fora desta fase).
5. Cutover definitivo e desligamento do Supabase Database (ainda **não** autorizado).

---

## Riscos restantes

| Risco | Mitigação |
|-------|-----------|
| `.env` ainda no Supabase DB | Trocar `DATABASE_URL` antes do teste VPS |
| Drift Prisma vs tabelas não modeladas | Models adicionados só para o que era PostgREST; demais tabelas já usadas via Prisma |
| Storage ainda no Supabase | Intencional nesta fase |
| Teste local sem tunnel | Documentado; sem abrir firewall/5432 |

---

## APLICACÃO PRONTA PARA TESTE MANUAL: **SIM** (código)

**Com ressalva:** para o teste ser contra o PostgreSQL da VPS, atualize `DATABASE_URL` (rede Docker ou SSH tunnel) e rode `npm run test:smoke-db` novamente. Até lá, o Backend usará o host definido no `.env` atual via Prisma (já sem PostgREST — sem split-brain).

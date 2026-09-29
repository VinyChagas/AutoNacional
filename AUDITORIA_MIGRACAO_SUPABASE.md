# Auditoria de Migração Supabase → PostgreSQL Próprio

**Data da auditoria:** 2026-08-25 (atualizado)  
**Escopo:** Repositório AutoNacional (`Backend/` + `Frontend/`)  
**Projeto Supabase:** `sabqvvgaracqouyzxdgb`  
**Tipo:** Análise read-only — nenhuma alteração foi feita no código, banco Supabase ou infraestrutura VPS.

> **Status da auditoria:** **FINALIZADA** — este documento é o entregável completo solicitado.  
> **Status operacional:** Fase 1 (backup local) concluída; **nenhuma migração executada.** Aguardando autorização para Fase 2.

---

## Resumo executivo

```
Projeto:                    AutoNacional (automação NFSe)
Stack:                      Angular 17 (Frontend) + Node.js/Express/TypeScript (Backend) + Prisma 7 + Playwright
Banco atual:                PostgreSQL 15 (Supabase hosted)
Destino planejado:          PostgreSQL 18.6 (Docker, container vinylab-postgres, rede vinylab_internal)
Uso Supabase Database:      SIM (via Prisma + PostgREST parcial)
Uso Supabase Auth:          NÃO (0 usuários em auth.users; variáveis preparadas mas não usadas)
Uso Supabase Storage:       SIM (bucket `certificados` — 479 objetos, ~2,4 MB)
Uso Supabase Realtime:      NÃO
Uso Edge Functions:         NÃO
Uso RLS:                    SIM (parcial — 2 tabelas com policies; 17 sem RLS)
Uso RPC:                    NÃO
Backend próprio:            SIM (Express API na porta 4321)
Frontend acessa Supabase diretamente: NÃO
Quantidade aproximada de tabelas: 19 (schema public) + 1 view
Quantidade aproximada de registros: 10.448 (schema public)
Tamanho aproximado do banco: 17 MB (+ ~2,4 MB Storage)
Backup Fase 1:              SIM (dumps locais em Backend/dumps/, fora do git)
Complexidade estimada da migração: MODERADA
```

**Conclusão em uma frase:** ~90% dos dados já passam por Prisma/PostgreSQL direto; o bloqueador principal continua sendo o **Supabase Storage** (certificados PFX) e **6 arquivos do backend** que usam PostgREST via SDK. O Frontend não precisa de mudanças funcionais. A VPS já possui PostgreSQL 18.6 — **não criar nova instância**; apenas database, role e objetos dedicados ao projeto.

---

## 1. Arquitetura atual

### Stack

| Camada | Tecnologia |
|--------|------------|
| **Frontend** | Angular 17, TypeScript 5.4, Tailwind CSS, RxJS, Socket.IO client, Chart.js |
| **Backend** | Node.js ≥18, Express 4, TypeScript 5.9, Pino (logs) |
| **ORM** | Prisma 7 + `@prisma/adapter-pg` |
| **Automação** | Playwright (Chromium), fila in-process `p-queue` |
| **Tempo real** | SSE (`EventSource`) + Socket.IO (captcha manual) — **não usa Supabase Realtime** |
| **Banco** | PostgreSQL (Supabase) via `DATABASE_URL` |
| **Storage** | Supabase Storage (bucket `certificados`) + disco local legado |

### Estrutura do repositório

```
AutoNacional/
├── Frontend/          # Angular SPA (porta 1234 dev)
├── Backend/           # API Node.js (porta 4321)
│   ├── src/           # Código TypeScript
│   ├── prisma/        # Schema Prisma + 2 migrations
│   ├── supabase/      # 1 migration SQL (métricas)
│   ├── dumps/         # Backup Fase 1 (gitignored — dados sensíveis)
│   └── scripts/       # dump-supabase.mjs, fase1-backup.mjs, export-storage
├── AUDITORIA_MIGRACAO_SUPABASE.md
└── docs/
```

### Diagrama de arquitetura (atual)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Angular)                        │
│  HttpClient → environment.apiUrl (/api)                         │
│  SSE → /api/execucao/stream, /api/validacoes/stream             │
│  Socket.IO → captcha manual                                     │
│  ❌ Sem @supabase/supabase-js                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP REST / SSE / WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Express/Node.js)                    │
│  Prisma (~90%)          │  Supabase JS (Storage + PostgREST)    │
└────────────┬────────────┴──────────────────┬────────────────────┘
             ▼                               ▼
    PostgreSQL (Supabase)          Supabase Storage (certificados)
```

### Diagrama alvo (após migração completa)

```
Frontend → Backend API → PostgreSQL 18.6 (VPS, database autonacional)
                       → Object Storage na VPS (substituto do Supabase Storage)
                       → Disco local (downloads, logs, temp)
```

### Comunicação Frontend ↔ Backend

- **REST JSON/FormData:** todos os serviços Angular usam `${environment.apiUrl}/...`
- **SSE:** progresso de execução NFSe e validações em lote
- **Socket.IO:** Central de Captchas
- **Sem auth de aplicação:** rotas abertas, sem JWT/Bearer no Frontend

### Arquivos de configuração Supabase

| Arquivo | Função |
|---------|--------|
| `Backend/src/config/supabase.ts` | Cliente principal (`createClient`, singleton, bucket bootstrap) |
| `Backend/src/lib/supabase.ts` | Duplicata — **código morto** (zero imports) |
| `Backend/src/config/env.ts` | Validação de env quando `USE_SUPABASE=true` |
| `Backend/src/infrastructure/config.ts` | Exporta constantes `SUPABASE_*` |
| `Backend/.env.example` | Template de variáveis |

---

## 2. Uso do Supabase no código

### 2.1 `@supabase/supabase-js` / `createClient`

| Arquivo | Finalidade | Camada | Dificuldade |
|---------|------------|--------|-------------|
| `Backend/src/config/supabase.ts` | Cliente service role, `ensureCertificadosBucket()` | Backend | Média |
| `Backend/src/lib/supabase.ts` | Duplicata não utilizada | Backend | Baixa (remover) |
| `Backend/src/services/supabase-example.ts` | Exemplos/documentação | Backend | Baixa (remover) |

**Frontend:** nenhuma ocorrência.

### 2.2 `supabase.storage` (Storage)

| Arquivo | Operação | Finalidade | Dificuldade |
|---------|----------|------------|-------------|
| `cadastro-certificado.service.ts` | `upload` | Cadastro de certificado PFX | **Alta** |
| `import-certificados.service.ts` | `download`, `upload` | Importação/substituição em lote | **Alta** |
| `certificate-loader.ts` | `download` | Carrega PFX para Playwright | **Alta** |
| `certificado-storage.service.ts` | `remove` | Exclusão de certificado | **Alta** |
| `config/supabase.ts` | `listBuckets`, `createBucket` | Bootstrap do bucket na startup | Média |

### 2.3 `supabase.from` (PostgREST)

| Arquivo | Tabela/View | Finalidade | Dificuldade |
|---------|-------------|------------|-------------|
| `automation-metrics.service.ts` | `automation_execution_batches`, `automation_executions` | Métricas (Painel Rentabilidade) | Média |
| `logs-execucao.service.ts` | `execucao_log_batch`, `execucao_log_item` | Logs de lote | Média |
| `routers/metrics.ts` | `billing_monthly_summary` | Resumo mensal de billing | Média |

### 2.4 Não utilizado

| Recurso | Status |
|---------|--------|
| `supabase.auth.*` | Variáveis JWT definidas; **zero chamadas** |
| `supabase.rpc.*` | **Não utilizado** |
| `supabase.channel.*` | **Não utilizado** |
| Edge Functions | **Inexistentes** |
| `SUPABASE_ANON_KEY` | **Não configurada** |

### 2.5 Referências indiretas (Frontend)

| Arquivo | Propósito | Dificuldade |
|---------|-----------|-------------|
| `automation-settings.model.ts` | Campo `supabaseConfigured: boolean` | Baixa |
| `configuracoes.component.html` | Badge "Supabase" | Baixa |

---

## 3. Banco de dados

### 3.1 Schemas (origem Supabase)

| Schema | Uso | Migrar para VPS? |
|--------|-----|------------------|
| `public` | Dados da aplicação (19 tabelas + 1 view) | **Sim** |
| `auth` | Supabase Auth (0 usuários) | **Não** |
| `storage` | Metadados do Storage Supabase | **Não** (substituir por storage próprio) |

### 3.2 Tabelas do schema `public`

| Tabela | Registros | Finalidade aparente |
|--------|-----------|---------------------|
| `contabilidades` | 2 | Escritórios de contabilidade |
| `empresas` | 323 | Empresas clientes |
| `credenciais` | 39 | Login CNPJ/CPF + senha criptografada |
| `certificados_digitais` | 374 | Metadados PFX (path no Storage) |
| `settings` | 1 | Configurações globais de automação |
| `execucoes` | 3.949 | Histórico de execuções NFSe |
| `execucao_batch_log` | 0 | Log Prisma — **não usado em produção** |
| `execucao_log_batch` | 7 | Log de lote (Supabase JS) |
| `execucao_log_item` | 173 | Itens de log por empresa |
| `automation_execution_batches` | 181 | Lotes de execução (métricas) |
| `automation_executions` | 5.393 | Execuções consolidadas (métricas) |
| `agendamentos_execucao` | 1 | Agendamentos (sem worker implementado) |
| `status_operacional_empresa` | 0 | Status operacional |
| `lacunas_execucao_empresa` | 0 | Lacunas de execução |
| `notas_fiscais_servico` | 0 | Notas fiscais (estrutura pronta) |
| `notas_fiscais_eventos` | 0 | Eventos de NF |
| `notificacoes` | 0 | Notificações |
| `nfse_job_log` | 2 | Log de jobs NFSe |
| `_prisma_migrations` | 3 | Controle Prisma |

**Total:** 10.448 registros | **Tamanho:** 17 MB

### 3.3 View

| View | Finalidade |
|------|------------|
| `billing_monthly_summary` | Agregação mensal para Painel de Rentabilidade |

### 3.4–3.10 Estruturas

- **PKs:** SERIAL/UUID conforme tabela (detalhes no dump Fase 1)
- **FKs:** 8 foreign keys declaradas (ver seção 3.5 original)
- **Índices:** 46 no schema `public`
- **Sequences:** 19 (`{tabela}_id_seq`)
- **Functions/triggers/enums customizados:** nenhum

### 3.11 Extensões PostgreSQL (necessárias na VPS)

| Extensão | Usada pela app? | Ação na VPS |
|----------|-----------------|-------------|
| `pgcrypto` | **Sim** (`gen_random_uuid()` em `automation_*`) | `CREATE EXTENSION` no database do projeto |
| `plpgsql` | Sim (padrão) | Já presente |
| `uuid-ossp` | Opcional | Recomendado instalar por compatibilidade |
| `pg_stat_statements` | Não (app) | Opcional (monitoramento infra) |
| `supabase_vault` | **Não** | Não instalar |

### 3.12 Drift Prisma ↔ Banco real

- **Prisma:** 8 models | **Banco:** 19 tabelas
- **10 tabelas** existem no banco sem model Prisma correspondente

---

## 4. Row Level Security (RLS)

- **Com RLS:** `automation_execution_batches`, `automation_executions` (2 policies SELECT para `authenticated`, sem `auth.uid()`)
- **Sem RLS:** 17 tabelas em `public`
- **Impacto na VPS:** **nenhum** — backend usa conexão direta Prisma; RLS Supabase não precisa ser recriado
- **Recomendação:** controle de acesso na camada Express, não via RLS PostgreSQL

---

## 5. Supabase Auth

**Não utilizado.** 0 usuários em `auth.users`. Impacto de remoção: **BAIXO**.

---

## 6. Supabase Storage

| Aspecto | Detalhe |
|---------|---------|
| Bucket | `certificados` (privado) |
| Objetos | 479 arquivos (~2,35 MB) — **backup Fase 1 concluído** |
| Path pattern | `contabilidade/{id}/empresa/{cnpj}/certs/{timestamp}.pfx` |
| Coluna no banco | `certificados_digitais.arquivo` |

**Permanece no Supabase** até conclusão da Fase 5 (substituição de storage).

---

## 7. Realtime

| Padrão buscado | Ocorrências no código |
|----------------|----------------------|
| `supabase.channel` | **0** |
| `postgres_changes` | **0** |
| `subscribe` (Supabase) | **0** |
| `realtime` (Supabase) | **0** |

**Conclusão:** nenhuma funcionalidade depende de Supabase Realtime.

Tempo real implementado pelo Backend via:
- **SSE** — `execution-events.service.ts` (`/api/execucao/stream/:batchId`, `/api/validacoes/stream/:jobId`)
- **Socket.IO** — `infrastructure/socket.ts` (Central de Captchas manual)

**Impacto na migração:** nulo.

---

## 8. Edge Functions

| Padrão buscado | Ocorrências |
|----------------|-------------|
| `supabase/functions/` | **Pasta inexistente** |
| `functions.invoke` | **0** |
| Código Deno | **0** |

**Conclusão:** nenhuma Edge Function. Impacto na migração: nulo.

---

## 9. RPC e funções PostgreSQL

| Recurso | Status |
|---------|--------|
| `supabase.rpc()` no código de produção | **0 chamadas** |
| `CREATE FUNCTION` / `CREATE OR REPLACE FUNCTION` em `public` | **Nenhuma** |
| Funções PG invocadas pela aplicação | **Nenhuma** |

Comentário em `Backend/src/config/supabase.ts` menciona RPC apenas como exemplo documentado.

**Impacto na migração:** nulo.

---

## 10. Migrations

| Fonte | Qtd | Completude |
|-------|-----|------------|
| Prisma | 2 | Incompleto (init ausente) |
| Supabase CLI | 1 | Parcial (métricas + view) |
| Dump Fase 1 | 3 arquivos | Referência principal para migração |

**Reconstruir só pelas migrations versionadas: NÃO.** Usar dumps da Fase 1 + SQL da view.

> **Limitação do dump de schema Fase 1:** `supabase_schema_20260825.sql` contém tabelas e índices, mas **não inclui PRIMARY KEY, FOREIGN KEY nem CHECK constraints** explicitamente. Na migração, complementar com DDL das FKs documentadas neste relatório ou gerar dump via `pg_dump --schema-only` quando disponível.

---

## 11. Acesso direto ao PostgreSQL

| Mecanismo | Uso |
|-----------|-----|
| Prisma + pg adapter | ~90% dos dados |
| Supabase JS PostgREST | 4 áreas |
| pg (scripts) | Dump Fase 1 |

---

## 12. Dependências específicas do Supabase

| Dependência | Classificação |
|-------------|---------------|
| `DATABASE_URL` → PG Supabase | 🟢 Fácil |
| Prisma | 🟢 Fácil |
| PostgREST via SDK | 🟡 Adaptação |
| Supabase Storage | 🔴 Substituição |
| Auth / Realtime / Edge / RLS / RPC | 🟢 Fácil ou N/A |

---

## 13. Fluxo de acesso aos dados

**Frontend → Supabase diretamente: NÃO.** Toda comunicação passa pelo Backend Express.

---

## 14. Arquivos e anexos

| Tipo | Armazenamento atual |
|------|---------------------|
| Certificados PFX | Supabase Storage (+ backup local Fase 1) |
| PDF/XML NFSe | Disco local (`downloads_base_path`) |
| Planilhas Excel | Memória (não persiste) |
| Logs/screenshots | Disco local |

---

## 15. Jobs e automações

Fila `p-queue` in-process; SSE; Socket.IO. Agendamentos têm tabela mas **sem worker**. Nenhum pg_cron ou webhook Supabase.

---

## 16. Variáveis de ambiente (nomes apenas)

### Deixarão de existir (após migração completa)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL`, `SUPABASE_AUDIENCE`, `SUPABASE_ISSUER`, `USE_SUPABASE`, `CERT_STORAGE_BUCKET`

### Permanecem / são alteradas

| Variável | Alteração na migração |
|----------|----------------------|
| `DATABASE_URL` | Apontar para database `autonacional` na VPS |
| `CRYPTO_KEY`, `APP_CRED_KEY`, `FERNET_KEY` | Mantém (obrigatório para credenciais) |
| `PORT`, `CORS_ORIGINS` | Mantém |
| *(novo)* `STORAGE_BACKEND` / `STORAGE_LOCAL_PATH` | Quando Storage sair do Supabase |

### Frontend

`production`, `apiUrl`, `captchaDebug` — sem alteração funcional.

---

## 17. Compatibilidade PostgreSQL 18.6 (VPS)

| Aspecto | Avaliação |
|---------|-----------|
| Extensões (`pgcrypto`, `uuid-ossp`) | Compatível |
| SQL da aplicação | Compatível |
| SERIAL / UUID / JSONB | Compatível |
| Origem PG 15 (Supabase) → PG 18.6 | Compatível para este schema |

**Classificação: MODERADA** (complexidade está no Storage e refatoração SDK, não no PostgreSQL).

---

## 18. Estratégia sugerida de migração (NÃO EXECUTAR sem autorização)

### Fase 1 — Backup e inventário ✅ CONCLUÍDA

- [x] Dump schema + dados + views
- [x] Export Storage (479/479 arquivos)
- [x] Manifest e inventário (`Backend/dumps/FASE1_*`)
- [x] Pasta `Backend/dumps/` no `.gitignore`

### Fase 2 — Preparar database na VPS (infra existente)

> **Não criar nova instância PostgreSQL.** Usar container `vinylab-postgres`, volume `vinylab_postgres_data`, rede `vinylab_internal`. Executar apenas criação de database, role, extensões e permissões (seção 21).

### Fase 3 — Schema no database `autonacional`

- Aplicar DDL (dump schema + FKs + view)
- Validar sequences e índices

### Fase 4 — Dados

- Importar `supabase_data_20260825.sql`
- Validar contagens (10.448 registros esperados)
- Ajustar sequences (`setval`)

### Fase 5 — Storage

- Substituir Supabase Storage (479 PFX)
- Refatorar 5 arquivos `supabase.storage.*`

### Fase 6 — Backend (PostgREST → Prisma)

- Migrar 3 services + 1 router
- Remover `@supabase/supabase-js` quando Storage também migrar

### Fase 7–9 — Auth (opcional), testes, cutover

Conforme auditoria original.

---

## 19. Riscos

| Risco | Nível |
|-------|-------|
| Perda de certificados PFX | 🔴 Crítico (mitigado pelo backup Fase 1) |
| Schema dump sem PKs/FKs completos | 🔴 Crítico — complementar DDL na Fase 3 |
| Schema incompleto no repo (init ausente) | 🔴 Crítico |
| Automação NFSe quebrar (Storage) | 🟠 Alto |
| Drift Prisma (10 tabelas) | 🟠 Alto |
| Porta 5432 não exposta — app precisa mesma rede Docker | 🟡 Médio |
| PG compartilhado entre projetos — isolamento por database/role | 🟡 Médio |
| Duplicidade de logs | 🟡 Médio |
| Frontend quebrar | 🟢 Baixo |

---

## 20. Informações necessárias para planejar a migração

Itens **já determinados** durante a auditoria:

- [x] VPS disponível (Ubuntu, Docker, Docker Compose)
- [x] PostgreSQL 18.6 rodando (`vinylab-postgres`, healthy)
- [x] Backup Fase 1 concluído
- [x] Infra compartilhada — **não** criar novo container PG

Itens que **ainda precisam ser definidos** (sem solicitar credenciais neste momento):

1. **Confirmação dos nomes** `autonacional` / `autonacional_app` (ou nomes preferidos)
2. **Como o Backend alcançará o PostgreSQL:** container na rede `vinylab_internal` vs túnel vs host interno
3. **Estratégia de Storage pós-migração:** disco local na VPS vs MinIO/S3
4. **Migration init ausente** no repo — confirmar se dump Fase 1 é fonte oficial
5. **Janela de cutover** e se haverá sync incremental ou big-bang
6. **Worker de agendamentos** — migrar tabela vazia/1 registro agora ou depois
7. **Política de backup** do database `autonacional` na VPS (pg_dump cron)
8. **Reconciliação Prisma schema** — fazer na Fase 6 ou antes

---

## 21. Plano de recursos PostgreSQL na VPS (infraestrutura existente)

Esta seção descreve **o que precisa ser criado** no PostgreSQL já provisionado. Todas as operações abaixo devem ser executadas pelo administrador (`vinylab_admin`) **conectado ao container `vinylab-postgres`**. Nenhum SQL desta seção deve ser executado automaticamente sem sua autorização.

### 21.1 Contexto da infraestrutura informada

| Item | Valor |
|------|-------|
| SO | Ubuntu Linux |
| Orquestração | Docker + Docker Compose |
| Container PostgreSQL | `vinylab-postgres` |
| Versão PostgreSQL | 18.6 |
| Volume persistente | `vinylab_postgres_data` |
| Rede Docker | `vinylab_internal` |
| Porta 5432 | **Não exposta publicamente** |
| Admin existente | `vinylab_admin` |
| Modelo | PG compartilhado; **1 database + 1 role por projeto** |

**Restrição explícita:** não criar nova instância PostgreSQL nem novo `docker-compose` para banco.

### 21.2 Recursos a criar para o AutoNacional

| Recurso | Nome sugerido | Justificativa |
|---------|---------------|---------------|
| **Database** | `autonacional` | Nome do projeto; isolado de outros databases na mesma instância |
| **Role/usuário da aplicação** | `autonacional_app` | Padrão `{projeto}_app`; usado exclusivamente pelo Backend |
| **Role de migração (opcional)** | `autonacional_migrate` | Apenas se quiser separar DDL (deploy) de runtime; pode usar `autonacional_app` com privilégios elevados temporariamente |
| **Schema** | `public` (default) | Toda a aplicação usa apenas `public` — **não** migrar schemas `auth` ou `storage` do Supabase |

> Os nomes acima são sugestões. Podem ser ajustados desde que mantenham isolamento por projeto.

### 21.3 Extensões PostgreSQL necessárias

Executar **dentro do database `autonacional`**:

```sql
-- Obrigatórias
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() usado em automation_*

-- Recomendadas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- compatibilidade; Supabase tinha instalada
```

**Não instalar:** `supabase_vault` (específica Supabase).

### 21.4 Schemas necessários

| Schema | Ação |
|--------|------|
| `public` | Usar o schema default; todas as 19 tabelas + 1 view |
| `auth` | **Não criar** |
| `storage` | **Não criar** |

Nenhum schema adicional (`app`, `audit`, etc.) é exigido pelo código atual.

### 21.5 Permissões necessárias

Executar como `vinylab_admin` após criar database e role:

```sql
-- Exemplo de permissões mínimas para autonacional_app
GRANT CONNECT ON DATABASE autonacional TO autonacional_app;
GRANT USAGE ON SCHEMA public TO autonacional_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO autonacional_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO autonacional_app;

-- Objetos criados no futuro (migrations)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autonacional_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO autonacional_app;
```

**Permissões adicionais:**

| Objeto | Permissão | Motivo |
|--------|-----------|--------|
| View `billing_monthly_summary` | SELECT | Router de métricas |
| Sequences (19) | USAGE, SELECT | INSERT com SERIAL |
| Tabelas com UUID default | — | `gen_random_uuid()` via extensão no database |

**RLS:** não habilitar na VPS para este projeto (autorização fica no Backend).

**Observação de rede:** como a porta 5432 não é pública, o container/processo do Backend AutoNacional precisará estar na rede `vinylab_internal` ou ter rota interna equivalente para alcançar `vinylab-postgres`.

### 21.6 Migrations / schema a executar (ordem recomendada)

| Ordem | Artefato | Origem | Observação |
|-------|----------|--------|------------|
| 1 | Criar database + role + extensões | DDL admin (seção 21.2–21.3) | Executar como `vinylab_admin` |
| 2 | `supabase_schema_20260825.sql` | `Backend/dumps/` | 19 tabelas + índices |
| 3 | DDL complementar PKs/FKs | Este relatório + dump Supabase | **Obrigatório** — dump Fase 1 não inclui todas as constraints |
| 4 | `20260221000000_automation_execution_metrics.sql` | `Backend/supabase/migrations/` | Referência para FK `automation_executions.batch_id`, índices e comentários |
| 5 | `supabase_views_20260825.sql` | `Backend/dumps/` | View `billing_monthly_summary` |
| 6 | `supabase_data_20260825.sql` | `Backend/dumps/` | 10.448 INSERTs |
| 7 | Ajuste de sequences | Script pós-import | Evitar conflito de IDs em novos INSERTs |

**FKs a garantir na Fase 3** (presentes no Supabase, ausentes no dump simplificado):

```text
empresas.contabilidade_id           → contabilidades.id
credenciais.empresa_id              → empresas.id
certificados_digitais.contabilidade_id → contabilidades.id
execucoes.empresa_id                → empresas.id
execucao_batch_log.contabilidade_id → contabilidades.id
execucao_log_batch.contabilidade_id → contabilidades.id
execucao_log_item.batch_log_id      → execucao_log_batch.id
automation_executions.batch_id      → automation_execution_batches.id
```

**Migrations Prisma no repo (incompletas — não suficientes sozinhas):**

- `20260214194500_add_senha_criptografada_certificado`
- `20260216000000_add_credencial_ultima_mensagem`
- Init `20260213012154_init_supabase` — **ausente**

**Recomendação:** tratar dumps Fase 1 como fonte canônica de schema/dados; usar migrations versionadas apenas como referência cruzada.

### 21.7 Estratégia para importar os dados

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Criar database autonacional + role + extensões           │
│ 2. Aplicar schema (tabelas, índices, PKs, FKs)              │
│ 3. Aplicar view billing_monthly_summary                     │
│ 4. Importar supabase_data_20260825.sql                      │
│    (SET session_replication_role = replica — já no dump)    │
│ 5. Validar contagens por tabela (esperado: 10.448 total)    │
│ 6. Executar setval em sequences críticas                    │
│ 7. Smoke test: SELECT 1, contagem empresas=323, etc.        │
└─────────────────────────────────────────────────────────────┘
```

**Validação pós-import (consultas sugeridas):**

| Verificação | Valor esperado |
|-------------|----------------|
| `count(*)` em `empresas` | 323 |
| `count(*)` em `automation_executions` | 5.393 |
| `count(*)` em `execucoes` | 3.949 |
| `count(*)` em `certificados_digitais` | 374 |
| Soma total registros | 10.448 |

**Sequences:** após import, executar `setval` para cada `{tabela}_id_seq` com `MAX(id)` correspondente (especialmente `empresas`, `execucoes`, `certificados_digitais`).

**Downtime:** import de 17 MB é rápido; risco principal é divergência se Supabase continuar recebendo writes durante import — preferir janela sem execuções ativas ou sync final antes do cutover.

### 21.8 Alterações necessárias na aplicação

#### Fase 2 (somente banco na VPS — Supabase Storage ainda ativo)

| Componente | Alteração |
|------------|-----------|
| `DATABASE_URL` | Apontar para `autonacional` na VPS (host interno `vinylab-postgres` ou equivalente na rede Docker) |
| Prisma | Nenhuma alteração de schema obrigatória imediata |
| Supabase SDK | **Permanece** para Storage e PostgREST nas 4 áreas |
| Frontend | **Nenhuma** alteração |
| Docker Backend | Se deploy containerizado, adicionar à rede `vinylab_internal` |

#### Fases subsequentes (migração completa)

| Componente | Alteração |
|------------|-----------|
| `automation-metrics.service.ts` | Trocar `supabase.from()` → Prisma |
| `logs-execucao.service.ts` | Trocar `supabase.from()` → Prisma |
| `routers/metrics.ts` | Trocar query Supabase → Prisma/`$queryRaw` na view |
| 5 arquivos Storage | Abstrair para storage local/S3; remover `supabase.storage.*` |
| `config/supabase.ts`, `main.ts` | Remover bootstrap bucket |
| `package.json` | Remover `@supabase/supabase-js` quando Storage migrar |
| `prisma/schema.prisma` | Adicionar 10 models faltantes (reconciliação) |
| `routers/config.ts` + Frontend | Renomear `supabaseConfigured` → `dbConfigured` |
| `.env.example` | Remover vars Supabase; documentar `DATABASE_URL` VPS |

### 21.9 Dependências que permaneceriam no Supabase

Cenário **após Fase 2** (banco na VPS, resto ainda no Supabase):

| Recurso Supabase | Permanece? | Até quando |
|------------------|------------|------------|
| **PostgreSQL Supabase** | Não (substituído pela VPS) | Após cutover Fase 2 |
| **Supabase Storage** (`certificados`) | **Sim** | Até Fase 5 — automação ainda baixa PFX do bucket |
| **PostgREST via SDK** | **Sim** | Até Fase 6 — métricas/logs ainda podem escrever no Supabase PG **ou** na VPS após apontar SDK (não recomendado; migrar para Prisma) |
| **Supabase Auth** | Não usado | — |
| **Supabase Realtime** | Não usado | — |
| **Projeto Supabase (console)** | **Sim** | Até cutover final + confirmação Storage migrado |

> **Estado híbrido temporário (Fase 2):** dados relacionais na VPS + certificados ainda no Supabase Storage. Funciona se `DATABASE_URL` apontar para VPS e vars `SUPABASE_*` permanecerem para Storage/PostgREST. Porém, após Fase 2, **métricas e logs via SDK escreveriam no PG Supabase**, não na VPS — exige migrar esses services para Prisma **junto com** ou **logo após** Fase 2 para evitar split-brain de dados.

**Recomendação:** na autorização da Fase 2, incluir também refatoração imediata dos 3 arquivos PostgREST para Prisma, mantendo Supabase **apenas** para Storage até Fase 5.

### 21.10 `DATABASE_URL` na VPS (formato, sem credenciais)

Formato esperado para o Backend (valores a preencher na execução autorizada):

```text
postgresql://autonacional_app:<SENHA>@vinylab-postgres:5432/autonacional?schema=public
```

- **Host:** nome do container na rede Docker (`vinylab-postgres`) ou hostname interno equivalente
- **Porta:** 5432 (interna à rede Docker)
- **Database:** `autonacional`
- **User:** `autonacional_app`
- **SSL:** avaliar se necessário dentro da rede interna (geralmente `sslmode=disable` em rede privada Docker)

---

## 22. Backup Fase 1 — inventário de artefatos locais

| Artefato | Conteúdo |
|----------|----------|
| `Backend/dumps/supabase_schema_20260825.sql` | 19 tabelas + índices |
| `Backend/dumps/supabase_data_20260825.sql` | 10.448 registros |
| `Backend/dumps/supabase_views_20260825.sql` | 1 view |
| `Backend/dumps/storage-certificados_20260825/` | 479 PFX + `manifest.json` |
| `Backend/dumps/FASE1_MANIFEST_20260825.json` | Manifest machine-readable |
| `Backend/dumps/FASE1_INVENTARIO_20260825.md` | Inventário legível |

Scripts reutilizáveis: `npm run migration:fase1` (em `Backend/`).

---

## Regra final

**Nenhuma alteração foi feita no projeto (código), no Supabase ou na VPS durante esta auditoria.**

A Fase 1 gerou backups **locais** e scripts auxiliares; a execução da Fase 2 (criação de database, import de schema/dados na VPS) **aguarda autorização explícita**.

---

*Relatório finalizado em 2026-08-25. Próximo passo sugerido após autorização: Fase 2 — criar database `autonacional` e role `autonacional_app` no container `vinylab-postgres`, seguido de import schema/dados.*

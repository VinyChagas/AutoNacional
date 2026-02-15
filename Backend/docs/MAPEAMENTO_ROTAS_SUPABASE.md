# Mapeamento: Rotas API ↔ Supabase (PostgreSQL)

Este documento descreve como as rotas do backend Node.js se vinculam às tabelas do banco de dados Supabase.

**Data:** 12/02/2026  
**Status:** Todas as rotas utilizam Prisma → PostgreSQL (Supabase)

---

## Visão geral

O backend utiliza **Prisma** como ORM, conectado ao PostgreSQL do Supabase via `DATABASE_URL`. Todas as operações passam pelos **repositórios**, que abstraem o acesso ao banco.

```
Frontend/Cliente → Express Router → Repositório → Prisma → Supabase PostgreSQL
```

---

## Mapeamento por rota

### 1. `/api/contabilidades`

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| POST | / | `contabilidades` | CREATE |
| GET | / | `contabilidades` | SELECT (listar) |
| GET | /:contabilidade_id | `contabilidades` | SELECT (por ID) |
| PUT | /:contabilidade_id | `contabilidades` | UPDATE |
| DELETE | /:contabilidade_id | `contabilidades` | DELETE |

**Repositório:** `src/repositories/contabilidades.ts`  
**Campos:** `nome_contabilidade`, `cnpj`, `email`, `telefone`, `responsavel`, `data_cadastro`

---

### 2. `/api/empresas`

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| GET | / | `empresas` | SELECT (listar) |
| GET | /contabilidade/:contabilidade_id | `empresas` | SELECT (por contabilidade) |
| GET | /cnpj/:cnpj | `empresas` | SELECT (por CNPJ) |
| GET | /:empresa_id | `empresas` | SELECT (por ID) |
| POST | / | `empresas` | CREATE |
| PUT | /:empresa_id | `empresas` | UPDATE |
| DELETE | /:empresa_id | `empresas` | DELETE |

**Repositório:** `src/repositories/empresas.ts`  
**Relacionamento:** `empresas.contabilidade_id` → `contabilidades.id`  
**Campos:** `cnpj`, `razao_social`, `regime`, `contabilidade_id`, `ativo`, `created_at`, `updated_at`

---

### 3. `/api/credenciais`

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| GET | /empresa/:empresa_id | `credenciais` | SELECT (por empresa) |
| POST | / | `credenciais` | CREATE ou UPSERT |
| PUT | /:credencial_id/status | `credenciais` | UPDATE (status) |
| PUT | /:credencial_id | `credenciais` | UPDATE (senha) |
| DELETE | /:credencial_id | `credenciais` | DELETE |
| POST | /:credencial_id/obter-senha | `credenciais` | SELECT + descriptografia |

**Repositório:** `src/repositories/credenciais.ts`  
**Relacionamento:** `credenciais.empresa_id` → `empresas.id` (CASCADE)  
**Campos:** `empresa_id`, `tipo` (CNPJ_SENHA/CPF_SENHA), `usuario`, `senha_criptografada`, `status`, `ultimo_teste_em`

---

### 4. `/api/certificados`

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| GET | / | `certificados_digitais` | SELECT (listar) |
| GET | /cnpj/:cnpj | `certificados_digitais` | SELECT (por CNPJ) |
| POST | / | `certificados_digitais` | CREATE |
| PUT | /:id | `certificados_digitais` | UPDATE |
| DELETE | /:id | `certificados_digitais` | DELETE |
| DELETE | /cnpj/:cnpj | `certificados_digitais` | DELETE (por CNPJ) |

**Repositório:** `src/repositories/certificados.ts`  
**Relacionamento:** `certificados_digitais.contabilidade_id` → `contabilidades.id`  
**Campos:** `cnpj`, `arquivo`, `data_validade`, `empresa_id`, `contabilidade_id`, `data_cadastro`

---

### 5. `/api/settings`

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| GET | / | `settings` | SELECT (única linha) |
| PUT | / | `settings` | UPDATE ou CREATE |

**Repositório:** `src/repositories/settings.ts`  
**Tabela:** `settings` — configurações de automação (única linha)  
**Campos:** headless, company_timeout_seconds, max_retries_per_step, viewport, downloads_base_path, etc.

---

### 6. `/api/execucoes`

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| GET | / | `execucoes` | SELECT (listar com filtros) |
| GET | /:id | `execucoes` | SELECT (por ID) |
| POST | / | `execucoes` | CREATE |

**Repositório:** `src/repositories/execucoes.ts`  
**Relacionamento:** `execucoes.empresa_id` → `empresas.id` (CASCADE)  
**Campos:** empresa_id, cnpj, status, etapa_atual, progresso, periodo_inicio, periodo_fim, qtd_notas_emitidas, qtd_notas_recebidas, resultado_final, etc.

---

### 7. `/api/execucao`

Orquestra execuções via Playwright. **Cria e atualiza** registros em `execucoes`:

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| POST | /multiplas | `execucoes` | CREATE (múltiplas) |
| POST | /:empresa_id | `execucoes` | CREATE + fila de execução |
| GET | /:empresa_id/status | memória + `execucoes` | Status em tempo real |

**Service:** `src/services/execution-service.ts`  
- Chama `execucoesRepo.criar()` para criar
- Chama `execucoesRepo.atualizar()` durante a execução (status, progresso, qtd_notas, etc.)

---

### 8. `/api/relatorios`

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| GET | /execucoes/resumo | `execucoes` + `empresas` | SELECT agregado |
| GET | /execucoes/resumo/csv | `execucoes` + `empresas` | SELECT + export CSV |

**Router:** `src/routers/relatorios.ts` — usa Prisma diretamente e `empresasRepo`

---

### 9. `/api/nfse`

| Método | Rota | Tabela Supabase | Operação |
|--------|------|-----------------|----------|
| POST | /:cnpj/abrir | - | Automação (certificado) |

**Nota:** Esta rota dispara automação com certificado digital. O certificado é obtido via `obterCertificadoPorCnpj` (loader configurado na Etapa 5.2), que pode buscar metadados em `certificados_digitais`.

---

## Tabelas no Supabase

| Tabela | Descrição |
|--------|-----------|
| `contabilidades` | Contabilidades (CNPJ, nome, contato) |
| `empresas` | Empresas vinculadas a contabilidades |
| `credenciais` | Credenciais de login (CNPJ/CPF + senha criptografada) |
| `certificados_digitais` | Metadados de certificados PFX |
| `settings` | Configurações de automação (única linha) |
| `execucoes` | Histórico de execuções da automação NFSe |

---

## Aplicar migrações no Supabase

Para garantir que as tabelas existam no seu projeto Supabase:

```bash
cd Backend
npx prisma migrate deploy
```

### Solução de problemas de conexão

**Erro "bad certificate format" ou TLS:**
- Use a **Connection string** no modo **Session** (pooler, porta 6543) no Supabase Dashboard → Project Settings → Database
- Adicione `?sslmode=require` ao final da URL se necessário
- Formato pooler: `postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`

---

## Verificação

1. **Backend conecta ao Supabase:** `DATABASE_URL` no `.env` aponta para o projeto Supabase.
2. **CRUD funcionando:** Rotas `/api/contabilidades`, `/api/empresas`, `/api/credenciais` etc. salvam e carregam dados.
3. **Execuções registradas:** `/api/execucao` cria registros em `execucoes` e atualiza durante o fluxo.
4. **Settings:** `seedDefaultSettings()` cria registro inicial em `settings` na primeira subida do servidor.

# Integração com Supabase — Pré-requisitos e Plano

Este documento lista **o que precisamos** para vincular o banco de dados do AutoNacional ao Supabase (PostgreSQL gerenciado) e registra o plano de implementação, seguindo as regras de documentação do projeto.

**Data de criação:** 12/02/2026

**Status:** Configuração inicial aplicada (12/02/2026)

---

### Alterações realizadas (12/02/2026)

- **`src/infrastructure/db.ts`** — Cliente postgres.js para queries SQL raw
- **`.env` e `.env.example`** — `DATABASE_URL` e variáveis Supabase com projeto `sabqvvgaracqouyzxdgb`
- **`prisma/schema.prisma`** — Provider alterado de `sqlite` para `postgresql`
- **`src/db/client.ts`** — Removido adapter SQLite; Prisma usa conexão PostgreSQL direta

---

## 1. O que você precisa fornecer

### 1.1 Credenciais de conexão do Supabase

Para conectar o backend Node.js ao banco PostgreSQL do Supabase, precisamos da **Connection String** do seu projeto. Você pode obtê-la no painel do Supabase:

1. Acesse [Supabase Dashboard](https://supabase.com/dashboard)
2. Selecione seu projeto
3. Vá em **Project Settings** → **Database**
4. Copie a **Connection string** (URI)

**Formato esperado:**

```
postgresql://postgres.[PROJECT_REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

Ou conexão direta (porta 5432):

```
postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

> **Recomendação:** Use a **Session mode** (pooler, porta 6543) para aplicações com muitas conexões. Use a conexão **direta** (porta 5432) para migrations e operações administrativas.

---

### 1.2 Informações complementares (para documentação)

| Informação | Descrição | Onde encontrar |
|------------|-----------|----------------|
| **Supabase Project URL** | `https://<PROJECT_REF>.supabase.co` | Project Settings → API |
| **Supabase Project Ref** | ID curto do projeto (ex: `abcdefgh`) | Project Settings → General |
| **Banco está vazio?** | Se sim, rodamos as migrações Prisma. Se não, precisamos avaliar o schema existente. | — |
| **Usar Supabase Auth?** | Se pretende autenticar usuários via Supabase (JWT). Já está previsto no `.env.example`. | Project Settings → API → JWT Secret |

---

### 1.3 Onde as credenciais serão usadas

As credenciais **não** devem ser commitadas no repositório. Serão usadas apenas em:

- **`.env`** (local, já em `.gitignore`): `DATABASE_URL` com a connection string
- **Supabase Auth** (se ativado): `SUPABASE_URL`, `SUPABASE_JWKS_URL`, etc.

---

## 2. Estado atual do projeto

| Item | Situação |
|------|----------|
| **Banco atual** | SQLite (`prisma/dev.db`) em desenvolvimento |
| **Prisma schema** | Provider `sqlite` — será alterado para `postgresql` ao integrar Supabase |
| **DATABASE_URL** | Já lido em `config.ts`; `prisma.config.ts` usa como override |
| **Supabase (Auth)** | Variáveis no `.env.example`; validação JWT ainda não implementada |

---

## 3. Plano de implementação

### Fase 1 — Configuração do banco (Supabase PostgreSQL)

1. **Ajustar schema Prisma**
   - Trocar `provider = "sqlite"` para `provider = "postgresql"`
   - Usar `url = env("DATABASE_URL")` no datasource
   - Revisar tipos incompatíveis SQLite ↔ PostgreSQL (ex: `Boolean`, `DateTime`)

2. **Variáveis de ambiente**
   - Configurar `DATABASE_URL` no `.env` com a connection string do Supabase
   - Manter `.env.example` atualizado (sem valores reais)

3. **Migrações**
   - Rodar `npx prisma migrate dev` para criar as tabelas no Supabase
   - Validar que as tabelas foram criadas corretamente

4. **Ambiente dual (opcional)**
   - Manter SQLite para testes locais rápidos (sem internet)
   - Usar variável `DATABASE_URL` para alternar entre SQLite e Supabase

---

### Fase 2 — Documentação e validação

1. **Atualizar documentação**
   - `MIGRACAO_CONCLUIDA.md`: registrar integração Supabase
   - `README.md` do Backend: instruções para Supabase
   - Este documento: marcar etapas concluídas

2. **Checklist de validação**
   - [ ] Backend conecta ao Supabase sem erros
   - [ ] CRUD de empresas, credenciais, contabilidades funcionando
   - [ ] Execuções sendo registradas no banco remoto
   - [ ] Migrações aplicadas com sucesso

---

### Fase 3 — Supabase Auth (futuro, Etapa 6.4)

Quando for implementar autenticação:

- Usar `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SUPABASE_ISSUER`, `SUPABASE_AUDIENCE` já definidos
- Implementar middleware de validação JWT nas rotas protegidas

---

## 4. Tabelas que serão criadas no Supabase

O schema Prisma atual gera as seguintes tabelas:

| Tabela | Descrição |
|--------|-----------|
| `contabilidades` | Contabilidades (CNPJ, nome, contato) |
| `empresas` | Empresas vinculadas a contabilidades |
| `credenciais` | Credenciais de login (CNPJ/CPF + senha criptografada) |
| `certificados_digitais` | Metadados de certificados PFX |
| `settings` | Configurações de automação (única linha) |
| `execucoes` | Histórico de execuções da automação |

---

## 5. Próximos passos

**O que precisamos de você para começar:**

1. **Connection string** do projeto Supabase (formato descrito na seção 1.1)
2. **Confirmar** se o banco no Supabase está vazio ou já possui tabelas/dados
3. **Decisão** sobre ambiente dual: manter SQLite para dev local ou usar só Supabase

Após receber as informações, seguiremos o plano da Fase 1 e documentaremos cada alteração neste arquivo e nos demais documentos do projeto.

---

## 6. Referências

- [Supabase Database](https://supabase.com/docs/guides/database) — documentação oficial
- [Prisma com PostgreSQL](https://www.prisma.io/docs/orm/database-connectors/postgresql) — guia Prisma
- `Backend/docs/DOCUMENTACAO_CERTIFICADOS_CREDENCIAIS.md` — documentação do backend
- `Backend/.env.example` — variáveis de ambiente

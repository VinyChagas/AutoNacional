# Variáveis de Ambiente

## Backend (`.env`)

O arquivo `.env` deve ser criado a partir do `.env.example` na raiz do Backend.

```bash
cp .env.example .env
```

---

## Supabase

| Variável                    | Obrigatória | Exemplo                                     | Descrição                                    |
| --------------------------- | ----------- | ------------------------------------------- | -------------------------------------------- |
| `SUPABASE_URL`              | Sim*        | `https://abc123.supabase.co`                | URL do projeto Supabase                      |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim*        | `eyJhbGciOiJIUzI1NiIs...`                  | Service Role Key (acesso admin, server-side) |
| `USE_SUPABASE`              | Não         | `true`                                       | Habilita validação estrita das vars Supabase |
| `CERT_STORAGE_BUCKET`       | Sim*        | `certificados`                               | Nome do bucket no Supabase Storage           |

> \* Obrigatórias quando `USE_SUPABASE=true`

### Segurança
- **NUNCA** exponha a `SUPABASE_SERVICE_ROLE_KEY` no frontend
- Esta chave tem acesso total ao banco e storage
- Use apenas no backend (server-side)

---

## Banco de Dados

| Variável       | Obrigatória | Exemplo                                                           | Descrição                    |
| -------------- | ----------- | ----------------------------------------------------------------- | ---------------------------- |
| `DATABASE_URL` | Sim         | `postgresql://postgres:SENHA@db.projeto.supabase.co:5432/postgres` | Connection string PostgreSQL |

### Formato da Connection String
```
postgresql://USUARIO:SENHA@HOST:PORTA/BANCO
```

### Alternativa SQLite (desenvolvimento local)
```env
DATABASE_URL="file:./prisma/dev.db"
```

---

## Criptografia

| Variável       | Obrigatória | Exemplo                          | Descrição                                    |
| -------------- | ----------- | -------------------------------- | -------------------------------------------- |
| `CRYPTO_KEY`   | Sim         | `minha-chave-super-forte-32char` | Chave mestre para AES-256-CBC (32+ chars)    |
| `APP_CRED_KEY` | Não         | `chave-fallback-legado`          | Fallback legado para criptografia            |
| `FERNET_KEY`   | Não         | `base64-encoded-32-bytes`        | Chave Fernet (compatibilidade com Python)    |

### Gerando uma CRYPTO_KEY segura
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## API

| Variável           | Obrigatória | Exemplo               | Descrição                        |
| ------------------ | ----------- | --------------------- | -------------------------------- |
| `PORT`             | Não         | `3000`                | Porta do servidor (default 3000) |
| `INTERNAL_API_KEY` | Não         | `api-key-forte`       | API Key para rotas internas      |

---

## CORS

| Variável       | Obrigatória | Exemplo                                        | Descrição                           |
| -------------- | ----------- | ---------------------------------------------- | ----------------------------------- |
| `CORS_ORIGINS` | Não         | `http://localhost:1234,https://app.dominio.com` | Origens permitidas (separadas por vírgula) |

Se não definido, o backend aceita `http://localhost:4200` por padrão.

---

## Playwright (Automação)

| Variável              | Obrigatória | Default | Descrição                                 |
| --------------------- | ----------- | ------- | ----------------------------------------- |
| `PLAYWRIGHT_TIMEOUT`  | Não         | `30000` | Timeout geral do Playwright (ms)          |
| `PLAYWRIGHT_HEADLESS` | Não         | `false` | Modo headless (true = sem interface)      |
| `QUEUE_TIMEOUT`       | Não         | `60`    | Timeout da fila de execução (segundos)    |

---

## Supabase Auth (Opcional)

| Variável            | Obrigatória | Exemplo                                          | Descrição                    |
| ------------------- | ----------- | ------------------------------------------------ | ---------------------------- |
| `SUPABASE_JWKS_URL` | Não         | `https://projeto.supabase.co/auth/v1/jwks`       | URL JWKS para validação JWT  |
| `SUPABASE_AUDIENCE` | Não         | `authenticated`                                   | Audience esperado no JWT     |
| `SUPABASE_ISSUER`   | Não         | `https://projeto.supabase.co/auth/v1`            | Issuer esperado no JWT       |

---

## Frontend (Environments)

### Desenvolvimento (`src/environments/environment.ts`)

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:4321/api',
};
```

### Produção (`src/environments/environment.prod.ts`)

```typescript
export const environment = {
  production: true,
  apiUrl: '/api',
};
```

> A troca de environment é feita automaticamente pelo Angular CLI no build de produção via `fileReplacements` no `angular.json`.

---

## Exemplo Completo (`.env`)

```env
# Supabase
SUPABASE_URL=https://abcdefghijklmn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
USE_SUPABASE=true
CERT_STORAGE_BUCKET=certificados

# Banco de dados
DATABASE_URL=postgresql://postgres:MinhaS3nhaF0rte@db.abcdefghijklmn.supabase.co:5432/postgres

# Criptografia
CRYPTO_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# API
PORT=3000
INTERNAL_API_KEY=minha-api-key-interna

# CORS
CORS_ORIGINS=http://localhost:1234

# Playwright
PLAYWRIGHT_TIMEOUT=30000
PLAYWRIGHT_HEADLESS=false
QUEUE_TIMEOUT=60
```

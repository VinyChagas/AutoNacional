# Guia de Instalação e Configuração

## Pré-requisitos

| Requisito   | Versão Mínima | Descrição                                          |
| ----------- | ------------- | -------------------------------------------------- |
| Node.js     | 18.0.0        | Runtime JavaScript                                 |
| npm         | 9.x           | Gerenciador de pacotes (vem com Node.js)           |
| Git         | 2.x           | Controle de versão                                 |
| PostgreSQL  | 15+           | Banco de dados (ou Supabase)                       |

### Opcional
- **Supabase CLI**: para gerenciar projeto Supabase localmente
- **Playwright**: instalado automaticamente via `npx playwright install`

---

## 1. Clonar o Repositório

```bash
git clone <url-do-repositorio>
cd AutoNacional
```

---

## 2. Configurar o Backend

### 2.1. Instalar Dependências

```bash
cd Backend
npm install
```

### 2.2. Configurar Variáveis de Ambiente

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais:

```env
# Supabase (obrigatório)
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key

# Bucket de certificados
CERT_STORAGE_BUCKET=certificados

# Criptografia (gere uma chave forte de 32+ caracteres)
CRYPTO_KEY=sua-chave-criptografia-32-chars

# Banco de dados PostgreSQL (Supabase)
DATABASE_URL=postgresql://postgres:SUA_SENHA@db.SEU_PROJETO.supabase.co:5432/postgres

# CORS
CORS_ORIGINS=http://localhost:1234

# Playwright
PLAYWRIGHT_TIMEOUT=30000
PLAYWRIGHT_HEADLESS=false
QUEUE_TIMEOUT=60
```

> Para descrição detalhada de cada variável, consulte [VARIAVEIS_AMBIENTE.md](./VARIAVEIS_AMBIENTE.md).

### 2.3. Configurar Banco de Dados (Prisma)

```bash
# Gerar o cliente Prisma
npx prisma generate

# Aplicar o schema ao banco de dados
npx prisma db push

# (Opcional) Visualizar o banco no Prisma Studio
npx prisma studio
```

### 2.4. Instalar Playwright (Chromium)

```bash
npx playwright install chromium
```

> Necessário para a automação NFSe. Instala o navegador Chromium localmente.

### 2.5. Iniciar o Backend

```bash
# Modo desenvolvimento (hot reload)
npm run dev

# Ou compilar e rodar em produção
npm run build
npm start
```

O servidor inicia em `http://localhost:3000` (ou a porta configurada).

### 2.6. Verificar

```bash
curl http://localhost:3000/health
# Esperado: {"status":"ok","message":"AutoNacional API está funcionando"}
```

---

## 3. Configurar o Frontend

### 3.1. Instalar Dependências

```bash
cd Frontend
npm install
```

### 3.2. Configurar Environment

O arquivo `src/environments/environment.ts` já vem configurado para desenvolvimento:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:4321/api',
};
```

> Ajuste a porta (`4321`) se o backend estiver rodando em outra porta.

### 3.3. Iniciar o Frontend

```bash
npm start
```

Acesse `http://localhost:1234` no navegador.

### 3.4. Build de Produção

```bash
npm run build:prod
```

Os arquivos estáticos são gerados em `dist/autonacional-frontend/`.

---

## 4. Configurar Supabase

### 4.1. Criar Projeto

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto
2. Anote a **URL** e a **Service Role Key** (em Settings → API)
3. Anote a **connection string** do PostgreSQL (em Settings → Database)

### 4.2. Criar Bucket de Storage

O backend cria automaticamente o bucket `certificados` no startup. Se preferir criar manualmente:

1. Vá em Storage → New Bucket
2. Nome: `certificados`
3. Tipo: **Private**

### 4.3. Aplicar Schema

```bash
cd Backend
npx prisma db push
```

---

## 5. Estrutura de Diretórios de Trabalho

Após a execução de automações, a seguinte estrutura será criada:

```
Backend/
├── downloads/              # Downloads de notas fiscais
│   └── {cnpj}/
│       └── {ano}/
│           └── {mes}/
│               ├── emitidas/
│               │   ├── nota-001.xml
│               │   └── nota-001.pdf
│               └── recebidas/
│                   ├── nota-002.xml
│                   └── nota-002.pdf
├── logs/                   # Logs da aplicação
├── temp/                   # Arquivos temporários (certificados baixados)
└── screenshots/            # Screenshots de erros (se habilitado)
```

---

## 6. Troubleshooting

### Erro: "Cannot find module '@prisma/client'"
```bash
cd Backend
npx prisma generate
```

### Erro: "SUPABASE_URL is required"
Verifique se o `.env` está configurado e se `USE_SUPABASE=true` (se aplicável).

### Erro de CORS no Frontend
Verifique se `CORS_ORIGINS` no `.env` do backend inclui a URL do frontend:
```env
CORS_ORIGINS=http://localhost:1234,http://localhost:4200
```

### Playwright não funciona
```bash
npx playwright install chromium
npx playwright install-deps  # Instala dependências do sistema (Linux)
```

### Banco de dados não conecta
1. Verifique a `DATABASE_URL` no `.env`
2. Verifique se o IP está na allowlist do Supabase (Settings → Database → Connection Pooling)
3. Teste a conexão:
```bash
npx prisma db pull
```

### Frontend não conecta ao Backend
1. Verifique se o backend está rodando
2. Verifique a porta em `Frontend/src/environments/environment.ts`
3. Verifique se CORS está configurado

---

## 7. Comandos Úteis

### Backend

| Comando                           | Descrição                              |
| --------------------------------- | -------------------------------------- |
| `npm run dev`                     | Desenvolvimento com hot reload         |
| `npm run build`                   | Compilar TypeScript                    |
| `npm start`                       | Executar produção                      |
| `npm run clean`                   | Limpar build                           |
| `npx prisma generate`            | Gerar cliente Prisma                   |
| `npx prisma db push`             | Aplicar schema ao banco                |
| `npx prisma studio`              | Interface visual do banco              |
| `npx prisma migrate dev`         | Criar migração                         |
| `npx playwright install chromium` | Instalar Chromium                      |

### Frontend

| Comando              | Descrição                        |
| -------------------- | -------------------------------- |
| `npm start`          | Dev server (porta 1234)          |
| `npm run build`      | Build desenvolvimento            |
| `npm run build:prod` | Build produção                   |
| `npm test`           | Testes unitários                 |
| `npm run lint`       | Verificar código                 |

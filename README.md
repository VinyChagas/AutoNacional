# AutoNacional

Sistema de gestão de empresas, certificados digitais e credenciais, com automação de download de NFS-e no Portal Nacional.

O operador usa o frontend para cadastrar contabilidades e empresas, importar certificados ou credenciais e disparar execuções por competência. O backend enfileira essas execuções, abre o Chromium com Playwright, autentica no portal, baixa XML/PDF e grava o resultado no PostgreSQL.

## Documentação técnica

Toda a documentação está em um único arquivo:

**[docs/DOCUMENTACAO_TECNICA.md](docs/DOCUMENTACAO_TECNICA.md)**

Inclui arquitetura, Backend, Frontend, API REST, SSE/Socket.IO, fluxo de automação, domínio, banco, segurança, setup local, deploy, operação e testes.

## Stack

- Frontend: Angular 17
- Backend: Node.js, TypeScript, Express, Socket.IO, Pino, Zod
- Automação: Playwright (Chromium), 2Captcha, Central manual
- Persistência: PostgreSQL via Prisma e `@prisma/adapter-pg`
- Certificados: filesystem local ou SFTP (`ssh2`)
- Deploy: Docker Compose

## Desenvolvimento local

Requisitos: Node.js 20 ou superior, npm 9 ou superior, e acesso a um PostgreSQL.

```bash
cd Backend
cp .env.example .env
# preencha DATABASE_URL e CRYPTO_KEY no .env
npm install
npx playwright install chromium
npm run tunnel:db   # se usar Postgres da VPS
npm run dev
```

```bash
cd Frontend
npm install
npm start
```

- API: `http://localhost:4321`
- Health: `http://localhost:4321/health`
- Frontend: `http://localhost:1234`

Compose só de desenvolvimento (Postgres próprio, separado da VPS):

```bash
docker compose -f docker-compose.local.yml up -d --build
```

## Deploy

```bash
docker compose up -d --build
```

Passo a passo completo na [documentação técnica](docs/DOCUMENTACAO_TECNICA.md#12-deploy-na-vps).

## Estrutura

```text
AutoNacional/
  docker-compose.yml
  docker-compose.local.yml
  Backend/
  Frontend/
  docs/
    DOCUMENTACAO_TECNICA.md
```

Dados que não entram no Git: certificados, downloads, logs e temp sob `/srv/data/autonacional/`.

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

Requisitos: Node.js 20 ou superior, npm 9 ou superior, SSH até a VPS (Postgres) e acesso a um PostgreSQL.

### Tudo de uma vez (recomendado)

Na raiz do repositório — sobe **túnel SSH → Postgres da VPS**, **Backend** e **Frontend**:

```bash
# primeira vez
cp Backend/.env.example Backend/.env
# DATABASE_URL local via túnel, ex.:
#   postgresql://autonacional_app:<SENHA>@127.0.0.1:5433/autonacional?schema=public
# + CRYPTO_KEY etc.
npm run install:all
cd Backend && npx playwright install chromium && cd ..

npm run dev
```

- Túnel DB: `127.0.0.1:5433` → Postgres na VPS (`npm run tunnel:db` no Backend)
- API: `http://localhost:4321` · Health: `http://localhost:4321/health`
- Frontend: `http://localhost:1234`

`Ctrl+C` encerra túnel, API e web juntos. Requer `ssh` com acesso à VPS (`VPS_USER` / `VPS_HOST` opcionais; defaults no script do Backend).

### Separado (alternativa)

```bash
cd Backend && npm run tunnel:db   # terminal 1
cd Backend && npm run dev        # terminal 2
cd Frontend && npm start         # terminal 3
```

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

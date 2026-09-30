# AutoNacional

Sistema de gestão de empresas, certificados digitais e credenciais, com automação de download de NFS-e no Portal Nacional.

O operador usa o frontend para cadastrar contabilidades e empresas, importar certificados ou credenciais e disparar execuções por competência. O backend enfileira essas execuções, abre o Chromium com Playwright, autentica no portal, baixa XML/PDF e grava o resultado no PostgreSQL.

## Arquitetura

Um único processo Node concentra a API HTTP, o Socket.IO e a fila de automação. O PostgreSQL de produção já existe na VPS (`vinylab-postgres`, rede `vinylab_internal`). O Compose de produção não cria outro banco.

```mermaid
flowchart LR
  UI[Angular] --> API[Express]
  UI --> IO[Socket.IO]
  API --> Q[PQueue]
  Q --> PW[Playwright]
  PW --> Portal[Portal NFS-e]
  PW --> Captcha[2Captcha ou Central manual]
  API --> PG[(PostgreSQL)]
  API --> Certs[Certificados em volume]
  PW --> Files[Downloads XML/PDF]
```

Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/AUTOMATION_FLOW.md](docs/AUTOMATION_FLOW.md).

## Stack

- Frontend: Angular 17
- Backend: Node.js, TypeScript, Express, Socket.IO, Pino, Zod
- Automação: Playwright (Chromium), 2Captcha, Central manual
- Persistência: PostgreSQL via Prisma e `@prisma/adapter-pg`
- Certificados: filesystem local ou SFTP (`ssh2`)
- Planilhas: `xlsx`
- Deploy: Docker Compose

## Desenvolvimento local

Requisitos: Node.js 20 ou superior, npm 9 ou superior, e acesso a um PostgreSQL.

```bash
cd Backend
cp .env.example .env
# preencha DATABASE_URL e CRYPTO_KEY no .env
npm install
npx playwright install chromium
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

Para o PostgreSQL da VPS a partir do Mac, sem publicar a porta 5432:

```bash
cd Backend
npm run tunnel:db
```

O túnel usa as variáveis `VPS_HOST`, `VPS_USER` e `LOCAL_PORT`. Não coloque a senha do banco no script.

Há também um Compose só de desenvolvimento, com PostgreSQL próprio e senha local, separado da VPS:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Esse arquivo não usa a rede `vinylab_internal` e não deve ser o comando de produção.

## Configuração

Variáveis principais, sem valores reais. A lista completa está em `Backend/.env.example`.

```bash
DATABASE_URL=postgresql://USUARIO:SENHA@HOST:5432/autonacional?schema=public
CERT_STORAGE_DRIVER=local
CERT_STORAGE_PATH=/srv/data/autonacional/certificados
CRYPTO_KEY=
APP_CRED_KEY=
CORS_ORIGINS=http://localhost:1234
PORT=4321
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_NO_SANDBOX=false
TWOCAPTCHA_API_KEY=
CAPTCHA_MODE=auto_manual
LOG_LEVEL=info
```

`PLAYWRIGHT_NO_SANDBOX=true` existe para o container Linux. No macOS deixe `false`.

## Deploy

Produção:

```bash
docker compose up -d --build
```

O passo a passo da VPS, incluindo diretórios, backup e rollback, está em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Estrutura

```text
AutoNacional/
  docker-compose.yml          # VPS: frontend + backend, Postgres externo
  docker-compose.local.yml    # só desenvolvimento, com Postgres local
  Backend/
    src/                      # API, automação e persistência
    prisma/schema.prisma      # modelo atual do PostgreSQL
    scripts/                  # túnel SSH e smokes de banco/storage
    Dockerfile
  Frontend/
    src/                      # Angular
    Dockerfile
    nginx.conf                # publica a UI e faz proxy de /api e /socket.io
  docs/
```

Dados que não entram no Git:

- `/srv/data/autonacional/certificados`
- `/srv/data/autonacional/downloads`
- `/srv/data/autonacional/logs`
- `/srv/data/autonacional/temp`

## Operação

- [docs/OPERATIONS.md](docs/OPERATIONS.md) — logs, healthcheck, retenção e encerramento
- [docs/DATABASE.md](docs/DATABASE.md) — PostgreSQL, backup e tabelas para revisão
- [docs/SECURITY.md](docs/SECURITY.md) — certificados, segredos e o que fazer com o histórico do Git
- [docs/ARCHITECTURE_HISTORY.md](docs/ARCHITECTURE_HISTORY.md) — decisões que explicam o formato atual

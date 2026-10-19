# AutoNacional — Documentação técnica completa

Documentação unificada do sistema, baseada nos repositórios `Frontend/` (Angular 17) e `Backend/` (Node.js / Express / Playwright).

O operador usa o frontend para cadastrar contabilidades e empresas, importar certificados ou credenciais e disparar execuções por competência. O backend enfileira essas execuções, abre o Chromium com Playwright, autentica no Portal Nacional da NFS-e, baixa XML/PDF e grava o resultado no PostgreSQL.

---

## Sumário

1. [Visão geral e arquitetura](#1-visão-geral-e-arquitetura)
2. [Stack](#2-stack)
3. [Backend](#3-backend)
4. [Frontend](#4-frontend)
5. [API REST](#5-api-rest)
6. [Tempo real (SSE e Socket.IO)](#6-tempo-real-sse-e-socketio)
7. [Fluxo da automação](#7-fluxo-da-automação)
8. [Domínio (empresas e status)](#8-domínio-empresas-e-status)
9. [Banco de dados](#9-banco-de-dados)
10. [Segurança](#10-segurança)
11. [Desenvolvimento local](#11-desenvolvimento-local)
12. [Deploy na VPS](#12-deploy-na-vps)
13. [Operação](#13-operação)
14. [Testes e regressão](#14-testes-e-regressão)
15. [Histórico arquitetural](#15-histórico-arquitetural)

---

## 1. Visão geral e arquitetura

Um único processo Node concentra a API HTTP, o Socket.IO e a fila de automação. Em produção, frontend e backend rodam em containers Docker; o PostgreSQL já existe na VPS (`vinylab-postgres`, rede `vinylab_internal`). O Compose de produção **não** cria outro banco.

Não há Redis, worker separado, cron do sistema nem Kubernetes. A automação não é um processo à parte: ela roda na mesma instância Node da API.

```mermaid
flowchart LR
  Browser[Navegador do operador] --> Nginx[Frontend nginx :8080]
  Nginx -->|/api e /socket.io| API[Backend Express :4321]
  API --> Prisma[Prisma + adapter pg]
  Prisma --> PG[(vinylab-postgres)]
  API --> Fila[PQueue]
  Fila --> Chromium[Chromium via Playwright]
  Chromium --> Portal[Portal NFS-e Nacional]
  Chromium --> Two[2Captcha]
  API --> Socket[Socket.IO Central manual]
  Browser --> Socket
  API --> CertVol["/srv/data/autonacional/certificados"]
  Chromium --> Down["/srv/data/autonacional/downloads"]
```

### Componentes

| Componente | Processo | Função |
|---|---|---|
| Frontend | nginx servindo o build Angular | Telas de empresas, execução, captcha, configurações, contabilidades e rentabilidade |
| Backend | `node dist/main.js` | REST, SSE, Socket.IO e fila |
| PostgreSQL | container `vinylab-postgres` | Dados relacionais |
| Chromium | subprocesso do Playwright (Xvfb no container) | Login e download no portal |
| Storage de certificados | pasta local ou SFTP | PFX fora do Git |

### Entrypoints

| Ambiente | Como sobe |
|---|---|
| Backend (dev) | `Backend/src/main.ts` via `npm run dev` |
| Backend (prod) | `Backend/dist/main.js` |
| Frontend (dev) | `ng serve --port 1234` |
| Frontend (prod) | nginx, com proxy para o serviço `backend` |

### Portas

| Porta | Onde | Uso |
|---|---|---|
| 4321 | backend | API, health, Socket.IO |
| 1234 | frontend local | `ng serve` |
| 8080 no host / 80 no container | frontend de produção | UI e proxy |
| 5432 | `vinylab-postgres` | só na rede Docker |
| 5433 | Mac (túnel) | acesso local ao Postgres da VPS |

### O que o container de produção não faz

Não cria PostgreSQL. Não embute certificado. Não grava download dentro da imagem: downloads, logs e temporários são volumes no host.

### Estrutura do repositório

```text
AutoNacional/
  docker-compose.yml          # VPS: frontend + backend, Postgres externo
  docker-compose.local.yml    # desenvolvimento com Postgres local
  Backend/
    src/                      # API, automação e persistência
    prisma/schema.prisma
    scripts/                  # túnel SSH e smokes
    Dockerfile
  Frontend/
    src/                      # Angular
    Dockerfile
    nginx.conf                # UI + proxy /api e /socket.io
  docs/
    DOCUMENTACAO_TECNICA.md   # este arquivo
```

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Angular 17 (standalone), Tailwind 3.4, Chart.js, jsPDF, xlsx, socket.io-client |
| Backend | Node.js ≥18, TypeScript, Express 4, Zod, Pino |
| ORM | Prisma 7 + `@prisma/adapter-pg` + `pg` |
| Automação | Playwright (Chromium), 2Captcha, Central manual |
| Fila | `p-queue` (em memória) |
| Realtime | SSE (execução/validação) + Socket.IO (captcha) |
| Certificados | filesystem local ou SFTP (`ssh2`) |
| Deploy | Docker Compose |
| Testes Backend | Vitest |
| Testes Frontend | Karma + Jasmine |

---

## 3. Backend

Código em `Backend/`.

### Bootstrap (`src/main.ts`)

Ordem de `bootstrap()`:

1. `initDb()` + `seedDefaultSettings()` — se o banco falhar, o processo continua com warning.
2. `assertCertificateStorageReady()` — storage local ou SFTP.
3. Garante diretórios de logs/temp/downloads; limpeza periódica por idade.
4. `setCertificateLoader(carregarCertificadoPorCnpj)`.
5. `iniciarRelatorio2Captcha()`.
6. `http.createServer(app)` + `initSocketIo(httpServer)`.
7. `listen(PORT)` — padrão **4321**.

No SIGINT/SIGTERM: para a fila, fecha browsers, fecha storage SFTP, `prisma.$disconnect()`.

### Árvore de `src/`

```text
src/
  main.ts                 # Express + HTTP + Socket.IO
  config/env.ts           # validação de env
  infrastructure/         # config, crypto (AES-CBC), logger, socket
  db/                     # client Prisma, seed settings
  middleware/             # error-handler, upload, response
  routers/                # rotas REST clássicas
  modules/
    certificados/empresas/  # listagem unificada, status, cadastro
    imports/                # preview + confirmar cert/cred
  repositories/           # acesso Prisma
  services/               # execution, captcha manual, certificate-loader…
  automation/             # Playwright, download, captcha
    captcha/              # providers TWO_CAPTCHA / MANUAL
  storage/                # LocalCertificateStorage | SftpCertificateStorage
  utils/                  # CNPJ, crypto GCM legado, planilha, paths
```

### Camadas

| Camada | Papel | Exemplos |
|---|---|---|
| `routers/` / `modules/*/router` | HTTP, validação Zod | `execucao.ts`, `empresas.routes.ts` |
| `services/` | Orquestração | `execution-service.ts`, `manual-captcha.service.ts` |
| `repositories/` | Persistência Prisma | empresas, credenciais, execucoes |
| `automation/` | Browser e portal NFS-e | `playwright-nfse.ts`, `download-operation.ts` |
| `storage/` | PFX | `getCertificateStorage()` |
| `infrastructure/` | Cross-cutting | logger, CORS, Socket.IO |

### Rotas montadas (resumo)

| Prefixo | Função |
|---|---|
| `GET /`, `GET /health` | Liveness / readiness (DB + fila) |
| `/api/settings`, `/api/config` | Configuração de automação |
| `/api/empresas`, `/api/credenciais`, `/api/certificados` | Cadastro |
| `/api/imports` | Importação em lote |
| `/api/execucao`, `/api/execucoes` | Orquestração e histórico |
| `/api/validacoes` | Validação cert/cred + SSE |
| `/api/contabilidades`, `/api/relatorios`, `/api/dashboard` | Gestão e painéis |
| `/api/nfse`, `/api/metrics`, `/api/logs` | Utilitários e rentabilidade |

Catálogo detalhado na [seção 5](#5-api-rest).

### Automação e fila

- Fila em memória: `PQueue` em `services/execution-service.ts`.
- Login certificado: `automation/playwright-nfse.ts`.
- Login credencial: `automation/login-credencial-nfse.ts`.
- Navegação resiliente: `automation/playwright-nav.ts`.
- Download + retry de captcha: `download-operation.ts`.
- Slots visuais: `captcha-window-manager.ts`.

### Storage de certificados

| Driver | Env | Uso |
|---|---|---|
| `local` | `CERT_STORAGE_PATH` | Produção VPS (`/srv/data/autonacional/certificados`) |
| `sftp` | `CERT_STORAGE_SFTP_*` + agent ou chave | Backend no Mac, PFX na VPS |

Path traversal bloqueado em `storage/path-safety.ts`. A senha do PFX fica cifrada no PostgreSQL; o arquivo não é servido por HTTP.

### Criptografia

| Utilitário | Algoritmo | Uso típico |
|---|---|---|
| `infrastructure/crypto.ts` | AES-256-CBC (`CRYPTO_KEY` / `APP_CRED_KEY`) | Senhas de certificado e grande parte das credenciais |
| `utils/crypto.ts` | AES-256-GCM | Cadastro de credencial em fluxos mais novos |

`FERNET_KEY` aparece no env como legado. `INTERNAL_API_KEY` está no `.env.example`, mas **não há middleware de enforcement no código atual**.

### Variáveis de ambiente

Fonte canônica: `Backend/.env.example`.

- **DB:** `DATABASE_URL`
- **Storage:** `CERT_STORAGE_DRIVER`, `CERT_STORAGE_PATH`, `CERT_STORAGE_SFTP_*`
- **Crypto:** `CRYPTO_KEY`, `APP_CRED_KEY`, `FERNET_KEY`
- **API:** `PORT`, `CORS_ORIGINS`, `INTERNAL_API_KEY`
- **Playwright:** `PLAYWRIGHT_TIMEOUT`, `PLAYWRIGHT_HEADLESS`, `PLAYWRIGHT_NO_SANDBOX`, `QUEUE_TIMEOUT`
- **Captcha:** `TWOCAPTCHA_API_KEY`, `CAPTCHA_MODE`, demais `CAPTCHA_*`
- **Logs:** `LOG_LEVEL`

Extras usados no código: `BROWSER_PAGE_ZOOM`, `MAX_CONCURRENCY_CAP`, `CAPTCHA_MANUAL_USE_CENTRAL`, `CAPTCHA_WINDOW_LAYOUT_ENABLED`, `CAPTCHA_DEBUG`.

### Scripts npm (Backend)

| Script | Função |
|---|---|
| `dev` / `build` / `start` / `clean` | Ciclo de vida |
| `prisma:generate`, `prisma:push`, `prisma:migrate`, `prisma:studio` | Prisma |
| `playwright:install` | Baixa Chromium |
| `setup` | generate + push + playwright |
| `test` / `test:watch` | Vitest |
| `test:smoke-db` / `test:smoke-storage` | Smokes |
| `tunnel:db` | Túnel SSH → PostgreSQL Docker |

---

## 4. Frontend

Código em `Frontend/`. Stack: Angular 17 (standalone), Tailwind, Chart.js, jsPDF, xlsx, socket.io-client.

### Entrypoints

| Ambiente | Comando | URL |
|---|---|---|
| Desenvolvimento | `npm start` → `ng serve --port 1234` | http://localhost:1234 |
| Produção | `npm run build:prod` → nginx | host `:8080` |

`Frontend/nginx.conf` serve o SPA e faz proxy de `/api/` e `/socket.io/` para `backend:4321`.

### Ambientes

| Arquivo | `apiUrl` | Uso |
|---|---|---|
| `src/environments/environment.ts` | `http://localhost:4321/api` | Dev (`captchaDebug: true`) |
| `src/environments/environment.prod.ts` | `/api` | Production (`captchaDebug: false`) |

Não há interceptor de autenticação de usuário: a API é operacional, protegida por rede/proxy.

### Estrutura

```text
Frontend/src/app/
  app.config.ts, app.routes.ts, app.component.*
  components/
    layout/              # shell + sidebar
    home/                # dashboard
    empresas/            # cadastro unificado, imports, validação
    contabilidades/
    execucao/
    central-captchas/    # /execucao/captchas/:batchId
    configuracoes/
    rentabilidade/
    shared/
  services/              # HTTP + Socket.IO + theme/toast
  models/
  utils/
```

### Rotas

| Rota | Componente | Função |
|---|---|---|
| `/` → `/home` | `HomeComponent` | Dashboard |
| `/empresas` | `EmpresasComponent` | Empresas + certificados + credenciais |
| `/certificados`, `/credenciais` | redirect | Legado → `/empresas` |
| `/execucao` | `ExecucaoComponent` | Disparo e acompanhamento de lote |
| `/execucao/captchas/:batchId` | `CentralCaptchasComponent` | hCaptcha remoto |
| `/contabilidades` | `ContabilidadesComponent` | CRUD de escritórios |
| `/rentabilidade` | `RentabilidadeComponent` | Métricas / billing |
| `/configuracoes` | `ConfiguracoesComponent` | Settings de automação |

### Services → backend

| Service | Recurso |
|---|---|
| `EmpresasUnificadoService` / `EmpresasService` | `/empresas` |
| `CertificadoService` | `/certificados` |
| `CredenciaisService` | `/credenciais` |
| `ContabilidadeService` | `/contabilidades` |
| `ExecucaoService` | `/execucao` (+ SSE) |
| `ValidacoesService` | `/validacoes` (+ SSE) |
| `SettingsService` | `/settings`, `/config` |
| `DashboardService` | `/dashboard` |
| `RentabilidadeService` | `/metrics` |
| `ExecucaoLogsService` | `/logs` |
| `CaptchaCentralService` | Socket.IO (host = API sem `/api`) |

### Fluxos de UI

**Empresas** — cadastro unificado (certificado A1 ou credencial), listagem com status operacional, importação em lote (preview + confirmar), validação em massa.

**Execução** — carrega empresas aptas → operador escolhe competência, tipo, captcha, headless, PDF → `POST /execucao/multiplas` → SSE atualiza a tabela → se `MANUAL`, atalho para Central de captchas.

**Configurações** — concorrência, paths, headless, retenção; status via `/api/config/status`.

### Scripts npm (Frontend)

| Script | Função |
|---|---|
| `start` / `start:open` | Dev server porta 1234 |
| `build` / `build:prod` | Build Angular |
| `test` / `test:ci` | Karma + Jasmine |

---

## 5. API REST

Base path: `/api` (exceto `GET /` e `GET /health`).

Formato comum nos módulos novos: `{ success: true, data }` / `{ success: false, error }`. Rotas antigas podem devolver JSON direto. Sem JWT.

### Saúde

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | `{ status: 'ok' }` |
| GET | `/health` | DB + fila; **503** se o banco falhar |

### Settings e config

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/settings` | Configurações atuais |
| GET | `/api/settings/defaults` | Defaults |
| PUT | `/api/settings` | Atualiza |
| POST | `/api/settings/reset` | Restaura defaults |
| POST | `/api/settings/test-paths` | Testa paths |
| POST | `/api/settings/select-folder` | Seletor de pasta |
| GET | `/api/config/status` | Status agregado |

### Contabilidades

| Método | Rota |
|---|---|
| GET/POST | `/api/contabilidades` |
| GET/PUT/DELETE | `/api/contabilidades/:id` |

### Empresas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/empresas` | Listagem com agregados |
| GET | `/api/empresas/summary` | Contadores |
| GET | `/api/empresas/export` | Exportação |
| DELETE | `/api/empresas` | Exclusão em massa |
| GET | `/api/empresas/contabilidade/:id` | Por escritório |
| GET | `/api/empresas/cnpj/:cnpj` | Por CNPJ |
| GET | `/api/empresas/:id` | Detalhe |
| POST | `/api/empresas/cadastro/certificado` | Upload PFX (`file`) |
| POST | `/api/empresas/cadastro/credencial` | CNPJ/CPF + senha |
| POST/PUT/DELETE | `/api/empresas`, `/:id` | CRUD legado |

### Credenciais

| Método | Rota |
|---|---|
| GET | `/api/credenciais/empresa/:empresa_id` |
| POST | `/api/credenciais` |
| PUT | `/api/credenciais/:id`, `/:id/status` |
| DELETE | `/api/credenciais/:id` |
| POST | `/api/credenciais/:id/obter-senha` |

### Certificados

| Método | Rota |
|---|---|
| POST | `/api/certificados/extrair`, `/validar-lote`, `/importar`, `/importar-lote` |
| GET | `/api/certificados`, `/contabilidade/:id`, `/cnpj/:cnpj` |
| DELETE | `/api/certificados/cnpj/:cnpj`, `/:id` |
| POST/PUT | `/api/certificados`, `/:id` |

O binário PFX não é servido por HTTP.

### Imports

| Método | Rota |
|---|---|
| POST | `/api/imports/certificados/preview` (multipart `files`, até 50) |
| POST | `/api/imports/certificados/confirmar` |
| POST | `/api/imports/credenciais/preview` (multipart `arquivo`) |
| POST | `/api/imports/credenciais/confirmar` |
| GET | `/api/imports/health` |

### Execução

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/execucao/companies/summary` | Resumo de aptas |
| GET | `/api/execucao/companies` | Empresas aptas |
| POST | `/api/execucao/multiplas` | Enfileira lote → `batch_id` |
| GET | `/api/execucao/stream/:batch_id` | **SSE** |
| GET | `/api/execucao/batch/:batch_id/status` | Snapshot |
| POST | `/api/execucao/:empresa_id` | Uma empresa |
| GET | `/api/execucao/:empresa_id/status` | Status ativo |

Body típico de `POST /multiplas`: empresas, `dataInicio`, `dataFim`, `tipo` (`emitidas` \| `recebidas` \| `ambas`), `headless`, `baixarPdf`, `captchaMode` (`TWO_CAPTCHA` \| `MANUAL`).

### Validações

| Método | Rota |
|---|---|
| POST | `/api/validacoes/iniciar` |
| GET | `/api/validacoes/stream/:job_id` (SSE) |
| GET | `/api/validacoes/:job_id` |
| POST | `/api/validacoes/:job_id/cancel` |
| POST | `/api/validacoes/start` (legado) |

### Relatórios, dashboard, métricas, logs, NFS-e

| Método | Rota |
|---|---|
| GET | `/api/relatorios/execucoes/resumo`, `/resumo/csv` |
| GET | `/api/dashboard/resumo`, `/execucoes`, `/distribuicao-regime` |
| GET | `/api/metrics/billing-summary` |
| POST | `/api/logs/execucoes/salvar` |
| POST | `/api/nfse/:cnpj/abrir` |

### Códigos HTTP

| Código | Quando |
|---|---|
| 200 / 201 | Sucesso / criação |
| 400 | Validação Zod |
| 404 | Recurso inexistente |
| 500 | Erro não tratado |
| 503 | `/health` com banco inacessível |

---

## 6. Tempo real (SSE e Socket.IO)

| Canal | Uso | Path |
|---|---|---|
| SSE | Progresso de execução e validação | `/api/execucao/stream/:batch_id`, `/api/validacoes/stream/:job_id` |
| Socket.IO | Central manual de hCaptcha | `/socket.io` |

### SSE — execução

Código: `execution-events.service.ts`. Cliente: `ExecucaoService.streamExecucoes`. Ping a cada 15s.

| `event` (SSE) | `type` no payload | Campos |
|---|---|---|
| `started` | `execution:started` | `empresa_id`, `cnpj`, `metodo` |
| `login_ready` | `execution:login_ready` | `empresa_id`, `message` |
| `stage` | `execution:stage` | `empresa_id`, `stage`, `message` |
| `counts` | `execution:counts` | contagens emitidas/recebidas/canceladas |
| `finished` | `execution:finished` | `status` (`OK` \| `ERRO`), contagens, `resultado_final?` |

Stages comuns: `login`, `auth_ok`, `acessar_emitidas`, `baixar_emitidas`, equivalentes de recebidas, `finalizando`, estágios de captcha.

### Socket.IO — Central

Init: `infrastructure/socket.ts`. UI: `/execucao/captchas/:batchId`. Serviço: `manual-captcha.service.ts` + `CaptchaCentralService`.

**Cliente → servidor:** `captcha:join-batch`, `leave-batch`, `click`, `refresh`, `confirm`, `resolve`, `skip`.

**Servidor → cliente:** `captcha:batch-state`, `created`, `frame`, `resolved`, `expired`, `error`.

A resolução remota age no **mesmo** Chromium da execução Playwright.

Em produção o nginx proxya `/api/` e `/socket.io/` para o backend. SSE exige proxy sem buffer.

---

## 7. Fluxo da automação

Código de entrada: `Backend/src/routers/execucao.ts` e `services/execution-service.ts`.

```mermaid
sequenceDiagram
  participant UI as Angular
  participant API as POST /api/execucao/multiplas
  participant Fila as PQueue
  participant Auth as Playwright
  participant Portal as Portal NFS-e
  participant DB as PostgreSQL

  UI->>API: empresas, competência, captchaMode
  API->>DB: cria batch e execuções pendentes
  API->>Fila: enfileira cada empresa
  Fila->>Auth: certificado ou credencial
  Auth->>Portal: login e filtro da competência
  Auth->>Portal: download XML/PDF
  Auth->>DB: status, contagens e métricas
  Auth-->>UI: SSE e, se manual, Socket.IO
```

### Passos

1. A tela chama `GET /api/execucao/companies/summary` e `/companies` com `contabilidade_id`.
2. Só entram empresas aptas (`OPERACIONAL` ou `ATENCAO`).
3. `POST /api/execucao/multiplas` com competência, tipo, headless, PDF, `captchaMode`.
4. Router gera `batch_id`, grava lote e enfileira.
5. Resposta volta antes dos browsers terminarem; andamento por SSE.

Quem dispara é o usuário. Não há agendador interno.

### Módulos por etapa

| Etapa | Módulo |
|---|---|
| Fila e concorrência | `services/execution-service.ts` |
| Login certificado A1 | `automation/playwright-nfse.ts` |
| Login CNPJ/CPF + senha | `automation/login-credencial-nfse.ts` |
| Validação avulsa | `automation/validar-credencial-nfse.ts` |
| Navegação e filtro | `playwright-nav.ts`, `processar-notas-competencia.ts` |
| Download | `download-manager.ts`, `download-operation.ts` |
| Captcha | `automation/captcha/*`, `captcha-solver.ts` |
| Central manual | `manual-captcha.service.ts` + Socket.IO |
| Carga do PFX | `certificate-loader.ts` |

### Autenticação no portal

- **Certificado:** loader busca `certificados_digitais`, lê PFX no storage, decifra senha; Playwright registra certificado para `www.nfse.gov.br` e `certificado.nfse.gov.br`.
- **Credencial:** senha decifrada na hora do login; formulário recebe documento + senha.

`MANUAL` força navegador visível (Xvfb no container).

### Download e pastas

Após o login: dashboard → filtro de competência → tabelas emitidas/recebidas. Pasta: `downloadsBasePath` + padrão das settings. No container a base esperada é `/app/downloads` → volume `/srv/data/autonacional/downloads`.

### Captcha e retries

Padrão `CAPTCHA_MODE=auto_manual`. Por operação: fecha modal, relocaliza nota, novo captcha. Limites: `CAPTCHA_OPERATION_MAX_ATTEMPTS`, delays, `CAPTCHA_CONSECUTIVE_FAILURE_LIMIT`. Relatórios em `logs/2captcha-report` (chave mascarada).

### Persistência e erros

Atualiza `execucoes` (status, etapa, progresso, quantidades). Ao fim: `automation_executions` e logs de lote. Estados: `pendente`, `em_execucao`, `concluido`, `falhou`.

Falha de login, página fechada, captcha ou timeout marca a empresa como `falhou` e segue a fila. Uma empresa não derruba o processo.

### Concorrência e encerramento

Fila em memória — reiniciar perde o que ainda não foi persistido. No SIGTERM/SIGINT:

1. para limpeza periódica;
2. fecha HTTP e SSE;
3. pausa fila, descarta jobs não iniciados, fecha browsers;
4. espera fila ociosa (até 20s);
5. fecha SFTP se ativo;
6. `prisma.$disconnect()`;
7. encerra. Timeout global ~30s; Compose `stop_grace_period: 40s`.

`POST /api/execucao/multiplas` só enfileira. O browser abre no worker. Limite efetivo = menor entre settings, slots visuais, cap e tamanho do lote.

### Onde pode falhar

- `DATABASE_URL` / rede `vinylab_internal`
- certificados: volume vazio, permissão, path diferente do banco
- Chromium: libs, `/dev/shm`, `PLAYWRIGHT_NO_SANDBOX` no container
- portal fora do ar, captcha sem saldo, seletor desatualizado
- settings com path absoluto de outra máquina

---

## 8. Domínio (empresas e status)

Fonte: `modules/certificados/empresas/empresa-status.ts`. Segmentos: `empresas-segment.ts`. Execução: `execution-summary.service.ts`.

### Entidades

| Entidade | Tabela | Papel |
|---|---|---|
| Contabilidade | `contabilidades` | Escritório 1—N empresas |
| Empresa | `empresas` | CNPJ, razão, regime, ativo |
| Certificado | `certificados_digitais` | Path PFX + senha cifrada + validade |
| Credencial | `credenciais` | Login + senha cifrada + status de teste |
| Execução | `execucoes` | Histórico por empresa |
| Batch automação | `automation_execution_*` | Métricas / rentabilidade |
| Settings | `settings` | Concorrência, paths, headless |

### Método de login

`CERTIFICADO` | `CREDENCIAL` | `null`. Na execução: `tipo_autenticacao` = `certificado` ou `credenciais`.

### Status de certificado

`MISSING` | `EXPIRED` | `EXPIRING_SOON` (≤ 30 dias) | `VALID` | `ERROR`.

### Status de credencial

`MISSING` | `NOT_TESTED` | `VALID` | `INVALID` | `VALIDATION_ERROR` | `INACTIVE` | `TESTING`.

Revalidação sugerida: nunca testada, teste antigo (7 dias), inválida, erro ou inativa.

### Elegibilidade e pills da UI

| Elegibilidade | Display | Uso na Execução |
|---|---|---|
| `ELIGIBLE` | `OPERACIONAL` | Entra no lote |
| `ELIGIBLE_WITH_WARNING` | `ATENCAO` | Entra no lote |
| `NOT_ELIGIBLE` | `PARCIAL` / `INOPERANTE` | Não entra |

Snapshot inclui `issue_codes`, `issue_messages`, `recommended_action`, `login_metodo`, etc.

### Resultado final de execução

Exemplos: `NFS_ENCONTRADAS`, `NOTAS_EMITIDAS`, `NOTAS_RECEBIDAS`, `SEM_MOVIMENTO`, `ERRO`.

---

## 9. Banco de dados

A aplicação fala apenas com PostgreSQL via `DATABASE_URL`. Cliente: Prisma + `@prisma/adapter-pg`. Não há SQLite no runtime.

### Conexão

`Backend/src/db/client.ts` — `PrismaClient` único. `initDb()` na subida; health faz `SELECT 1`; SIGTERM chama `$disconnect()`.

- **Produção:** host `vinylab-postgres:5432`, banco `autonacional`, rede `vinylab_internal`.
- **Mac:** `npm run tunnel:db` → `127.0.0.1:5433`.

### Tabelas usadas pelo código

| Tabela | Papel |
|---|---|
| `contabilidades` | escritório |
| `empresas` | CNPJ, razão, regime |
| `credenciais` | login + senha cifrada |
| `certificados_digitais` | path PFX + senha + validade |
| `settings` | concorrência, pastas, retenção |
| `execucoes` | histórico por empresa |
| `execucao_batch_log` | resumo JSON do lote |
| `execucao_log_batch` / `execucao_log_item` | painel de logs |
| `automation_execution_batches` / `automation_executions` | rentabilidade |

Na subida, se `settings` estiver vazia, `seedDefaultSettings()` insere defaults. Não há seed de empresas.

### Migrations

Duas migrations incrementais em `Backend/prisma/migrations`. Elas **não** reconstroem um banco vazio. **Não** rode `prisma migrate` / `db push` contra a VPS no deploy.

Postgres vazio de desenvolvimento (`docker-compose.local.yml`):

```bash
cd Backend
DATABASE_URL=postgresql://autonacional:autonacional@127.0.0.1:5432/autonacional?schema=public npx prisma db push
```

### Tabelas legadas (revisão manual)

Não referenciadas pelo código atual; confirme na VPS antes de dropar:

`agendamentos_execucao`, `lacunas_execucao_empresa`, `nfse_job_log`, `notas_fiscais_eventos`, `notas_fiscais_servico`, `notificacoes`, `status_operacional_empresa`.

### Backup

```bash
docker exec vinylab-postgres pg_dump -U USUARIO -d autonacional -Fc -f /tmp/autonacional.dump
docker cp vinylab-postgres:/tmp/autonacional.dump /srv/data/autonacional/backups/autonacional-$(date +%F).dump
docker exec vinylab-postgres rm /tmp/autonacional.dump
```

Inclua `/srv/data/autonacional/certificados` e, se necessário, `downloads`.

### Restore

Pare o backend → `pg_restore --clean --if-exists` → reponha pastas → `docker compose start backend`. Nunca restore em banco em uso.

---

## 10. Segurança

### O que não entra no Git

`.env`, certificados (`*.pfx`, `*.p12`, `*.pem`, `*.key`), planilhas, CSV, ZIP, dumps, logs, downloads, temporários. `.env.example` só com placeholders.

### Certificados na VPS

Diretório: `/srv/data/autonacional/certificados`

| Item | Recomendação |
|---|---|
| Dir | `750` |
| Arquivos | `640` |
| Montagem | bind mount no `backend` |
| Path no banco | relativo, resolvido em `CERT_STORAGE_PATH` |

Sem a chave de crypto o PFX sozinho não autentica; sem o arquivo a chave sozinha também não.

### Segredos de runtime

`DATABASE_URL`, `CRYPTO_KEY`, `APP_CRED_KEY`, `FERNET_KEY` (legado), `INTERNAL_API_KEY`, `TWOCAPTCHA_API_KEY`, chave SFTP se aplicável.

Trate segredo que já passou pelo Git como comprometido. Rotacione se o repo já foi público/compartilhado.

### Rede

Backend e frontend de produção escutam em `127.0.0.1`. Exposição pública via proxy da VPS. Postgres só na rede Docker. Compose local publica Postgres em `127.0.0.1:5432` com senha de desenvolvimento.

### Túnel

`Backend/scripts/ssh-tunnel-db.sh` — preferir `VPS_HOST` / `VPS_USER`. Não colocar senha de banco no script.

---

## 11. Desenvolvimento local

Requisitos: Node.js 20+, npm 9+, PostgreSQL acessível.

```bash
cd Backend
cp .env.example .env
# preencha DATABASE_URL e CRYPTO_KEY
npm install
npx playwright install chromium
npm run tunnel:db   # se usar Postgres da VPS (deixe o terminal aberto)
npm run dev
```

```bash
cd Frontend
npm install
npm start
```

- API: http://localhost:4321  
- Health: http://localhost:4321/health  
- Frontend: http://localhost:1234  
- CORS: incluir `http://localhost:1234`

Compose só de desenvolvimento (Postgres próprio, **não** usar na VPS):

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Exemplo de `.env` local (placeholders):

```bash
DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5433/autonacional?schema=public
CERT_STORAGE_DRIVER=local   # ou sftp no Mac
CRYPTO_KEY=
CORS_ORIGINS=http://localhost:1234
PORT=4321
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_NO_SANDBOX=false
TWOCAPTCHA_API_KEY=
CAPTCHA_MODE=auto_manual
LOG_LEVEL=info
```

`PLAYWRIGHT_NO_SANDBOX=true` é para o container Linux. No macOS deixe `false`.

---

## 12. Deploy na VPS

Produção usa o PostgreSQL já existente. Não use `docker-compose.local.yml` na VPS.

### Requisitos

- Docker Engine + Compose v2
- rede `vinylab_internal` e container `vinylab-postgres`
- portas livres: `127.0.0.1:4321`, `127.0.0.1:8080`
- `shm_size` 1 GB no backend; espaço para Chromium

```bash
docker network inspect vinylab_internal >/dev/null
docker ps --filter name=vinylab-postgres
```

### Setup

```bash
cd /srv
git clone <URL_DO_REPOSITORIO> AutoNacional
cd AutoNacional
cp Backend/.env.example Backend/.env
```

Preencha no `.env` da VPS: `DATABASE_URL` (host `vinylab-postgres`), `CRYPTO_KEY`, `APP_CRED_KEY`, `CORS_ORIGINS`, `TWOCAPTCHA_API_KEY`, `CERT_STORAGE_DRIVER=local`, `PLAYWRIGHT_HEADLESS=true`. O Compose força `CERT_STORAGE_PATH` e `PLAYWRIGHT_NO_SANDBOX=true`.

### Diretórios persistentes

```bash
sudo mkdir -p \
  /srv/data/autonacional/certificados \
  /srv/data/autonacional/downloads \
  /srv/data/autonacional/logs \
  /srv/data/autonacional/temp \
  /srv/data/autonacional/backups
sudo chmod 750 /srv/data/autonacional /srv/data/autonacional/certificados
sudo chmod 770 /srv/data/autonacional/downloads /srv/data/autonacional/logs /srv/data/autonacional/temp
```

Settings no banco devem usar caminhos do container (`./downloads`, `./logs`, `./temp`) — não paths absolutos de macOS.

### Compose

- `restart: unless-stopped`
- healthcheck do backend → `GET /health`
- frontend sobe após backend saudável
- `stop_grace_period: 40s`, `shm_size: 1gb`, Xvfb no entrypoint

```bash
docker compose build
docker compose up -d
curl -fsS http://127.0.0.1:4321/health
curl -fsS -o /dev/null http://127.0.0.1:8080/
```

Health esperado: `{"status":"ok","database":"ok","queue":{...}}`.

Atualização: `git pull && docker compose up -d --build`.  
Rollback de código: `git checkout <COMMIT> && docker compose up -d --build` (não desfaz dados já gravados).

Proxy público (Caddy etc.) → `127.0.0.1:8080`. API e Socket.IO saem pelo nginx do frontend.

---

## 13. Operação

### Logs

Pino em JSON (`LOG_LEVEL`, padrão `info`), campo `module`. Senha/PFX/chave 2Captcha não devem aparecer.

```bash
docker compose logs -f --tail 200 backend
```

Arquivos em `/srv/data/autonacional/logs`.

### Healthcheck

- 200 + `"database":"ok"`: Postgres ok  
- 503 + `"database":"error"`: falha de conexão  
- `queue`: `pending`, `running`, `shuttingDown`

### Falhas comuns

| Sintoma | Onde olhar |
|---|---|
| health 503 | rede, `DATABASE_URL`, `vinylab-postgres` |
| certificado não encontrado | volume e path no banco |
| browser não abre | log, `PLAYWRIGHT_NO_SANDBOX`, `/dev/shm` |
| captcha automático falha | saldo 2Captcha, `logs/2captcha-report` |
| download sumiu após recreate | settings fora de `/app/downloads` |

### Retenção

A cada 24h (e na subida), apaga arquivos mais antigos que `settings.logRetentionDays` (padrão 30) em logs e temp. **Downloads não entram** nessa limpeza.

### Encerramento

`docker compose stop backend` → SIGTERM → fecha HTTP, browsers, storage, Prisma. Evite `kill -9` como rotina.

### Smokes

```bash
cd Backend
npm run test:smoke-db
npm run test:smoke-storage
```

Não abrem o Portal NFS-e. Leia o script antes de apontar para produção.

---

## 14. Testes e regressão

### Backend

```bash
cd Backend
npm test
npm run test:watch
```

Áreas cobertas (exemplos): `playwright-nav`, classificação de erros de download/captcha, `empresa-status`, segmentos, storage SFTP, captcha manual/rqdata.

```bash
npx playwright install chromium
npm run test:playwright
```

Automação real contra o portal **não** é CI: depende de certificado, captcha e rede.

### Frontend

```bash
cd Frontend
npm test
npm run test:ci
```

### Checklist manual pré-release

1. `GET /health` → 200  
2. Listagem/summary de empresas e pills coerentes  
3. Cadastro certificado (PFX no storage, senha cifrada)  
4. Cadastro/validação de credencial  
5. Import lote (preview + confirmar)  
6. Execução com 1–2 empresas  
7. SSE atualiza a tela  
8. Central MANUAL (se usada)  
9. XML/PDF na pasta esperada  
10. Encerramento limpo sem jobs eternamente `em_execucao`

Não commitar PFX, senhas ou dumps de fixture.

---

## 15. Histórico arquitetural

- **Persistência:** JSON → SQLite → etapa Supabase/dump → PostgreSQL na VPS via Prisma + adapter `pg`. SQLite e scripts de dump do Supabase saíram do runtime.
- **Automação:** Chromium do Playwright (não ChromeDriver).
- **Interface:** cadastro unificado na tela Empresas; rotas antigas de certificados/credenciais redirecionam.
- **Deploy:** Compose com frontend + backend ligados ao Postgres já existente em `vinylab_internal`.

---

## Mapa rápido (símbolo → arquivo)

| Conceito | Onde |
|---|---|
| Bootstrap | `Backend/src/main.ts` |
| Fila | `adicionarExecucao` → `execution-service.ts` |
| Login A1 | `playwright-nfse.ts` |
| Login senha | `login-credencial-nfse.ts` |
| Captcha provider | `automation/captcha/get-captcha-provider.ts` |
| Central | `manual-captcha.service.ts` + `CaptchaCentralService` |
| Storage | `storage/index.ts` |
| Prisma | `db/client.ts` |
| Status empresa | `empresa-status.ts` |
| SSE | `execution-events.service.ts` |
| Rotas UI | `Frontend/src/app/app.routes.ts` |
| Proxy prod | `Frontend/nginx.conf` |

# Arquitetura do Sistema

## Visão Geral

O AutoNacional segue uma arquitetura **monorepo** com separação clara entre Frontend (Angular SPA) e Backend (API REST Node.js). A comunicação é feita via HTTP/REST com JSON.

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (Angular 17)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │  Home/   │  │ Empresas │  │ Execução │  │  Config    │  │
│  │ Dashboard│  │ (CRUD)   │  │ (NFSe)   │  │            │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       │              │             │              │          │
│  ┌────┴──────────────┴─────────────┴──────────────┴──────┐  │
│  │              Services (HttpClient + RxJS)             │  │
│  └───────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │ HTTP REST (JSON)
                           ▼
┌──────────────────────────┼──────────────────────────────────┐
│                      BACKEND (Express)                      │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │                    Routers (Express)                   │  │
│  │  /api/empresas  /api/certificados  /api/execucao ...  │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │                   Services (Negócio)                   │  │
│  │  ExecutionService  CertificateLoader  ValidacoesService│  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │                 Repositories (Prisma)                  │  │
│  │  empresas  credenciais  certificados  execucoes  ...   │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │              Automação (Playwright)                    │  │
│  │  playwright-nfse  processar-notas  download-manager    │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
    ┌──────────────┐ ┌──────────┐ ┌──────────────┐
    │  PostgreSQL   │ │ Supabase │ │   Portal     │
    │  (Supabase)   │ │ Storage  │ │   NFSe       │
    │  via Prisma   │ │ (.pfx)   │ │ (Chromium)   │
    └──────────────┘ └──────────┘ └──────────────┘
```

---

## Padrão de Camadas (Backend)

### 1. Routers (Camada de Apresentação)

Recebem requisições HTTP, validam entrada com Zod e delegam para serviços/repositórios.

- Localização: `src/routers/` e `src/modules/*/routes.ts`
- Responsabilidade: parsing de request, validação, resposta HTTP
- Não contêm lógica de negócio

### 2. Services (Camada de Negócio)

Orquestram operações complexas que envolvem múltiplos repositórios ou recursos externos.

- Localização: `src/services/`
- Principais:
  - `execution-service.ts`: fila de execuções, coordenação Playwright
  - `certificate-loader.ts`: carrega certificados do Supabase Storage
  - `validacoes-service.ts`: validação de credenciais em lote

### 3. Repositories (Camada de Dados)

Encapsulam acesso ao banco via Prisma. Cada entidade tem seu repositório.

- Localização: `src/repositories/`
- Responsabilidade: queries, transformações de dados, criptografia de senhas

### 4. Automação (Camada de Integração)

Scripts Playwright que interagem com portais externos.

- Localização: `src/automation/`
- Responsabilidade: autenticação, navegação, extração de dados, download de arquivos

---

## Padrão de Componentes (Frontend)

### Componentes Standalone

O Frontend usa **Angular 17 Standalone Components** — não há NgModules tradicionais. Cada componente declara seus imports diretamente.

### Padrão de Organização

```
components/
├── layout/                   # Layout principal (sidebar + router outlet)
├── home/                     # Dashboard com KPIs
├── empresas/                 # Tela unificada de empresas
│   ├── empresas.component    # Listagem principal
│   ├── empresa-drawer        # Drawer de edição
│   ├── empresas-cadastro     # Modal de cadastro
│   ├── empresas-summary-cards# Cards de resumo
│   ├── import-certificados-lote-modal  # Importação de certificados
│   ├── import-credenciais-modal        # Importação de credenciais
│   ├── empresas-validacao-modal        # Validação em massa
│   └── status.utils          # Cálculos de status
├── execucao/                 # Execução de automação NFSe
├── contabilidades/           # CRUD de contabilidades
└── configuracoes/            # Configurações globais
```

### Comunicação de Dados

```
Component  →  Service (HttpClient)  →  Backend API
    ↕              ↕
  Template    BehaviorSubject / Signal
```

- **Services** fazem chamadas HTTP e mantêm estado reativo (BehaviorSubject/Subject)
- **Components** se inscrevem via `subscribe()` ou `async` pipe
- **Angular Signals** usados em componentes mais novos (ex: rentabilidade)

---

## Fluxo de Dados

### Leitura (GET)

```
Frontend Component
  → Service.listar()
    → HttpClient.get('/api/empresas')
      → Express Router
        → Repository.listarTodas()
          → Prisma.findMany()
            → PostgreSQL
```

### Escrita (POST/PUT)

```
Frontend Component (formulário)
  → Service.criar(payload)
    → HttpClient.post('/api/empresas', body)
      → Express Router (validação Zod)
        → Repository.criar(dados)
          → Prisma.create()
            → PostgreSQL
```

### Automação (execução NFSe)

```
Frontend → POST /api/execucao/:empresa_id
  → ExecutionService.executar()
    → p-queue (fila)
      → CertificateLoader.carregar() → Supabase Storage
      → PlaywrightNfse.autenticar() → Portal NFSe (Chromium)
      → ProcessarNotas.processar() → Download XML/PDF
    → Atualiza status no banco
Frontend ← Polling GET /api/execucao/:id/status
```

---

## Segurança

### Criptografia de Senhas

- Senhas de credenciais são criptografadas com **AES-256-CBC** antes de salvar
- Chave de criptografia definida em `CRYPTO_KEY` (variável de ambiente)
- Decriptação apenas no momento de uso (automação)

### Certificados Digitais

- Arquivos `.pfx` armazenados no **Supabase Storage** (bucket `certificados`)
- Senhas dos certificados criptografadas no banco
- Acesso via **Service Role Key** (server-side apenas)

### CORS

- Origens permitidas configuradas via `CORS_ORIGINS`
- Default: `http://localhost:4200`

---

## Persistência

### Banco de Dados

- **PostgreSQL** hospedado no Supabase
- Acesso via **Prisma ORM** com adapter PostgreSQL (`@prisma/adapter-pg`)
- Schema definido em `prisma/schema.prisma`
- Migrações gerenciadas pelo Prisma Migrate

### Storage

- **Supabase Storage** para certificados digitais (.pfx)
- Bucket: `certificados` (criado automaticamente no bootstrap)
- Path: `{cnpj}.pfx`

---

## Logging

- **Pino** como logger estruturado (JSON)
- Níveis: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- Logger com contexto por módulo: `getLogger('nome-modulo')`
- Configurável via `LOG_LEVEL` no Settings

---

## Fila de Execução

- **p-queue** para controlar execuções concorrentes de Playwright
- Concorrência máxima configurável via Settings (`max_concurrent_browsers`)
- Timeout por empresa configurável (`company_timeout_seconds`)
- Status em tempo real via polling HTTP

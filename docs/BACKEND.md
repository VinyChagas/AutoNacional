# Backend - Documentação Técnica

## Visão Geral

API REST construída com **Node.js + Express + TypeScript**, usando **Prisma** como ORM para PostgreSQL (Supabase) e **Playwright** para automação de navegador.

- **Porta padrão**: 3000 (configurável via `PORT`)
- **Linguagem**: TypeScript (target ES2022, CommonJS)
- **Node.js**: >= 18.0.0

---

## Estrutura de Diretórios

```
Backend/
├── src/
│   ├── main.ts                          # Ponto de entrada da aplicação
│   ├── automation/                      # Automação Playwright
│   │   ├── playwright-nfse.ts           # Autenticação no portal NFSe com cert A1
│   │   ├── processar-notas-competencia.ts # Processamento de notas (emitidas/recebidas)
│   │   ├── download-manager.ts          # Gerenciamento de downloads (XML/PDF)
│   │   ├── playwright-config.ts         # Configuração centralizada do Playwright
│   │   ├── validar-credencial-nfse.ts   # Validação de credenciais no portal
│   │   └── scripts/                     # Scripts auxiliares
│   ├── config/
│   │   ├── env.ts                       # Validação de variáveis de ambiente
│   │   └── supabase.ts                  # Cliente Supabase singleton
│   ├── db/
│   │   ├── client.ts                    # Cliente Prisma singleton + inicialização
│   │   └── init.ts                      # Seed de Settings padrão
│   ├── infrastructure/
│   │   ├── logger.ts                    # Logger Pino com contexto por módulo
│   │   ├── crypto.ts                    # Criptografia AES-256-CBC
│   │   ├── config.ts                    # Constantes centralizadas (PORT, CORS, etc.)
│   │   └── db.ts                        # Cliente PostgreSQL direto (alternativo)
│   ├── middleware/
│   │   ├── error-handler.ts             # Tratamento global de erros Express
│   │   ├── upload.ts                    # Multer para upload de arquivos
│   │   ├── response.ts                  # Helpers de resposta JSON padronizada
│   │   └── index.ts                     # Re-exports
│   ├── modules/
│   │   ├── certificados/                # Módulo de certificados (controller/service/repo/routes)
│   │   ├── credenciais/                 # Módulo de credenciais
│   │   └── imports/                     # Importação em lote (planilhas)
│   ├── repositories/
│   │   ├── empresas.ts                  # CRUD empresas
│   │   ├── credenciais.ts               # CRUD credenciais (com criptografia)
│   │   ├── certificados.ts              # CRUD metadados de certificados
│   │   ├── settings.ts                  # Leitura/atualização de configurações
│   │   ├── execucoes.ts                 # CRUD execuções
│   │   └── contabilidades.ts            # CRUD contabilidades
│   ├── routers/
│   │   ├── settings.ts                  # GET/PUT /api/settings
│   │   ├── empresas.ts                  # CRUD /api/empresas
│   │   ├── credenciais.ts               # CRUD /api/credenciais
│   │   ├── certificados.ts              # Upload/download /api/certificados
│   │   ├── execucao.ts                  # POST /api/execucao/:empresa_id
│   │   ├── execucoes.ts                 # GET /api/execucoes
│   │   ├── contabilidades.ts            # CRUD /api/contabilidades
│   │   ├── relatorios.ts               # Relatórios /api/relatorios
│   │   ├── validacoes.ts               # Validação /api/validacoes
│   │   ├── dashboard.ts                # Dashboard /api/dashboard
│   │   └── nfse.ts                     # NFSe /api/nfse
│   ├── services/
│   │   ├── execution-service.ts         # Orquestração de execuções (fila p-queue)
│   │   ├── certificate-loader.ts        # Carrega certificados do Supabase Storage
│   │   └── validacoes-service.ts        # Validação de credenciais em lote
│   └── utils/
│       ├── certificado-utils.ts         # Extração de informações de PFX (CNPJ, validade)
│       ├── certificado.parser.ts        # Parser de certificados
│       ├── crypto.ts                    # Criptografia AES-256-GCM (auxiliar)
│       ├── planilha.parser.ts           # Parser de planilhas Excel/CSV
│       └── documento.utils.ts           # Utilitários de documentos
├── prisma/
│   ├── schema.prisma                    # Schema do banco de dados
│   └── migrations/                      # Migrações Prisma
├── dist/                                # Código compilado (gerado)
├── package.json
├── tsconfig.json
├── .env.example
├── settings.json                        # Configurações padrão de automação
└── prisma.config.ts                     # Configuração Prisma Migrate
```

---

## Módulos Detalhados

### `main.ts` — Bootstrap

O ponto de entrada inicializa:
1. Express com CORS e JSON parser
2. Conexão com banco de dados (Prisma)
3. Seed de Settings padrão
4. Verificação/criação do bucket Supabase Storage
5. Registro de todas as rotas
6. Injeção do `CertificateLoader` no `ExecutionService`
7. Inicia o servidor HTTP

### `automation/` — Automação Playwright

#### `playwright-nfse.ts`
- Cria contexto Chromium com certificado digital A1 (cliente SSL)
- Navega até o portal NFSe e autentica
- Retorna página autenticada para processamento

#### `processar-notas-competencia.ts`
- Navega pelas competências (mês/ano)
- Varre tabelas de notas emitidas e recebidas
- Extrai dados (número, data, valor, etc.)
- Aciona download de XML e PDF
- Suporta paginação automática

#### `download-manager.ts`
- Gerencia downloads de arquivos
- Organiza em estrutura de pastas: `{cnpj}/{ano}/{mes}/`
- Detecta tipo de arquivo (XML, PDF)
- Evita downloads duplicados

#### `playwright-config.ts`
- Configuração centralizada: headless, timeouts, viewport
- Carrega settings do banco de dados

#### `validar-credencial-nfse.ts`
- Testa login no portal NFSe com CNPJ/CPF + senha
- Retorna status: OK, INVALIDA, BLOQUEADA, ERRO

### `config/` — Configurações

#### `env.ts`
- Valida variáveis de ambiente obrigatórias quando `USE_SUPABASE=true`
- Garante presença de `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRYPTO_KEY`, `CERT_STORAGE_BUCKET`

#### `supabase.ts`
- Cria cliente Supabase singleton com Service Role Key
- Função `ensureCertificadosBucket()` para criar bucket no startup

### `db/` — Banco de Dados

#### `client.ts`
- Instancia PrismaClient singleton com adapter PostgreSQL
- Função `initDb()` para testar conexão
- Função `getPrisma()` para acesso global

#### `init.ts`
- `seedDefaultSettings()`: cria registro de Settings padrão se não existir
- Configurações default definidas em `settings.json`

### `infrastructure/` — Infraestrutura

#### `logger.ts`
- Logger Pino com formatação estruturada (JSON)
- Factory `getLogger(modulo)` para logs com contexto
- Nível configurável

#### `crypto.ts`
- `criptografarSenha(senha)`: AES-256-CBC encrypt
- `descriptografarSenha(hash)`: AES-256-CBC decrypt
- Usa `CRYPTO_KEY` do ambiente

#### `config.ts`
- Exporta constantes: `PORT`, `CORS_ORIGINS`, `DATABASE_URL`
- Carrega de `process.env` com defaults

### `middleware/` — Middlewares Express

#### `error-handler.ts`
- Middleware global de tratamento de erros
- Retorna JSON padronizado com status e mensagem

#### `upload.ts`
- Configuração do Multer para upload de arquivos
- Limites de tamanho e tipos aceitos

#### `response.ts`
- Helpers: `sendSuccess(res, data)`, `sendError(res, message, status)`

### `repositories/` — Acesso a Dados

Cada repositório encapsula operações Prisma para uma entidade:

| Repositório      | Entidade      | Operações                                      |
| ---------------- | ------------- | ---------------------------------------------- |
| `empresas.ts`    | Empresa       | listar, buscar, criar, atualizar, excluir      |
| `credenciais.ts` | Credencial    | CRUD + criptografia/descriptografia automática  |
| `certificados.ts`| Certificado   | CRUD + upload/download Supabase Storage        |
| `settings.ts`    | Settings      | ler, atualizar (registro único)                |
| `execucoes.ts`   | Execucao      | criar, atualizar status, listar                |
| `contabilidades.ts` | Contabilidade | CRUD + listagem com contagem de empresas    |

### `services/` — Lógica de Negócio

#### `execution-service.ts`
- **Fila p-queue**: controla concorrência de execuções Playwright
- **Fluxo**:
  1. Recebe requisição de execução
  2. Cria registro no banco (status: pendente)
  3. Adiciona à fila
  4. Quando processa: carrega certificado → autentica → processa notas → salva
  5. Atualiza status em cada etapa
- **Status**: pendente → executando → concluido/erro
- **Configurável**: concorrência máxima, timeout por empresa

#### `certificate-loader.ts`
- Baixa certificado .pfx do Supabase Storage
- Salva em diretório temporário
- Retorna path local para uso pelo Playwright

#### `validacoes-service.ts`
- Valida credenciais em lote usando Playwright
- Streaming de progresso via Server-Sent Events
- Suporta cancelamento

### `utils/` — Utilitários

#### `certificado-utils.ts`
- `extrairInfoCertificado(buffer, senha)`: extrai CNPJ, razão social, validade
- Usa `node-forge` para parse de certificados PKCS#12

#### `planilha.parser.ts`
- Lê planilhas Excel (.xlsx) e CSV
- Retorna array de objetos com colunas mapeadas
- Suporta auto-detecção de cabeçalho

---

## Scripts npm

| Script              | Comando                                              | Descrição                              |
| ------------------- | ---------------------------------------------------- | -------------------------------------- |
| `npm run dev`       | `ts-node-dev --respawn --transpile-only src/main.ts` | Desenvolvimento com hot reload         |
| `npm run build`     | `tsc`                                                | Compila TypeScript para `dist/`        |
| `npm start`         | `node dist/main.js`                                  | Executa versão compilada (produção)    |
| `npm run clean`     | `rm -rf dist`                                        | Remove diretório de build              |
| `npm run test:playwright` | `npx ts-node src/automation/scripts/test-playwright.ts` | Testa setup do Playwright |

---

## Configuração TypeScript

```json
{
  "target": "ES2022",
  "module": "commonjs",
  "strict": true,
  "outDir": "./dist",
  "rootDir": "./src",
  "paths": { "@/*": ["src/*"] },
  "esModuleInterop": true,
  "resolveJsonModule": true,
  "declaration": true,
  "sourceMap": true
}
```

- **Path aliases**: `@/` → `src/` (ex: `import { getPrisma } from '@/db/client'`)
- **Strict mode**: habilitado para segurança de tipos

---

## Tratamento de Erros

O Backend usa um middleware global (`error-handler.ts`) que:
1. Captura erros não tratados nas rotas
2. Loga o erro com Pino
3. Retorna JSON padronizado:

```json
{
  "error": true,
  "message": "Descrição do erro",
  "details": "..." // apenas em desenvolvimento
}
```

---

## Criptografia

### Credenciais (AES-256-CBC)
```
Texto → IV aleatório (16 bytes) + AES-256-CBC encrypt → Base64(IV + ciphertext)
```

### Certificados
- Arquivo `.pfx` → Supabase Storage (bucket `certificados`)
- Senha do certificado → AES-256-CBC → banco de dados

# Tela de Execução e Automação NFSe — Correlação Frontend ↔ Backend

> Documentação da tela **Execução de Processos** (`Frontend/.../execucao`) e dos módulos Playwright em `Backend/src/automation`, com o mapeamento de como a UI dispara, acompanha e finaliza a automação.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Mapa de arquivos](#2-mapa-de-arquivos)
3. [Tela de Execução (Frontend)](#3-tela-de-execução-frontend)
4. [Camada de orquestração (Backend)](#4-camada-de-orquestração-backend)
5. [Módulos de automação (`Backend/src/automation`)](#5-módulos-de-automação-backendsrcautomation)
6. [Correlação tela ↔ automação](#6-correlação-tela--automação)
7. [API REST usada pela tela](#7-api-rest-usada-pela-tela)
8. [Status e mapeamentos](#8-status-e-mapeamentos)
9. [Fluxo ponta a ponta](#9-fluxo-ponta-a-ponta)
10. [Arquivos baixados](#10-arquivos-baixados)
11. [Referências](#11-referências)

---

## 1. Visão geral

A tela **Execução de Processos** (`/execucao`) é a interface operacional para download em lote de NFSe (XML e PDF/DANFS-e) no portal nacional (`nfse.gov.br`).

| Camada | Pasta / papel |
| ------ | ------------- |
| UI | `Frontend/src/app/components/execucao` — seleção de empresas, parâmetros e acompanhamento |
| HTTP / SSE | `Frontend/.../services/execucao.service.ts` ↔ `Backend/src/routers/execucao.ts` |
| Orquestração | `Backend/src/services/execution-service.ts` — fila PQueue, status, callbacks SSE |
| Automação | `Backend/src/automation/*` — Playwright: login, varredura, captcha, download |

**Rota Angular:** `/execucao` → `ExecucaoComponent`  
**Base da API:** `/api/execucao`

A pasta `automation` **não** é chamada diretamente pelo frontend. O browser só fala com a API; o `execution-service` é quem importa e executa os scripts Playwright.

---

## 2. Mapa de arquivos

### Frontend — tela e serviços

```
Frontend/src/app/
├── app.routes.ts
│   └── path: 'execucao' → ExecucaoComponent
├── components/execucao/
│   ├── execucao.component.ts      # Estado, ações, polling, SSE, Excel, log
│   ├── execucao.component.html    # Layout: controles, KPIs, tabela, modais
│   └── execucao.component.scss
├── services/
│   ├── execucao.service.ts        # HTTP + EventSource (SSE)
│   ├── execucao-logs.service.ts   # POST log do lote
│   ├── contabilidade.service.ts   # Select de contabilidade
│   └── empresas.service.ts        # Apoio (legado / unificado)
└── models/
    ├── execution-row.model.ts     # Linha da tabela (FILA / EM_EXECUCAO / OK / ERRO)
    └── execucao-batch-log.model.ts
```

### Backend — API, orquestração e automação

```
Backend/src/
├── routers/execucao.ts                 # Endpoints REST + SSE
├── services/
│   ├── execution-service.ts            # Fila + executarFluxoCompleto()
│   ├── execution-events.service.ts     # Emissão SSE por batch_id
│   ├── execution-summary.service.ts    # Summary aptas / inoperantes / parciais
│   └── automation-metrics.service.ts   # Métricas de batch
└── automation/                         # Playwright (motor)
    ├── playwright-config.ts            # Timeout, headless, args Chromium
    ├── playwright-nfse.ts              # Login com certificado A1
    ├── login-credencial-nfse.ts        # Login CNPJ/CPF + senha (execução)
    ├── validar-credencial-nfse.ts      # Login só para validação (tela Empresas)
    ├── processar-notas-competencia.ts  # Emitidas/Recebidas + datas + captcha UI
    ├── download-operation.ts           # Retry por nota (XML/PDF + captcha)
    ├── download-operation-types.ts     # Tipos/status da operação de download
    ├── download-manager.ts             # Pastas, nomes, validação de arquivo
    ├── captcha-solver.ts               # Integração 2Captcha (hCaptcha)
    ├── captcha-report.ts               # Relatório de sessão 2Captcha
    └── scripts/test-playwright.ts      # Script de smoke test
```

---

## 3. Tela de Execução (Frontend)

### 3.1 Seções da UI

| Seção | Função |
| ----- | ------ |
| Header | Título “Execução de Processos” |
| Contabilidade | Select obrigatório; ao mudar, carrega summary |
| Cards de summary | Total / Aptas / Inoperantes / Parciais (modal com lista) |
| Ações | Carregar Empresas Validadas, Iniciar, Salvar Log, Gerar Resumo, Limpar |
| Filtros | Data início/fim, tipo (emitidas/recebidas/ambas), Baixar PDF, Headless |
| Barra de progresso | % de empresas com status OK |
| KPIs (após Iniciar) | Fila restante, Executando, Sucesso, Erro |
| Tabela unificada | CNPJ, Razão Social, Método, contagens, Status, Mensagem |
| Modal seleção | Checklist das empresas aptas (certificado ou credencial) |

### 3.2 Fluxo do usuário na tela

1. Seleciona **contabilidade** → `GET /api/execucao/companies/summary`
2. Clica **Carregar Empresas Validadas** → modal com aptas (`summary.aptas` ou `GET /companies`)
3. Marca empresas e confirma → preenche `executionRows` / `execucoes` em **FILA** (“Aguardando início…”)
4. Informa **datas**, **tipo**, **baixar PDF**, **headless**
5. Clica **Iniciar** → `POST /api/execucao/multiplas`
6. Com `batch_id`: abre **SSE** + **polling** do batch a cada 2,5s
7. Tabela atualiza em tempo real (estágios, contagens, OK/ERRO)
8. Opcional: **Salvar Log**, **Gerar Resumo** (Excel local), **Limpar**

### 3.3 Controles e efeito no backend

| Controle na UI | Campo enviado | Efeito na automação |
| -------------- | ------------- | ------------------- |
| Data Início / Fim | `dataInicio`, `dataFim` | Filtro no portal + pasta `{mês}-{ano}` |
| Tipo | `tipo` | Processa emitidas, recebidas ou ambas |
| Baixar PDF (DANFS-e) | `baixarPdf` | `true` = XML+PDF; `false` = só XML |
| Modo Headless | `headless` | Chromium invisível ou com janela |
| Método (badge) | `tipo_autenticacao` | Certificado → `playwright-nfse`; Credencial → `login-credencial-nfse` |

### 3.4 Modais

- **Grupo (summary):** lista somente leitura por card (total/aptas/inoperantes/parciais).
- **Seleção:** empresas aptas com busca e “selecionar todos os filtrados”.
- **Resumo (legado):** modal CSV via API; o fluxo atual de “Gerar Resumo” gera **Excel no browser** (`xlsx`) a partir de `executionRows`.

---

## 4. Camada de orquestração (Backend)

A tela não importa arquivos de `automation`. A ponte é:

```
ExecucaoComponent
  → ExecucaoService (HTTP/SSE)
    → routers/execucao.ts
      → execution-service.ts  (fila PQueue)
        → automation/*        (Playwright)
```

### Responsabilidades do `execution-service`

1. Validar empresa / auth e criar registro `Execucao` no banco (`pendente`)
2. Enfileirar tarefa na **PQueue** (concorrência configurável)
3. No worker: emitir SSE `execution:started` e abrir o browser
4. Autenticar (`playwright-nfse` ou `login-credencial-nfse`)
5. Chamar `processarTabelaEmitidas` / `processarTabelaRecebidas`
6. Emitir `execution:stage`, `execution:counts`, `execution:finished`
7. Fechar browser, persistir resultado e métricas

**Producer/worker:** `POST /multiplas` só enfileira (com delay entre adds). O Chromium sobe **somente** no worker.

---

## 5. Módulos de automação (`Backend/src/automation`)

| Arquivo | Responsabilidade | Quem chama |
| ------- | ---------------- | ---------- |
| `playwright-config.ts` | Timeout, headless padrão, viewport, args Chromium | `playwright-nfse` |
| `playwright-nfse.ts` | Contexto com client certificate (PFX) + login “Certificado” | `execution-service` |
| `login-credencial-nfse.ts` | Login formulário CNPJ/CPF + senha; retorna `Page` aberta | `execution-service` |
| `validar-credencial-nfse.ts` | Teste de login (OK/INVÁLIDA) **sem** baixar notas | `validacoes-service` (tela Empresas) |
| `processar-notas-competencia.ts` | Menus Emitidas/Recebidas, datas, paginação, integração captcha | `execution-service` |
| `download-operation.ts` | Download XML/PDF por nota com retry e novo desafio captcha | `processar-notas-competencia` |
| `download-operation-types.ts` | Status tipados da operação, classificação de erro | `download-operation` |
| `download-manager.ts` | Base path, pastas, sanitização, validação de arquivo | download-operation / processar |
| `captcha-solver.ts` | API 2Captcha (hCaptcha v1/v2) | `processar-notas-competencia` |
| `captcha-report.ts` | Log/relatório de sessão 2Captcha | captcha-solver / main |
| `scripts/test-playwright.ts` | Smoke test manual (`npm run test:playwright`) | CLI |

### 5.1 Papel de cada etapa no portal

```
Autenticação
  certificado  → playwright-nfse.abrirDashboardNfse / criarContextoComCertificado
  credencial   → login-credencial-nfse.abrirDashboardNfseComCredencial
        │
        ▼
Processamento de competência
  processar-notas-competencia
    ├── preencherDatasEFiltrar
    ├── processarTabelaEmitidas
    └── processarTabelaRecebidas
        │
        ▼
Por linha da tabela
  download-operation.executarDownloadNotaComRetry
    ├── download-manager (salvar/validar)
    └── captcha-solver (se modal hCaptcha)
```

### 5.2 `validar-credencial-nfse` vs `login-credencial-nfse`

| | Validação | Execução |
| - | --------- | -------- |
| Arquivo | `validar-credencial-nfse.ts` | `login-credencial-nfse.ts` |
| Tela | Empresas (validação em massa) | Execução de Processos |
| Objetivo | Só confirmar login | Manter sessão e baixar notas |
| Retorno | `{ ok, status, message }` | `ResultadoAutenticacao` com `page`/`browser` |

---

## 6. Correlação tela ↔ automação

### 6.1 Matriz ação UI → endpoint → serviço → módulo automation

| Ação na tela | Endpoint | Serviço backend | Módulo(s) automation |
| ------------ | -------- | --------------- | -------------------- |
| Selecionar contabilidade | `GET .../companies/summary` | `execution-summary.service` | — (só banco/status) |
| Carregar empresas validadas | `GET .../companies` | `execution-summary.service` | — |
| Iniciar lote | `POST .../multiplas` | `execution-service.adicionarExecucao` | (enfileira; worker usa todos abaixo) |
| Worker: auth certificado | (interno) | `execution-service` | `playwright-nfse` + `playwright-config` |
| Worker: auth credencial | (interno) | `execution-service` | `login-credencial-nfse` |
| Worker: baixar notas | (interno) | `execution-service` | `processar-notas-competencia` → `download-operation` → `download-manager` / `captcha-solver` |
| Acompanhar tempo real | `GET .../stream/:batch_id` | `execution-events.service` | (eventos emitidos pelo worker) |
| Polling fallback | `GET .../batch/:id/status` | `execution-service.obterStatusBatch` | — |
| Salvar log do lote | `POST /api/logs/execucoes/salvar` | repositório de batch log | — |
| Gerar Resumo | (client-side Excel) | — | — |

### 6.2 Diagrama de correlação

```
┌─────────────────────────────────────┐
│  ExecucaoComponent (/execucao)      │
│  Controles + tabela + SSE/polling  │
└─────────────────┬───────────────────┘
                  │ HTTP / SSE
                  ▼
┌─────────────────────────────────────┐
│  /api/execucao (router)             │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  execution-service (PQueue)         │
│  emitirEventoExecucao (SSE)         │
└─────────────────┬───────────────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
┌──────────────────┐  ┌─────────────────────┐
│ playwright-nfse  │  │ login-credencial    │
│ (certificado)    │  │ -nfse (credencial)  │
└────────┬─────────┘  └──────────┬──────────┘
         └──────────┬────────────┘
                    ▼
         ┌──────────────────────────┐
         │ processar-notas-         │
         │ competencia              │
         └────────────┬─────────────┘
                      ▼
         ┌──────────────────────────┐
         │ download-operation       │
         │  + download-manager      │
         │  + captcha-solver        │
         └──────────────────────────┘
```

### 6.3 Eventos SSE → colunas da tabela

| Evento SSE | Atualização na UI (`executionRows`) |
| ---------- | ----------------------------------- |
| `execution:started` | Status `EM_EXECUCAO`, mensagem “Abrindo navegador…”, método |
| `execution:stage` | Mensagem / etapa (ex.: captcha, filtrando, baixando) |
| `execution:counts` | NF Emitidas / Recebidas / Canceladas |
| `execution:finished` | Status `OK` ou `ERRO`, mensagem de erro, contagens finais |

O polling de batch reforça o mesmo estado caso o SSE falhe ou a UI perca eventos.

---

## 7. API REST usada pela tela

| Método | Rota | Uso na tela |
| ------ | ---- | ----------- |
| `GET` | `/api/execucao/companies/summary?contabilidade_id=` | Cards Total / Aptas / Inoperantes / Parciais |
| `GET` | `/api/execucao/companies?contabilidade_id=` | Lista aptas no modal (fallback) |
| `POST` | `/api/execucao/multiplas` | Botão **Iniciar** (lote) |
| `GET` | `/api/execucao/stream/:batch_id` | SSE após iniciar |
| `GET` | `/api/execucao/batch/:batch_id/status` | Polling a cada 2,5s |
| `POST` | `/api/execucao/:empresa_id` | Execução unitária (legado / `executarCertificado`) |
| `GET` | `/api/execucao/:empresa_id/status` | Polling individual (sem batch) |

**Body típico de `POST /multiplas`:**

```json
{
  "empresas": [
    { "empresa_id": "123", "cnpj": "12345678000199", "tipo_autenticacao": "certificado" }
  ],
  "dataInicio": "01/07/2026",
  "dataFim": "31/07/2026",
  "tipo": "ambas",
  "headless": false,
  "baixarPdf": true,
  "contabilidade_id": 1
}
```

**Resposta:** `batch_id`, `started`, `erros`, `execucoes[]`, `detalhes_erros[]`.

---

## 8. Status e mapeamentos

### Backend → Frontend (polling / status HTTP)

| Backend (`Execucao` / memória) | Frontend (`StatusExecucao`) | Linha (`ExecutionRowStatus`) |
| ------------------------------ | --------------------------- | ---------------------------- |
| `pendente` | `fila` | `FILA` |
| `em_execucao` | `executando` | `EM_EXECUCAO` |
| `concluido` | `finalizado` | `OK` |
| `falhou` | `falhou` | `ERRO` |

### Resultado final (após sucesso)

| `resultado_final` | Significado |
| ----------------- | ----------- |
| `SEM_MOVIMENTO` | Nenhuma nota no período |
| `NOTAS_EMITIDAS` | Só emitidas |
| `NOTAS_RECEBIDAS` | Só recebidas |
| `NFS_ENCONTRADAS` | Emitidas e recebidas |

### Grupos do summary (pré-execução)

| Grupo | Critério (visão da tela) |
| ----- | ------------------------ |
| Aptas | Operacionais / atenção — podem entrar no lote |
| Inoperantes | Sem condição de autenticar/executar |
| Parciais | Cadastro incompleto ou status parcial |

---

## 9. Fluxo ponta a ponta

```
Usuário                    Frontend                         Backend                         Automação
   │                          │                                │                                │
   │  Seleciona contabilidade │                                │                                │
   │─────────────────────────>│  GET /companies/summary        │                                │
   │                          │───────────────────────────────>│                                │
   │  Cards summary           │<───────────────────────────────│                                │
   │                          │                                │                                │
   │  Carrega + seleciona     │  (estado local FILA)           │                                │
   │  Iniciar                 │  POST /multiplas               │                                │
   │─────────────────────────>│───────────────────────────────>│  PQueue.add (delay)            │
   │                          │  batch_id + SSE                │                                │
   │                          │<───────────────────────────────│                                │
   │                          │  GET /stream/:batch_id         │                                │
   │                          │───────────────────────────────>│                                │
   │                          │                                │  worker: abrirDashboard*       │
   │                          │                                │───────────────────────────────>│
   │                          │  SSE started / stage           │  processar tabelas             │
   │  Tabela atualiza         │<───────────────────────────────│───────────────────────────────>│
   │                          │  SSE counts / finished         │  download + captcha            │
   │  OK / ERRO               │<───────────────────────────────│<───────────────────────────────│
```

Detalhes de concorrência, delay entre lançamentos e estrutura de pastas: ver [AUTOMACAO_NFSE.md](./AUTOMACAO_NFSE.md).

---

## 10. Arquivos baixados

Organização típica (via `download-manager` + settings):

```
{downloadsBasePath}/
└── {nomeContabilidade}/
    └── {mês}-{ano}/              # ex.: julho-2026
        └── {nomeEmpresa}/
            ├── Emitidas/
            │   ├── {chave}.xml
            │   └── {chave}.pdf   # se baixarPdf = true
            └── Recebidas/
                ├── {chave}.xml
                └── {chave}.pdf
```

Configurável em **Configurações** (`downloadsBasePath`, concorrência, delays) — impacta o mesmo `execution-service` / `download-manager` usados pela tela.

---

## 11. Referências

| Documento | Conteúdo |
| --------- | -------- |
| [AUTOMACAO_NFSE.md](./AUTOMACAO_NFSE.md) | Fila, concorrência, SSE, resultados, diagramas |
| [FLUXOS.md](./FLUXOS.md) | Fluxo de negócio “Execução de Automação” |
| [API_REFERENCE.md](./API_REFERENCE.md) | Contratos dos endpoints |
| [TELA_EMPRESAS.md](./TELA_EMPRESAS.md) | Cadastro e validação (usa `validar-credencial-nfse`) |
| [ARQUITETURA.md](./ARQUITETURA.md) | Visão geral do sistema |
| [FRONTEND.md](./FRONTEND.md) / [BACKEND.md](./BACKEND.md) | Camadas técnicas |

### Arquivos-chave para leitura rápida

- UI: `Frontend/src/app/components/execucao/execucao.component.ts`
- Cliente API: `Frontend/src/app/services/execucao.service.ts`
- Rotas: `Backend/src/routers/execucao.ts`
- Orquestração: `Backend/src/services/execution-service.ts`
- Motor: `Backend/src/automation/` (tabela da [seção 5](#5-módulos-de-automação-backendsrcautomation))

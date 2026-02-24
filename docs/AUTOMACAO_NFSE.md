# Automação NFSe — Funcionamento Completo

Este documento descreve o funcionamento ponta a ponta da automação de download de notas fiscais no portal NFSe Nacional, tanto para **execução individual** quanto para **filas de processamento** com múltiplos navegadores.

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Execução Individual (Uma Empresa)](#2-execução-individual-uma-empresa)
3. [Filas de Processamento (Múltiplas Empresas)](#3-filas-de-processamento-múltiplas-empresas)
4. [Configurações Relevantes](#4-configurações-relevantes)
5. [Diagramas de Fluxo](#5-diagramas-de-fluxo)

---

## 1. Visão Geral

A automação NFSe permite baixar notas fiscais (XML e PDF) do portal nacional (nfse.gov.br) para múltiplas empresas. O sistema suporta:

- **Autenticação por certificado digital A1** (.pfx) ou **credenciais** (CNPJ/CPF + senha)
- **Execução individual** via `POST /api/execucao/:empresa_id`
- **Execução em lote** via `POST /api/execucao/multiplas`
- **Atualizações em tempo real** via SSE (Server-Sent Events) e polling em lote

### Componentes Principais

| Componente | Responsabilidade |
|------------|------------------|
| `execution-service.ts` | Orquestra fila, execuções e fluxo completo |
| `playwright-nfse.ts` | Autenticação no portal (certificado A1) |
| `login-credencial-nfse.ts` | Autenticação via CNPJ/CPF + senha |
| `processar-notas-competencia.ts` | Varredura de tabelas, download de XML/PDF |
| `download-manager.ts` | Organização de pastas e salvamento de arquivos |
| `execution-events.service.ts` | Emissão de eventos SSE para o frontend |

---

## 2. Execução Individual (Uma Empresa)

### 2.1 Início da Execução

**Endpoint:** `POST /api/execucao/:empresa_id?dataInicio=DD/MM/YYYY&dataFim=DD/MM/YYYY&tipo=ambas`

1. O backend valida empresa e datas
2. Chama `adicionarExecucao()` no `execution-service`
3. Cria registro na tabela `Execucao` (status: `pendente`)
4. Adiciona à fila `PQueue` e retorna imediatamente (HTTP 202)

### 2.2 Fluxo Completo de Uma Execução

Quando a tarefa é retirada da fila, o `executarFluxoCompleto()` executa:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. INICIALIZAÇÃO                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ • Registra execução em execucoesAtivas (Map em memória)                  │
│ • Emite evento SSE: execution:started                                    │
│ • Atualiza status no banco: em_execucao, etapa: autenticacao             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. AUTENTICAÇÃO                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│ Certificado:                    │ Credencial:                            │
│ • Carrega PFX (Storage/loader)  │ • Busca credencial no banco            │
│ • Cria contexto Chromium        │ • Descriptografa senha                 │
│ • Configura clientCertificates  │ • Abre Chromium                         │
│ • Navega ao portal NFSe         │ • Navega ao portal NFSe                 │
│ • Clica em "Certificado"        │ • Preenche CNPJ/CPF + senha             │
│ • Aguarda redirect ao Dashboard │ • Submete formulário                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. PROCESSAMENTO DE NOTAS EMITIDAS (se tipo = emitidas ou ambas)        │
├─────────────────────────────────────────────────────────────────────────┤
│ • Clica no menu "Notas Emitidas"                                         │
│ • Preenche datas (dataInicio, dataFim) e filtra                          │
│ • Varre tabela com paginação:                                            │
│   - Para cada linha: verifica se cancelada, baixa XML e PDF               │
│   - Clica em "Próxima" até não haver mais páginas                         │
│ • Salva em: {downloads}/{contabilidade}/{empresa}/Emitidas/              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. PROCESSAMENTO DE NOTAS RECEBIDAS (se tipo = recebidas ou ambas)      │
├─────────────────────────────────────────────────────────────────────────┤
│ • Clica no menu "Notas Recebidas"                                        │
│ • Preenche datas e filtra                                                │
│ • Varre tabela com paginação (mesmo fluxo das emitidas)                   │
│ • Salva em: {downloads}/{contabilidade}/{empresa}/Recebidas/             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. FINALIZAÇÃO                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ • Emite evento SSE: execution:finished (status OK)                       │
│ • Atualiza banco: status concluido, qtdNotasEmitidas, qtdNotasRecebidas   │
│ • Fecha página e navegador                                               │
│ • Remove de execucoesAtivas                                              │
│ • Persiste métricas (automation-metrics)                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Estrutura de Pastas dos Downloads

```
{downloadsBasePath}/
└── {nomeContabilidade}/
    └── {ano}-{mes}/                    # Ex: fevereiro-2026
        └── {nomeEmpresa}/
            ├── Emitidas/
            │   ├── {chaveNfse}.xml
            │   └── {chaveNfse}.pdf
            └── Recebidas/
                ├── {chaveNfse}.xml
                └── {chaveNfse}.pdf
```

### 2.4 Resultados Possíveis

| Resultado | Condição |
|-----------|----------|
| `SEM_MOVIMENTO` | Nenhuma nota emitida nem recebida |
| `NOTAS_EMITIDAS` | Apenas emitidas encontradas |
| `NOTAS_RECEBIDAS` | Apenas recebidas encontradas |
| `NFS_ENCONTRADAS` | Emitidas e recebidas encontradas |

---

## 3. Filas de Processamento (Múltiplas Empresas)

### 3.1 Início em Lote

**Endpoint:** `POST /api/execucao/multiplas`

**Body:**
```json
{
  "empresas": [
    { "empresa_id": "123", "cnpj": "12.345.678/0001-99", "tipo_autenticacao": "certificado" },
    { "empresa_id": "124", "cnpj": "98.765.432/0001-88", "tipo_autenticacao": "credenciais" }
  ],
  "dataInicio": "01/02/2026",
  "dataFim": "28/02/2026",
  "tipo": "ambas",
  "headless": false,
  "contabilidade_id": 1
}
```

### 3.2 Delay Entre Lançamentos

Para evitar abrir todos os navegadores de uma vez (o que pode travar o sistema), o backend aplica um **delay entre cada adição à fila**:

```
Empresa 1 → adicionarExecucao() → [delay 150ms] →
Empresa 2 → adicionarExecucao() → [delay 150ms] →
Empresa 3 → adicionarExecucao() → ...
```

- O delay é configurável em **Configurações → Delay entre Lançamentos (ms)** (padrão: 150ms)
- Cada empresa é adicionada à fila com intervalo, espaçando o início das execuções
- O navegador da empresa 1 abre e começa a executar; 150ms depois o da empresa 2; e assim por diante

### 3.3 Fila PQueue e Concorrência

A fila usa a biblioteca **p-queue** com as seguintes características:

| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `concurrency` | Configurável (padrão: 3) | Número máximo de navegadores abertos simultaneamente |
| `autoStart` | `true` | Processamento inicia assim que há tarefas |

**Fluxo com 10 empresas e concurrency=3:**

```
t=0ms     Empresa 1 adicionada → Worker 1 pega → Abre navegador 1
t=150ms   Empresa 2 adicionada → Worker 2 pega → Abre navegador 2
t=300ms   Empresa 3 adicionada → Worker 3 pega → Abre navegador 3
t=450ms   Empresa 4 adicionada → Aguarda (todos os workers ocupados)
...
t=?       Navegador 1 fecha → Worker 1 livre → Pega Empresa 4 → Abre navegador 4
```

- Múltiplos navegadores rodam em paralelo (até o limite de concorrência)
- O delay entre adds evita pico de abertura simultânea
- Cada navegador executa independentemente e fecha ao terminar

### 3.4 Batch ID e Rastreamento

Cada lote recebe um `batch_id` (UUID) único:

- Todas as execuções do lote compartilham o mesmo `batch_id`
- Usado para: SSE, polling em lote, métricas e logs
- O frontend conecta ao stream: `GET /api/execucao/stream/:batch_id`

### 3.5 Atualizações em Tempo Real (Frontend)

#### SSE (Server-Sent Events) — Primário

O backend emite eventos durante a execução:

| Evento | Quando | Dados |
|--------|--------|-------|
| `execution:started` | Navegador aberto, automação iniciada | empresa_id, cnpj, razao_social, metodo |
| `execution:stage` | Mudança de etapa | empresa_id, stage, message |
| `execution:counts` | Contagem de notas atualizada | empresa_id, qtd_emitidas, qtd_recebidas, qtd_canceladas |
| `execution:finished` | Execução concluída (OK ou ERRO) | empresa_id, status, message, contagens |

O frontend mantém conexão SSE aberta e atualiza a tabela em tempo real.

#### Polling em Lote — Fallback

Para evitar N requests simultâneos (um por empresa), o frontend usa **1 request por batch**:

- **Endpoint:** `GET /api/execucao/batch/:batch_id/status`
- **Intervalo:** 2,5 segundos
- **Resposta:** Lista de status de todas as execuções ativas do batch

Isso evita crash da aplicação quando há muitas empresas (ex.: 100+).

#### Polling Individual — Fallback sem batch_id

Quando não há `batch_id` (execução iniciada por outro meio), usa-se polling por empresa: `GET /api/execucao/:empresa_id/status` a cada 2 segundos.

### 3.6 Fallback de Status (Execução Já Finalizada)

Quando uma execução termina, ela é removida de `execucoesAtivas`. Se o frontend fizer polling depois disso, o endpoint `GET /:empresa_id/status` retornaria 404.

O backend implementa **fallback para o banco**: se não encontrar em memória, busca a última execução da empresa na tabela `Execucao` e retorna o status final (concluído ou falhou).

---

## 4. Configurações Relevantes

| Configuração | Descrição | Padrão |
|--------------|-----------|--------|
| `defaultConcurrentBrowsers` | Navegadores simultâneos na fila | 3 |
| `maxConcurrentBrowsers` | Limite máximo de concorrência | 5 |
| `browserLaunchDelayMs` | Delay entre adicionar cada empresa à fila | 1000 |
| `companyTimeoutSeconds` | Timeout por empresa (segundos) | 300 |
| `minActionDelayMs` | Delay entre ações no Playwright | 500 |
| `headless` | Executar navegador invisível | false |
| `viewportPreset` | Resolução da janela | FULLHD (1920×1080) |
| `downloadsBasePath` | Pasta base de downloads | ./downloads |

**Recomendação:** Para estabilidade, use 2–4 navegadores concorrentes e delay de 150–500ms entre lançamentos.

---

## 5. Diagramas de Fluxo

### 5.1 Execução Individual — Sequência

```
Frontend                Backend                     Fila          Playwright
   │                        │                          │                │
   │  POST /:empresa_id     │                          │                │
   │──────────────────────>│                          │                │
   │                        │  adicionarExecucao()     │                │
   │                        │  criar Execucao (DB)    │                │
   │                        │  fila.add(task)          │                │
   │                        │─────────────────────────>│                │
   │  202 + execucaoId      │                          │                │
   │<──────────────────────│                          │                │
   │                        │                          │  Worker pega   │
   │                        │                          │  executarFluxo │
   │                        │<─────────────────────────│                │
   │                        │  abrirDashboardNfse()    │                │
   │                        │─────────────────────────────────────────>│
   │  SSE: started          │                          │  Chromium      │
   │<──────────────────────│                          │  abre          │
   │                        │  processarNotas()        │                │
   │                        │─────────────────────────────────────────>│
   │  SSE: stage, counts    │                          │  Varre tabela   │
   │<──────────────────────│                          │  Baixa XML/PDF  │
   │                        │  fechar browser          │                │
   │                        │<─────────────────────────────────────────│
   │  SSE: finished         │                          │                │
   │<──────────────────────│                          │                │
```

### 5.2 Execução em Lote — Fila com Delay

```
Frontend                Router                    Fila (PQueue)
   │                        │                          │
   │  POST /multiplas       │                          │
   │  [emp1, emp2, ...]     │                          │
   │──────────────────────>│                          │
   │                        │  for each empresa:       │
   │                        │    adicionarExecucao(1)   │
   │                        │─────────────────────────>│  Worker1: emp1
   │                        │    await delay(150ms)    │
   │                        │    adicionarExecucao(2)  │
   │                        │─────────────────────────>│  Worker2: emp2
   │                        │    await delay(150ms)    │
   │                        │    adicionarExecucao(3)  │
   │                        │─────────────────────────>│  Worker3: emp3
   │                        │    ...                   │
   │  202 + batch_id        │                          │
   │<──────────────────────│                          │
   │                        │                          │
   │  GET /stream/:batch_id │  SSE connection          │
   │──────────────────────>│  (eventos em tempo real) │
   │  GET /batch/:id/status │  (polling a cada 2.5s)   │
   │──────────────────────>│                          │
```

---

## Referências

- [FLUXOS.md](./FLUXOS.md) — Fluxos de negócio gerais
- [ARQUITETURA.md](./ARQUITETURA.md) — Arquitetura do sistema
- [API_REFERENCE.md](./API_REFERENCE.md) — Referência de endpoints

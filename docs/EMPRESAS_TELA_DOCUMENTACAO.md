# Documentação da Tela de Empresas

Tela de cadastro unificado de empresas, certificados digitais e credenciais. Documentação técnica completa cobrindo Frontend, Backend, rotas e serviços vinculados.

---

## Índice

1. [Visão geral](#visão-geral)
2. [Frontend](#frontend)
3. [Backend](#backend)
4. [Rotas da API](#rotas-da-api)
5. [Services vinculados](#services-vinculados)
6. [Models e interfaces](#models-e-interfaces)
7. [Fluxo de dados](#fluxo-de-dados)

---

## Visão geral

A tela **Empresas** é o ponto central de gestão de:

- Empresas (CNPJ, razão social, regime, contabilidade)
- Certificados digitais A1 (.pfx / .p12)
- Credenciais (CNPJ/CPF + senha)

**Rota da aplicação:** `/empresas`

**Redirecionamentos:**
- `/certificados` → `/empresas`
- `/credenciais` → `/empresas`

---

## Frontend

### Arquivos do componente

| Arquivo | Descrição |
|--------|-----------|
| `empresas.component.ts` | Lógica principal, filtros, modais, drawer |
| `empresas.component.html` | Template da tela |
| `empresas.component.scss` | Estilos |
| `empresas-summary-cards/` | Cards de métricas clicáveis (Total, Cert. Vencidos, Cred. Validar, Operacionais) |
| `empresa-drawer/` | Drawer lateral para edição de empresa (dados, certificado, credenciais) |
| `empresas-cadastro/` | Modal de cadastro (escolha: certificado ou credencial) |
| `empresas-validacao-modal/` | Modal de validação em lote (SSE) |
| `import-certificados-lote-modal/` | Modal de importação de certificados (.pfx/.p12) |
| `import-credenciais-modal/` | Modal de importação de credenciais por planilha (.xlsx/.csv) |
| `status.utils.ts` | Utilitários de status (certificado, credenciais, empresa) |

### Configuração de rota

```typescript
// Frontend/src/app/app.routes.ts
{
  path: 'empresas',
  component: EmpresasComponent,
  data: { animation: 'empresas' }
}
```

### Funcionalidades da tela

| Funcionalidade | Descrição |
|----------------|-----------|
| **Summary Cards** | 4 cards clicáveis: Total, Cert. Vencidos, Cred. Validar, Operacionais → filtram a tabela |
| **Listagem** | Tabela com filtros (busca, contabilidade, chips: com/sem cert, com/sem cred, cert vencido, sem método) |
| **Ordenação** | CNPJ, Razão Social, Contabilidade, Certificado, Status |
| **Cadastrar** | Modal com escolha: certificado (.pfx/.p12) ou credencial (CNPJ/CPF + senha) |
| **Editar** | Drawer inline: dados gerais, certificado, credenciais (incl. reativar inativa, atualizar senha) |
| **Importar Certificados** | Modal com upload .pfx/.p12, preview, senha padrão, contabilidade por item |
| **Importar Credenciais** | Modal com upload .xlsx/.csv, preview, contabilidade padrão, atualizar existentes, feedback por linha |
| **Validar** | Modal SSE: validação em lote de certificados e/ou credenciais no portal NFSe |
| **Excluir** | Individual ou em massa (modal de confirmação) |

### Summary Cards (cliques filtram tabela)

| Card | Preset | Descrição |
|------|--------|-----------|
| Total de Empresas | ALL | Remove filtro de preset |
| Certificados Vencidos | CERT_VENCIDO | Filtra empresas com cert vencido |
| Credenciais para Validar | CRED_VALIDAR | Filtra empresas com credenciais pendentes de revalidação (7 dias) |
| Operacionais | OPERACIONAIS | Filtra empresas aptas para automação (OPERACIONAL/ATENCAO) |

### Modais

| Modal | Descrição |
|-------|-----------|
| **Cadastrar** | Escolha certificado ou credencial; formulário conforme opção |
| **Empresa Drawer** | Edição inline na tabela: contabilidade, certificado, credenciais |
| **Import Certificados** | Upload múltiplos .pfx/.p12, senha, preview, contabilidade por item |
| **Import Credenciais** | Upload .xlsx/.csv, contabilidade padrão, checkbox "Atualizar existentes", preview com validação e deduplicação |
| **Validar** | Escopo (todas/selecionadas), alvos (cert/cred), SSE com progresso em tempo real |
| **Confirmar exclusão** | Individual ou remoção de certificado |

---

## Backend

### Estrutura de módulos

O backend possui duas camadas relacionadas a empresas:

1. **Módulo unificado** (`Backend/src/modules/certificados/empresas/`) – API principal consumida pela tela
2. **Router legado** (`Backend/src/routers/empresas.ts`) – Rotas CRUD básicas

### Arquivos do Backend

| Caminho | Descrição |
|---------|-----------|
| `Backend/src/modules/certificados/empresas/index.ts` | Agregador de rotas (unificado + legado) |
| `Backend/src/modules/certificados/empresas/empresas.routes.ts` | Rotas principais da API unificada |
| `Backend/src/modules/certificados/empresas/empresas.controller.ts` | Controllers (request/response) |
| `Backend/src/modules/certificados/empresas/empresas.service.ts` | Regras de negócio, parse de parâmetros |
| `Backend/src/modules/certificados/empresas/empresas.repo.ts` | Repositório com listagem agregada |
| `Backend/src/modules/certificados/empresas/cadastro-certificado.service.ts` | Cadastro via certificado digital |
| `Backend/src/modules/certificados/empresas/cadastro-credencial.service.ts` | Cadastro via credencial |
| `Backend/src/repositories/empresas.ts` | Repositório CRUD básico (legado) |
| `Backend/src/routers/empresas.ts` | Rotas legadas (CRUD) |
| `Backend/src/modules/imports/router.ts` | Rotas de importação em lote |
| `Backend/src/modules/imports/imports.controller.ts` | Controller de imports |
| `Backend/src/routers/validacoes.ts` | Rotas de validação |

### Montagem no main.ts

```typescript
// Backend/src/main.ts
app.use('/api/empresas', empresasRouter);   // /api/empresas/*
app.use('/api/imports', importsRouter);    // /api/imports/*
app.use('/api/validacoes', validacoesRouter); // /api/validacoes/*
app.use('/api/contabilidades', contabilidadesRouter); // /api/contabilidades/*
```

**Base URL da API:** `http://localhost:4321/api` (dev)

---

## Rotas da API

### Empresas (`/api/empresas`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Listar empresas com filtros e paginação |
| `GET` | `/:id` | Obter detalhes da empresa (com certificados e credenciais) |
| `GET` | `/contabilidade/:contabilidade_id` | Listar por contabilidade |
| `GET` | `/cnpj/:cnpj` | Obter empresa por CNPJ |
| `PUT` | `/:id` | Atualizar dados da empresa |
| `POST` | `/cadastro/certificado` | Cadastrar empresa via certificado (.pfx/.p12, multipart) |
| `POST` | `/cadastro/credencial` | Cadastrar empresa via credencial (CNPJ + senha) |
| `DELETE` | `/` | Exclusão em massa (body: `{ ids: number[] }`) |
| `POST` | `/` | Criar empresa (legado, JSON) |
| `DELETE` | `/:empresa_id` | Deletar empresa individual (legado) |

### Parâmetros de listagem (GET `/`)

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `search` | string | Busca por CNPJ ou razão social |
| `contabilidade_id` | number | Filtrar por contabilidade |
| `has_cert` | boolean | Com certificado |
| `has_cred` | boolean | Com credenciais |
| `sem_cert` | boolean | Sem certificado |
| `sem_cred` | boolean | Sem credenciais |
| `sem_metodo` | boolean | Sem nenhum método de autenticação |
| `page` | number | Página (default: 1) |
| `limit` | number | Itens por página (default: 20) |
| `sort` | string | Campo: cnpj, razao_social, contabilidade_nome, cert_validade, has_credenciais, status_geral |
| `order` | 'asc' \| 'desc' | Ordem |

### Imports (`/api/imports`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/certificados/preview` | Preview de certificados em lote (multipart: files, senha) |
| `POST` | `/certificados/confirmar` | Confirmar importação de certificados |
| `POST` | `/credenciais/preview` | Preview de credenciais via planilha (multipart: arquivo) |
| `POST` | `/credenciais/confirmar` | Confirmar importação de credenciais (body: session_id, contabilidade_id_default, updateExisting, rows) |

### Validações (`/api/validacoes`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/start` | Iniciar validação (certificados/credenciais) |
| `GET` | `/:job_id` | Status do job de validação |
| `POST` | `/:job_id/cancel` | Cancelar validação |

### Contabilidades (`/api/contabilidades`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Listar contabilidades |

---

## Rotas e conexões para integração 100%

Base URL da API: `http://localhost:4321/api` (dev). O frontend usa `environment.apiUrl` (ex.: `http://localhost:4321/api`).

### Formato de resposta padrão (Empresas e Imports)

As rotas do módulo unificado de empresas e de imports retornam:

```json
{
  "success": true,
  "data": { ... }
}
```

Em erro: `{ "success": false, "detail": "mensagem" }` com status HTTP 4xx/5xx.

O frontend deve ler sempre `response.data` (o `EmpresasUnificadoService` já faz isso com `unwrap(r)`).

### Contrato completo das rotas

#### 1) Listagem de empresas – `GET /api/empresas`

| Tipo | Nome | Descrição |
|------|------|-----------|
| Query | `search` | Busca por CNPJ ou razão social |
| Query | `contabilidade_id` | ID da contabilidade (número) |
| Query | `has_cert` | `true` / `false` – com certificado |
| Query | `has_cred` | `true` / `false` – com credenciais |
| Query | `sem_cert` | `true` – sem certificado |
| Query | `sem_cred` | `true` – sem credenciais |
| Query | `sem_metodo` | `true` – sem certificado e sem credenciais |
| Query | `page` | Página (default: 1) |
| Query | `limit` | Itens por página (default: 20) |
| Query | `sort` | `cnpj` \| `razao_social` \| `contabilidade_nome` \| `cert_validade` \| `has_credenciais` \| `status_geral` |
| Query | `order` | `asc` \| `desc` |

**Resposta (em `data`):**

```json
{
  "items": [
    {
      "id": "1",
      "cnpj": "54246893000189",
      "razao_social": "EMPRESA EXEMPLO LTDA",
      "regime": null,
      "contabilidade_id": 1,
      "contabilidade_nome": "Contabilidade Alpha",
      "ativo": true,
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-01-01T00:00:00.000Z",
      "has_certificado": true,
      "cert_validade": "15/03/2026",
      "has_credenciais": true,
      "cred_status": "OK",
      "status_geral": "OPERACIONAL",
      "status_geral_motivo": "Certificado válido e credenciais OK"
    }
  ],
  "total": 124,
  "page": 1,
  "limit": 20
}
```

#### 2) Detalhes da empresa – `GET /api/empresas/:id`

**Resposta (em `data`):** objeto com `empresa`, `certificados_digitais` e `credenciais` (ver modelo `EmpresaDetalhes` no front).

#### 3) Atualizar empresa – `PUT /api/empresas/:id` (router legado)

**Body:** `{ "razao_social": "...", "regime": "...", "contabilidade_id": 1 }`  
**Resposta:** objeto simples da empresa (sem `has_certificado` etc.). Após editar, o front pode chamar `GET /api/empresas/:id` para obter detalhes atualizados.

#### 4) Cadastro por certificado – `POST /api/empresas/cadastro/certificado`

**Content-Type:** `multipart/form-data`.  
**Campos:** `file` (arquivo .pfx ou .p12), `senha`, opcional `contabilidade_id`.  
**Resposta (em `data`):** `{ empresa: {...}, has_cert, has_cred, cert_validade, cred_status }`.

#### 5) Cadastro por credencial – `POST /api/empresas/cadastro/credencial`

**Body:** `{ cnpj, razao_social?, senha, tipo?: "CNPJ_SENHA"|"CPF_SENHA", usuario?, contabilidade_id? }`.  
**Resposta (em `data`):** mesmo formato do cadastro por certificado.

#### 6) Exclusão em massa – `DELETE /api/empresas`

**Body:** `{ "ids": [1, 2, 3] }`.  
**Resposta (em `data`):** `{ "success": true, "deleted": 3 }`.

#### 7) Exclusão individual – `DELETE /api/empresas/:empresa_id` (router legado)

**Resposta:** 204 No Content.

#### 8) Criar empresa (JSON, legado) – `POST /api/empresas`

**Body:** `{ cnpj, razao_social, regime?, contabilidade_id? }`.  
**Resposta:** 201 com objeto da empresa.

#### 9) Listar por contabilidade – `GET /api/empresas/contabilidade/:contabilidade_id`

Mesmos query params da listagem. Resposta no mesmo formato de listagem (`items`, `total`, `page`, `limit`).

#### 10) Contabilidades – `GET /api/contabilidades`

**Resposta (sem wrapper success/data):** `{ "contabilidades": [ { id, nome_contabilidade, cnpj, ... } ], "total": N }`.  
O front usa `ContabilidadeService.listar()` e atribui `r.contabilidades ?? []`.

#### 11) KPIs da tela (Dashboard) – `GET /api/dashboard/resumo?period=30d`

**Resposta:** contém, entre outros:

- `empresas_sem_metodo` → card “Sem método”
- `certificados_vencendo` → card “Certificados vencendo”
- `credenciais_invalidas` → card “Credenciais inválidas”
- `empresas_operacionais` → card “Operacionais”

O front pode usar esses campos para preencher os 4 KPI cards em vez de mock.

### Mapeamento chips de filtro → query params

| Chip (id no front) | Query param | Valor |
|--------------------|-------------|--------|
| `com_cert` | `has_cert` | `true` |
| `com_cred` | `has_cred` | `true` |
| `cert_vencido` | (filtro em memória ou backend com `cert_validade` &lt; hoje) | — |
| `sem_cert` | `sem_cert` | `true` |
| `sem_cred` | `sem_cred` | `true` |
| `sem_metodo` | `sem_metodo` | `true` |

### Mapeamento ordenação (dropdown) → sort/order

| Label no front | `sort` | `order` (opcional) |
|----------------|--------|---------------------|
| padrão | (não enviar) | — |
| CNPJ | `cnpj` | `asc` |
| Razão Social | `razao_social` | `asc` |
| Contabilidade | `contabilidade_nome` | `asc` |
| Certificado | `cert_validade` | `asc` |
| Status | `status_geral` | `asc` (ou `desc` para priorizar OPERACIONAL) |

---

## Checklist de integração (Front ↔ Back)

Use este checklist para deixar a tela de Empresas 100% integrada com o backend.

| # | Item | Status sugerido |
|---|------|------------------|
| 1 | **Listagem:** Trocar `listaEmpresas` mock por `EmpresasUnificadoService.listar(params)` com `search`, `contabilidade_id`, chips (`sem_cert`, `sem_cred`, `sem_metodo`, `has_cert`, `has_cred`), `page`, `limit`, `sort`, `order`. | A fazer |
| 2 | **Contagem:** Usar `total` da resposta da listagem para exibir “X empresas” e para paginação. | A fazer |
| 3 | **Contabilidades:** Manter `ContabilidadeService.listar()` no dropdown; resposta já é `{ contabilidades }`. | Feito |
| 4 | **KPIs:** Buscar `GET /api/dashboard/resumo` e mapear `empresas_sem_metodo`, `certificados_vencendo`, `credenciais_invalidas`, `empresas_operacionais` nos 4 cards. | A fazer |
| 5 | **Cadastrar:** Botão “Cadastrar” abrir modal e chamar `cadastroCertificado` ou `cadastroCredencial` conforme escolha; após sucesso, recarregar listagem. | A fazer |
| 6 | **Editar:** Botão “Editar” na linha → navegar ou abrir modal com `obterPorId(id)`; salvar com `atualizar(id, data)`; recarregar listagem. | A fazer |
| 7 | **Deletar:** Botão “Excluir” → confirmar e chamar `DELETE /api/empresas/:id` ou, em lote, `excluirEmMassa(ids)`. | A fazer |
| 8 | **Importar Certificados/Credenciais:** Usar `previewCertificados`/`previewCredenciais` e `confirmarCertificados`/`confirmarCredenciais`; após sucesso, recarregar listagem. | A fazer |
| 9 | **Validar:** Integrar com `ValidacoesService` (`POST /api/validacoes/start`, poll em `GET /api/validacoes/:job_id`). | A fazer |
| 10 | **Exportar:** Definir se é CSV/Excel a partir da listagem atual; pode usar os `items` já carregados ou um endpoint dedicado de exportação. | A fazer |

---

## Services vinculados

### Frontend (Angular)

| Service | Arquivo | Uso na tela Empresas |
|---------|---------|----------------------|
| **EmpresasUnificadoService** | `Frontend/src/app/services/empresas-unificado.service.ts` | Principal – listagem, cadastro, edição, imports, exclusão em massa |
| **ContabilidadeService** | `Frontend/src/app/services/contabilidade.service.ts` | Listar contabilidades para filtros e seleção |
| **ValidacoesService** | `Frontend/src/app/services/validacoes.service.ts` | Validação em lote de certificados e credenciais |

### EmpresasUnificadoService – métodos

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `listar(params)` | GET /api/empresas | Lista com filtros |
| `obterPorId(id)` | GET /api/empresas/:id | Detalhes da empresa |
| `atualizar(id, data)` | PUT /api/empresas/:id | Atualiza dados |
| `cadastroCertificado(file, senha, contabilidade_id?)` | POST /api/empresas/cadastro/certificado | Cadastro via PFX |
| `cadastroCredencial(payload)` | POST /api/empresas/cadastro/credencial | Cadastro via credencial |
| `previewCertificados(files, senha)` | POST /api/imports/certificados/preview | Preview de imports de certificados |
| `confirmarCertificados(payload)` | POST /api/imports/certificados/confirmar | Confirmar import de certificados |
| `previewCredenciais(file)` | POST /api/imports/credenciais/preview | Preview de planilha de credenciais |
| `confirmarCredenciais(payload)` | POST /api/imports/credenciais/confirmar | Confirmar import de credenciais |
| `excluirEmMassa(ids)` | DELETE /api/empresas (body: ids) | Exclusão em lote |

### ContabilidadeService – métodos usados

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `listar()` | GET /api/contabilidades | Lista contabilidades para filtros e dropdowns |

### ValidacoesService – métodos

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `start(payload)` | POST /api/validacoes/start | Inicia job de validação |
| `getStatus(jobId)` | GET /api/validacoes/:job_id | Status do job |
| `cancel(jobId)` | POST /api/validacoes/:job_id/cancel | Cancela validação |

---

## Models e interfaces

### Frontend (`empresas-unificado.model.ts`)

```typescript
EmpresaListagemItem      // Item da tabela
EmpresaListagemResponse  // items, total, page, limit
EmpresaDetalhes          // empresa + certificados + credenciais
CadastroCredencialPayload
CadastroResult
PreviewCertificadosResponse / ConfirmarCertificadosPayload | Response
PreviewCredenciaisResponse / ConfirmarCredenciaisPayload | Response
SortField
StatusGeral              // 'OPERACIONAL' | 'PARCIAL' | 'INOPERANTE'
```

### Backend – principais interfaces

- **CadastroCertificadoInput/Result** – `cadastro-certificado.service.ts`
- **CadastroCredencialInput/Result** – `cadastro-credencial.service.ts`
- **EmpresaListagemParams** – `empresas.repo.ts` / `empresas.service.ts`

---

## Fluxo de dados

### Listagem

1. `EmpresasComponent.carregar()` → `EmpresasUnificadoService.listar(params)`
2. `GET /api/empresas` → `empresas.controller.listar` → `empresas.service.listarEmpresas` → `empresas.repo.listarComAgregados`
3. Resposta: `{ success: true, data: { items, total, page, limit } }`

### Cadastro por certificado

1. Usuário escolhe arquivo .pfx e senha
2. `EmpresasUnificadoService.cadastroCertificado(file, senha, contabilidade_id)`
3. `POST /api/empresas/cadastro/certificado` (multipart)
4. `cadastro-certificado.service.cadastrarPorCertificado` → parse do certificado, criação/atualização de empresa, upload para storage, criação/update de registro em `certificado`

### Cadastro por credencial

1. Formulário: CNPJ, razão social, senha, contabilidade
2. `EmpresasUnificadoService.cadastroCredencial(payload)`
3. `POST /api/empresas/cadastro/credencial`
4. `cadastro-credencial.service.cadastrarPorCredencial` → cria/atualiza empresa e credencial

### Importação em lote (certificados)

1. Upload de múltiplos .pfx + senha comum
2. `previewCertificados` → `POST /api/imports/certificados/preview` → retorna session_id + items
3. Usuário confirma itens desejados
4. `confirmarCertificados` → `POST /api/imports/certificados/confirmar`

### Importação em lote (credenciais)

1. Upload de planilha .xlsx/.csv (colunas: Razão Social, Tipo Login, CNPJ/CPF, Senha, Regime opcional)
2. `previewCredenciais` → `POST /api/imports/credenciais/preview` → retorna session_id + rows com validação e deduplicação
3. Usuário define contabilidade padrão, marca "Atualizar existentes" (opcional), seleciona linhas
4. `confirmarCredenciais` → `POST /api/imports/credenciais/confirmar` com `{ session_id, contabilidade_id_default, updateExisting, rows: [{ rowIndex, contabilidade_id? }] }`
5. Resposta com `results[]` por linha (IMPORTED, UPDATED, SKIPPED_EXISTS, ERROR) e resumo (criadas, atualizadas, erros, skipped)

### Validação

1. Usuário define alvos (certificado/credencial), escopo e opções
2. `ValidacoesService.start(payload)` → `POST /api/validacoes/start`
3. Backend retorna `job_id`
4. Frontend faz poll em `GET /api/validacoes/:job_id` a cada 2 segundos até `DONE`, `FAILED` ou `CANCELED`

---

## Resumo de dependências

```
EmpresasComponent
├── EmpresasUnificadoService  → /api/empresas, /api/imports
├── ContabilidadeService      → /api/contabilidades
└── ValidacoesService        → /api/validacoes
```

---

## Resumo rápido de URLs (base: `/api`)

| Ação | Método | URL |
|------|--------|-----|
| Listar empresas (filtros, paginação) | GET | `/empresas` |
| Detalhes da empresa | GET | `/empresas/:id` |
| Atualizar empresa | PUT | `/empresas/:id` |
| Cadastro por certificado (PFX) | POST | `/empresas/cadastro/certificado` |
| Cadastro por credencial | POST | `/empresas/cadastro/credencial` |
| Exclusão em massa | DELETE | `/empresas` (body: `{ ids }`) |
| Excluir uma empresa | DELETE | `/empresas/:id` |
| Listar contabilidades | GET | `/contabilidades` |
| KPIs (resumo) | GET | `/dashboard/resumo?period=30d` |
| Preview import certificados | POST | `/imports/certificados/preview` |
| Confirmar import certificados | POST | `/imports/certificados/confirmar` |
| Preview import credenciais | POST | `/imports/credenciais/preview` |
| Confirmar import credenciais | POST | `/imports/credenciais/confirmar` |
| Iniciar validação | POST | `/validacoes/start` |
| Status validação | GET | `/validacoes/:job_id` |

---

*Documentação gerada em fevereiro/2025 – Projeto AutoNacional*

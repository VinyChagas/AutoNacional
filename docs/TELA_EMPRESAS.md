# Tela de Empresas — Documentação Completa

> Documentação de ponta a ponta do cadastro unificado de empresas: frontend Angular, APIs Express, repositórios, utilitários e fluxos de negócio.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Mapa de arquivos](#2-mapa-de-arquivos)
3. [Frontend](#3-frontend)
4. [Backend](#4-backend)
5. [API REST](#5-api-rest)
6. [Modelos de dados](#6-modelos-de-dados)
7. [Status e regras de negócio](#7-status-e-regras-de-negócio)
8. [Utilitários (`Backend/src/utils`)](#8-utilitários-backendsrcutils)
9. [Fluxos principais](#9-fluxos-principais)
10. [Banco de dados](#10-banco-de-dados)
11. [Integrações relacionadas](#11-integrações-relacionadas)
12. [Observações e limitações](#12-observações-e-limitações)

---

## 1. Visão geral

A tela **Empresas** (`/empresas`) é o hub de cadastro unificado do AutoNacional. Substitui as telas legadas de certificados e credenciais (que hoje redirecionam para `/empresas`).

**Responsabilidades:**

| Área | O que faz |
| ---- | --------- |
| Listagem | Paginação, busca, filtros por chips/cards, ordenação, seleção em massa |
| KPIs | Cards de resumo (total, cert. vencidos, cred. para validar, operacionais) |
| Cadastro | Empresa via certificado digital (.pfx/.p12) ou via credencial (CNPJ/CPF + senha) |
| Edição | Drawer inline: contabilidade, credenciais, upload/remoção de certificado |
| Importação | Lote de certificados e planilha de credenciais (preview → confirmar) |
| Validação | Teste em massa de credenciais com progresso em tempo real (SSE) |
| Exclusão | Individual (com confirmação) e suporte a exclusão em massa na API |

**Rota Angular:** `/empresas` → `EmpresasComponent`  
**Base da API:** `/api/empresas` (módulo unificado + router legado montados juntos)

---

## 2. Mapa de arquivos

### Frontend

```
Frontend/src/app/
├── app.routes.ts                          # Rota /empresas (+ redirects /certificados, /credenciais)
├── models/
│   ├── empresas-unificado.model.ts        # Tipos da tela unificada
│   └── empresas.model.ts                  # Modelo legado (EmpresasService)
├── services/
│   ├── empresas-unificado.service.ts      # Serviço principal da tela
│   ├── empresas.service.ts                # Serviço legado (CRUD simples)
│   ├── contabilidade.service.ts           # Lista contabilidades (filtro/cadastro)
│   ├── credenciais.service.ts             # Atualizar status/senha no drawer
│   ├── validacoes.service.ts              # Job + stream de validação
│   └── toast.service.ts                   # Feedback ao usuário
└── components/empresas/
    ├── empresas.component.ts|html|scss    # Tela principal (orquestrador)
    ├── status.utils.ts                    # Status cert/cred/geral (funções puras)
    ├── empresa-drawer/                    # Edição rápida (inline/drawer)
    ├── empresas-cadastro/                 # Modal cadastro unitário
    ├── empresas-summary-cards/            # Cards KPI + presets de filtro
    ├── empresas-validacao-modal/          # Validação em massa
    ├── import-certificados-lote-modal/    # Import .pfx em lote
    └── import-credenciais-modal/          # Import planilha Excel/CSV
```

### Backend

```
Backend/src/
├── main.ts                                # app.use('/api/empresas', empresasRouter)
├── modules/
│   ├── index.ts                           # Exporta empresasRouter, importsRouter, …
│   ├── certificados/empresas/
│   │   ├── index.ts                       # Une rotas unificadas + legado
│   │   ├── empresas.routes.ts             # GET list/summary/detalhe, cadastros, delete massa
│   │   ├── empresas.controller.ts         # Request/response
│   │   ├── empresas.service.ts            # Parse de query + regras de filtro
│   │   ├── empresas.repo.ts               # Listagem com agregados, summary, detalhes
│   │   ├── cadastro-certificado.service.ts
│   │   └── cadastro-credencial.service.ts
│   └── imports/
│       ├── router.ts                      # /api/imports/certificados|credenciais
│       └── …                              # preview/confirmar
├── routers/
│   └── empresas.ts                        # LEGADO: POST /, PUT /:id, DELETE /:id
├── repositories/
│   └── empresas.ts                        # CRUD Prisma básico (legado + helpers)
└── utils/
    ├── cnpj.ts                            # normalizeCnpj / isValidCnpjFormat
    ├── documento.utils.ts                 # CNPJ/CPF (pad CPF → 000+CPF)
    ├── certificado.parser.ts              # Parse PFX/P12 (ICP-Brasil)
    ├── certificado-utils.ts               # Extração legada de info do cert
    ├── planilha.parser.ts                 # Excel/CSV de credenciais
    └── crypto.ts                          # AES-256-GCM para senhas de credencial
```

> O diretório `Backend/dist/routers/empresas.*` é apenas o artefato compilado do TypeScript. A fonte da verdade é `Backend/src/`.

---

## 3. Frontend

### 3.1 Rota

| Path | Componente | Observação |
| ---- | ---------- | ---------- |
| `/empresas` | `EmpresasComponent` | Tela ativa |
| `/certificados` | redirect → `empresas` | Legado |
| `/credenciais` | redirect → `empresas` | Legado |

### 3.2 `EmpresasComponent` (orquestrador)

Arquivo: `Frontend/src/app/components/empresas/empresas.component.ts`

**OnInit:** carrega contabilidades, listagem e summary.

**Estado principal:**

| Estado | Uso |
| ------ | --- |
| `search` | Busca com debounce 350 ms |
| `contabilidadeId` | Filtro por escritório |
| `chipsAtivos` | Filtros `com_cert`, `com_cred`, `sem_cert`, `sem_cred`, `sem_metodo` |
| `presetActive` | Filtro em memória via clique nos cards |
| `page` / `pageSize` | Paginação (20 / 50 / 100) |
| `listaEmpresas` | Itens da página atual |
| `summary` | KPIs dos cards |
| `selectedIds` | Seleção para validação |
| `empresaSelecionada` / `empresaDetalhes` | Linha expandida + drawer |
| Modais (`cadastroAberto`, imports, validação, exclusão) | Fluxos secundários |

**Serviços injetados:** `EmpresasUnificadoService`, `ContabilidadeService`, `CredenciaisService`, `ToastService`.

### 3.3 Componentes filhos

#### `EmpresasSummaryCardsComponent`

Quatro cards KPI:

1. **Total de Empresas**
2. **Certificados Vencidos** → preset `CERT_VENCIDO`
3. **Credenciais para Validar** → preset `CRED_VALIDAR` (regra de 7 dias)
4. **Operacionais** → preset `OPERACIONAIS` (status `OPERACIONAL` ou `ATENCAO`)

Clique no card ativo desliga o preset. O filtro de preset é **em memória** sobre a página já carregada; busca/contabilidade/chips vão para a API.

#### `EmpresaDrawerComponent`

Edição da empresa selecionada:

- Alterar **contabilidade**
- Gerenciar **credenciais** (`CREATE`, `UPDATE`, `REACTIVATE`, `MARK_INACTIVE`)
- Upload de **certificado** (arquivo + senha)
- Remoção de certificado (com confirmação no pai)
- Dirty-check: avisa ao fechar com alterações não salvas

Payload de save: `EditorSavePayload` (emitido para o pai, que chama as APIs).

#### `EmpresasCadastroComponent`

Modal de cadastro unitário com dois métodos:

| Método | Campos | Endpoint |
| ------ | ------ | -------- |
| Certificado | arquivo .pfx/.p12, senha, contabilidade | `POST /api/empresas/cadastro/certificado` |
| Credencial | CNPJ ou CPF, razão social, senha, contabilidade | `POST /api/empresas/cadastro/credencial` |

Contabilidade é **obrigatória** no formulário.

#### `ImportCertificadosLoteModalComponent`

1. Seleciona vários `.pfx`/`.p12` + senha
2. `POST /api/imports/certificados/preview`
3. Usuário revisa itens (válido / vencido / duplicado / erro)
4. `POST /api/imports/certificados/confirmar`
5. Recarrega listagem + summary

#### `ImportCredenciaisModalComponent`

1. Upload de planilha (xlsx/csv)
2. `POST /api/imports/credenciais/preview`
3. Seleção de linhas, contabilidade padrão, opção `updateExisting`
4. `POST /api/imports/credenciais/confirmar`
5. Resumo (criadas / atualizadas / erros)

**Formato da planilha** (linha 2 = cabeçalhos):

| Coluna | Conteúdo |
| ------ | -------- |
| A | Razão Social |
| B | Tipo de Login (CNPJ / CPF) |
| C | CNPJ ou CPF |
| D | Senha |
| E | Regime Tributário |

#### `EmpresasValidacaoModalComponent`

- Escopo: **filtradas** ou **selecionadas**
- Chama `ValidacoesService.iniciar` + `stream(job_id)` (SSE)
- Exibe progresso por empresa e totais ao final
- Por padrão valida só credenciais (`validar_credenciais: true`)

### 3.4 `status.utils.ts`

Funções puras usadas na UI (podem divergir levemente do status calculado no backend — ver [§7](#7-status-e-regras-de-negócio)):

| Função | Retorno |
| ------ | ------- |
| `computeCertStatus` | `SEM_CERTIFICADO`, `VENCIDO`, `VENCENDO` (≤30 dias), `VALIDO`, `ERRO_CERT` |
| `computeCredStatus` | Status normalizado da API |
| `needsRevalidateCredentials` | `true` se não testada / inválida / erro, ou OK com último teste > 7 dias |
| `computeCompanyStatusGeral` | `OPERACIONAL`, `ATENCAO`, `PARCIAL`, `INOPERANTE` |
| `computeStatusReason` | Texto curto para tooltip |
| `getCertDisplayInfo` | Label + “X dias para vencer / vencido há X dias” |

### 3.5 Serviços HTTP

#### `EmpresasUnificadoService` (tela atual)

| Método | HTTP |
| ------ | ---- |
| `listar` | `GET /api/empresas` |
| `getSummary` | `GET /api/empresas/summary` |
| `obterPorId` | `GET /api/empresas/:id` |
| `atualizar` | `PUT /api/empresas/:id` |
| `excluir` | `DELETE /api/empresas/:id` |
| `excluirEmMassa` | `DELETE /api/empresas` body `{ ids }` |
| `cadastroCertificado` | `POST /api/empresas/cadastro/certificado` (multipart) |
| `cadastroCredencial` | `POST /api/empresas/cadastro/credencial` |
| `previewCertificados` / `confirmarCertificados` | `/api/imports/certificados/*` |
| `previewCredenciais` / `confirmarCredenciais` | `/api/imports/credenciais/*` |
| `removerCertificado` | `DELETE /api/certificados/cnpj/:cnpj` |

Respostas no envelope `{ success, data, message }` são desempacotadas via `unwrap`.

#### `EmpresasService` (legado)

Ainda usado em outras telas (ex.: execução / contabilidades). CRUD simples em `/api/empresas`. A listagem unificada da tela Empresas **não** usa este serviço.

---

## 4. Backend

### 4.1 Montagem das rotas

Em `Backend/src/modules/certificados/empresas/index.ts`:

```ts
router.use(empresasRoutes);        // unificado (listagem, summary, cadastros…)
router.use(empresasRouterLegacy);  // POST /, PUT /:id, DELETE /:id
```

Em `main.ts`: `app.use('/api/empresas', empresasRouter)`.

**Ordem importa:** rotas específicas (`/summary`, `/cadastro/...`, `/contabilidade/:id`, `/cnpj/:cnpj`) vêm **antes** de `/:id`.

### 4.2 Camadas do módulo unificado

```
empresas.routes.ts
    → empresas.controller.ts
        → empresas.service.ts          (parse/validação de query)
        → empresas.repo.ts             (Prisma + agregados)
        → cadastro-certificado.service.ts
        → cadastro-credencial.service.ts
```

### 4.3 Router legado (`Backend/src/routers/empresas.ts`)

| Método | Path | Função |
| ------ | ---- | ------ |
| `POST` | `/` | Criar empresa (Zod: CNPJ 14 dígitos + razão social). Bloqueia se CNPJ já tem certificado |
| `PUT` | `/:id` | Atualizar razão social / regime / contabilidade |
| `DELETE` | `/:id` | Excluir → `204 No Content` |

Usa `repositories/empresas` e `normalizeCnpj` de `utils/cnpj`.

### 4.4 Cadastro por certificado

`cadastro-certificado.service.ts`:

1. `parseCertificado(buffer, senha)` → CNPJ, razão social, validade
2. Cria ou atualiza `Empresa` (vincula contabilidade)
3. Upload do `.pfx` no Supabase Storage (`contabilidade/{id}/empresa/{cnpj}/certs/{ts}.pfx`)
4. Cria/atualiza registro em `certificados_digitais` (senha criptografada)
5. Retorna snapshot (`has_cert`, `has_cred`, `cert_validade`, `cred_status`)

### 4.5 Cadastro por credencial

`cadastro-credencial.service.ts`:

1. Valida CNPJ (14) ou CPF (11); CPF vira `000` + CPF na tabela `empresas`
2. Cria empresa se não existir (exige `razao_social`)
3. Upsert em `credenciais` (unique `empresa_id` + `tipo`)
4. Senha via `encrypt()` (AES-256-GCM, `utils/crypto.ts`)

### 4.6 Listagem com agregados (`empresas.repo.ts`)

1. Filtra por `contabilidade_id` e `search` no Prisma
2. Carrega certificados (por CNPJ) e credenciais (por `empresaId`)
3. Calcula `has_certificado`, `cert_validade`, `has_credenciais`, `cred_status`, `status_geral`
4. Aplica filtros `has_cert` / `sem_cert` / `has_cred` / `sem_cred` / `sem_metodo` **em memória**
5. Ordena e pagina

**Summary** (`obterSummary`): mesmos filtros; conta total, certificados vencidos, credenciais para validar (status ruim ou teste > 7 dias) e operacionais.

**Exclusão em massa:** transação `credenciais` → `certificados` → `empresas`.

---

## 5. API REST

Envelope padrão de sucesso: `{ "success": true, "data": ..., "message"?: "..." }`.

### 5.1 Empresas unificadas

#### `GET /api/empresas`

Query:

| Param | Tipo | Descrição |
| ----- | ---- | --------- |
| `search` | string | CNPJ ou razão social |
| `contabilidade_id` | number | Filtro por escritório |
| `has_cert` | `true`/`false` | Com/sem certificado |
| `has_cred` | `true`/`false` | Com/sem credenciais |
| `sem_cert` | `true` | Sem certificado |
| `sem_cred` | `true` | Sem credenciais |
| `sem_metodo` | `true` | Sem cert e sem cred |
| `page` | number | Default `1` |
| `limit` | number | Default `20`, máx. `100` |
| `sort` | string | `cnpj`, `razao_social`, `contabilidade_nome`, `cert_validade`, `has_credenciais`, `status_geral` |
| `order` | `asc`/`desc` | Default `asc` |

Conflitos rejeitados (400): `has_cert=true` + `sem_cert`, ou `has_cred=true` + `sem_cred`.

**Resposta `data`:**

```json
{
  "items": [ /* EmpresaListagemItem */ ],
  "total": 150,
  "page": 1,
  "limit": 20
}
```

#### `GET /api/empresas/summary`

Mesmos filtros de listagem (sem page/sort). Retorna:

```json
{
  "total_empresas": 150,
  "certificados_vencidos": 12,
  "credenciais_para_validar": 40,
  "operacionais": 98
}
```

#### `GET /api/empresas/:id`

Detalhes: `empresa` + `certificados_digitais[]` + `credenciais[]`.

#### `GET /api/empresas/contabilidade/:contabilidade_id`

Listagem já filtrada pela contabilidade do path.

#### `GET /api/empresas/cnpj/:cnpj`

Resolve CNPJ → detalhes (mesmo shape de `/:id`).

#### `POST /api/empresas/cadastro/certificado`

`multipart/form-data`: `file`, `senha`, `contabilidade_id` (obrigatório).  
Arquivo: `.pfx` ou `.p12`.

#### `POST /api/empresas/cadastro/credencial`

```json
{
  "cnpj": "12345678000199",
  "razao_social": "Empresa Exemplo LTDA",
  "senha": "****",
  "tipo": "CNPJ_SENHA",
  "usuario": "12345678000199",
  "contabilidade_id": 1
}
```

Se documento tiver 11 dígitos, o backend força `CPF_SENHA`.

#### `DELETE /api/empresas`

Body: `{ "ids": [1, 2, 3] }` → `{ "deleted": N }`.

### 5.2 Empresas legado

| Método | Path | Status |
| ------ | ---- | ------ |
| `POST` | `/api/empresas` | `201` |
| `PUT` | `/api/empresas/:id` | `200` |
| `DELETE` | `/api/empresas/:id` | `204` |

### 5.3 Imports

| Método | Path | Uso |
| ------ | ---- | --- |
| `POST` | `/api/imports/certificados/preview` | multipart `files[]` + `senha` |
| `POST` | `/api/imports/certificados/confirmar` | `{ session_id, senha, itens, contabilidade_id? }` |
| `POST` | `/api/imports/credenciais/preview` | multipart `arquivo` |
| `POST` | `/api/imports/credenciais/confirmar` | `{ session_id, contabilidade_id_default, updateExisting, rows? }` |

### 5.4 Certificados / validação / credenciais (usados pela tela)

| Método | Path | Uso na UI |
| ------ | ---- | --------- |
| `DELETE` | `/api/certificados/cnpj/:cnpj` | Remover certificado no drawer |
| `PUT` | `/api/credenciais/:id` | Atualizar senha |
| `PATCH`/`PUT` status | endpoints de credenciais | Marcar INATIVA / reativar |
| `POST` | `/api/validacoes` (+ stream) | Modal de validação em massa |

---

## 6. Modelos de dados

### 6.1 Frontend — `empresas-unificado.model.ts`

**`EmpresaListagemItem`** (linha da tabela):

| Campo | Tipo | Descrição |
| ----- | ---- | --------- |
| `id` | string | ID da empresa |
| `cnpj` | string | Documento (CPF pode vir padded `000…`) |
| `razao_social` | string | Nome |
| `contabilidade_id` / `contabilidade_nome` | | Vínculo |
| `has_certificado` | boolean | Possui cert |
| `cert_validade` | string \| null | Validade |
| `has_credenciais` | boolean | Possui cred |
| `cred_status` | string \| null | Status da credencial |
| `cred_ultimo_teste_em` | string \| null | Último teste |
| `cred_ultima_mensagem` | string \| null | Mensagem (ex.: senha incorreta) |
| `status_geral` | StatusGeral \| null | Do backend |
| `status_geral_motivo` | string \| null | Motivo |

**`toEmpresaRow(item)`** adapta para o painel operacional (`EmpresaRow`) usado por `status.utils`.

**`EmpresaDetalhes`:** bloco `empresa` + arrays de certificados e credenciais.

### 6.2 Backend — `EmpresaAgregada` / `EmpresaDetalhada`

Espelham o contrato da API (ver `empresas.repo.ts` e `toListagemItem` no controller).

---

## 7. Status e regras de negócio

### 7.1 Status do certificado (frontend)

| Status | Condição |
| ------ | -------- |
| `SEM_CERTIFICADO` | Sem cert ou sem data |
| `VENCIDO` | Data < hoje |
| `VENCENDO` | Hoje ≤ data ≤ hoje + 30 dias |
| `VALIDO` | Data > hoje + 30 dias |
| `ERRO_CERT` | Data inválida |

### 7.2 Status de credencial

Valores da API / banco: `NAO_TESTADO`, `OK`, `INVALIDA`, `ERRO_VALIDACAO`, `INATIVA`, `TESTANDO`, …  
Revalidação sugerida após **7 dias** do último teste OK.

### 7.3 Status geral

**Backend** (`calcularStatusGeral` no repo) — valores: `OPERACIONAL` | `PARCIAL` | `INOPERANTE`:

- Sem método → `INOPERANTE`
- Cert válido **ou** cred `OK` → `OPERACIONAL`
- Caso contrário com métodos inválidos → `PARCIAL`

**Frontend** (`computeCompanyStatusGeral`) — inclui também `ATENCAO` (cert vencendo) e regras mais finas (cred precisa revalidar). A UI exibe o cálculo do frontend; o campo `status_geral` da API é informativo/ordenável.

### 7.4 Regras de cadastro importantes

- Cadastro legado por `POST /empresas` **bloqueia** CNPJ que já possui certificado (empresas com cert não entram “só por credencial” por essa rota).
- Contabilidade obrigatória no cadastro via UI (cert e cred).
- CPF: empresa armazenada com `cnpj = padStart(14, '0')` do CPF; a UI formata CPF quando detecta prefixo `000`.

---

## 8. Utilitários (`Backend/src/utils`)

| Arquivo | Papel na tela de Empresas |
| ------- | ------------------------- |
| `cnpj.ts` | Normalização e checagem de 14 dígitos (router legado, controller) |
| `documento.utils.ts` | CNPJ/CPF, padding CPF→empresa, formatação — imports e cadastros |
| `certificado.parser.ts` | Extrai CNPJ, razão social, validade, serial, thumbprint do PFX |
| `certificado-utils.ts` | Extração alternativa/legada de info do certificado |
| `planilha.parser.ts` | Lê xlsx/csv no formato fixo de credenciais |
| `crypto.ts` | `encrypt` / `decrypt` AES-256-GCM para senhas de credencial |
| `path-resolve.ts` | Resolução de caminhos (storage/local) |
| `sleep.ts` | Delay genérico (automação/validação) |
| `native-folder-picker.ts` | Seletor nativo de pasta (fora do escopo direto da UI web) |

---

## 9. Fluxos principais

### 9.1 Abrir a tela

```
Usuário → /empresas
  → GET /api/contabilidades
  → GET /api/empresas?page=1&limit=20
  → GET /api/empresas/summary
  → Renderiza cards + tabela
```

### 9.2 Filtrar / buscar

```
Chip / search / contabilidade
  → page = 1
  → GET /api/empresas?...filtros
  → GET /api/empresas/summary?...filtros
```

Preset do card: só filtra `listaEmpresas` no cliente (não refaz request).

### 9.3 Cadastrar via certificado

```
Modal cadastro (método cert)
  → POST /api/empresas/cadastro/certificado (multipart)
  → Parse PFX → Storage + DB
  → Toast + refresh list/summary
```

### 9.4 Cadastrar via credencial

```
Modal cadastro (método cred)
  → POST /api/empresas/cadastro/credencial
  → Upsert empresa + credencial
  → Toast + refresh
```

### 9.5 Editar no drawer

```
Clique na linha → GET /api/empresas/:id
  → Usuário altera contabilidade / credencial / cert
  → PUT /api/empresas/:id  e/ou  APIs de credenciais
  → (opcional) POST cadastro/certificado ou DELETE certificados/cnpj/:cnpj
  → Refresh detalhes + lista
```

### 9.6 Importar certificados em lote

```
Preview → Confirmar → refresh
```

### 9.7 Importar credenciais (planilha)

```
Preview → Selecionar linhas + contabilidade → Confirmar → refresh
```

### 9.8 Validar credenciais

```
Modal → POST /api/validacoes { empresa_ids, validar_credenciais: true }
  → SSE stream por job_id
  → Totais OK / inválidas / erros → refresh lista
```

### 9.9 Excluir empresa

```
Confirmação → DELETE /api/empresas/:id (204) → refresh
```

---

## 10. Banco de dados

Entidades centrais (detalhes em [BANCO_DE_DADOS.md](./BANCO_DE_DADOS.md)):

```
contabilidades 1 ─── N empresas 1 ─── N credenciais
                     │
                     └── (por CNPJ / empresa_id) certificados_digitais
```

| Tabela | Uso na tela |
| ------ | ----------- |
| `empresas` | Cadastro e listagem |
| `credenciais` | Login portal; status de validação |
| `certificados_digitais` | Metadados + path no Storage |
| `contabilidades` | Filtro e vínculo obrigatório no cadastro |

Arquivos `.pfx` **não** ficam no Postgres: vão para o bucket Supabase (`CERT_STORAGE_BUCKET`, default `certificados`).

---

## 11. Integrações relacionadas

| Sistema / módulo | Relação |
| ---------------- | ------- |
| **Contabilidades** | Filtro dropdown; cadastro exige vínculo |
| **Validacoes** | Modal de teste em massa |
| **Execução NFSe** | Depende de empresas operacionais (cert ou cred OK) |
| **Dashboard** | KPIs globais correlatos aos cards |
| **Supabase Storage** | Persistência dos certificados |
| **Playwright** | Usado na validação/automação (não na listagem em si) |

---

## 12. Observações e limitações

1. **Dois routers no mesmo prefixo** — unificado + legado; PUT/DELETE individual vêm do legado; listagem/summary/cadastros do módulo novo.
2. **Filtros `has_*` / `sem_*` em memória** — a paginação com esses filtros pode ser aproximada (repo busca `limit * 5` e filtra).
3. **Status geral backend ≠ frontend** — frontend tem `ATENCAO` e regra de revalidação de 7 dias; backend agrega de forma mais simples.
4. **Exportar** — botão `onExportar` na UI ainda é stub (`console.log`).
5. **`EmpresasService` legado** — permanece para outras telas; a tela Empresas usa só `EmpresasUnificadoService`.
6. **`dist/`** — não editar; regenerar com o build TypeScript do Backend.
7. **Documentação relacionada:** [FRONTEND.md](./FRONTEND.md), [API_REFERENCE.md](./API_REFERENCE.md), [FLUXOS.md](./FLUXOS.md), [BANCO_DE_DADOS.md](./BANCO_DE_DADOS.md).

---

*Última atualização: julho/2026 — alinhada ao código em `Frontend/src/app/components/empresas` e `Backend/src/modules/certificados/empresas`.*

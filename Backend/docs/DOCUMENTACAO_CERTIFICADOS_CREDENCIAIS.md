# Documentação: Banco de Dados e Rotas - Certificados e Credenciais

Este documento descreve a estrutura do banco de dados e as rotas do backend Node.js referentes às telas **Certificado Upload** e **Credenciais** do frontend.

> **Atualização (Fev/2026):** As telas Certificado Upload e Credenciais foram **unificadas** na tela **Empresas** no frontend Angular. As rotas `/certificados` e `/credenciais` redirecionam para `/empresas`. Veja `Frontend/docs/FLUXO_EMPRESAS.md` para o novo fluxo.

---

## 1. Visão Geral das Telas

### 1.1 Tela Certificado Upload (`Frontend/src/app/components/certificado-upload`)

- **Funcionalidade**: Upload, importação e gerenciamento de certificados digitais (.pfx / .p12)
- **Fluxo**: Extrair info do certificado → Vincular à contabilidade → Upload do arquivo criptografado
- **Recursos**: Importação individual, em lote, validação em lote, exclusão múltipla, exportação PDF/Excel

### 1.2 Tela Credenciais (`Frontend/src/app/components/credenciais`)

- **Funcionalidade**: Cadastro e gerenciamento de credenciais de login (CNPJ/CPF + senha) para NFSe
- **Entidades envolvidas**: Empresas, Credenciais, Contabilidades
- **Recursos**: CRUD credenciais, validação individual e em lote (Playwright), importação via planilha Excel

---

## 2. Estrutura do Banco de Dados (Node.js / PostgreSQL / Supabase)

Utiliza Prisma com schema em `Backend/prisma/schema.prisma`. Migração: `prisma/migrations/20260213012154_init_supabase/migration.sql`.

### 2.1 Tabela `certificados_digitais`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL | PK |
| `cnpj` | TEXT | CNPJ da empresa |
| `arquivo` | TEXT | Nome do arquivo .pfx no disco |
| `data_validade` | TEXT | Data de validade (ISO ou DD/MM/YYYY) |
| `empresa_id` | TEXT | Referência opcional à empresa |
| `contabilidade_id` | INTEGER | FK → contabilidades (ON DELETE SET NULL) |
| `data_cadastro` | TIMESTAMP | Data de cadastro |

### 2.2 Tabela `credenciais`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL | PK |
| `empresa_id` | INTEGER | FK → empresas (ON DELETE CASCADE) |
| `tipo` | TEXT | CNPJ_SENHA ou CPF_SENHA |
| `usuario` | TEXT | CNPJ ou CPF |
| `senha_criptografada` | TEXT | Senha criptografada |
| `status` | TEXT | NAO_TESTADO, OK, INVALIDA, BLOQUEADA |
| `ultimo_teste_em` | TIMESTAMP | Data do último teste |
| `created_at` | TIMESTAMP | Data de criação |
| `updated_at` | TIMESTAMP | Data de atualização |

**Índice único**: `(empresa_id, tipo)`

### 2.3 Tabela `empresas`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL | PK |
| `cnpj` | TEXT | CNPJ único |
| `razao_social` | TEXT | Razão social |
| `regime` | TEXT | Regime tributário |
| `ativo` | BOOLEAN | Se está ativa |
| `contabilidade_id` | INTEGER | FK → contabilidades (ON DELETE SET NULL) |
| `created_at` | TIMESTAMP | Data de criação |
| `updated_at` | TIMESTAMP | Data de atualização |

### 2.4 Tabela `contabilidades`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL | PK |
| `nome_contabilidade` | TEXT | Nome |
| `cnpj` | TEXT | CNPJ único |
| `email` | TEXT | E-mail |
| `telefone` | TEXT | Telefone |
| `responsavel` | TEXT | Responsável |
| `data_cadastro` | TIMESTAMP | Data de cadastro |

---

## 3. Rotas do Backend

### 3.1 Rotas de Certificados

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/certificados/extrair` | Extrair informações (sem salvar) |
| POST | `/api/certificados/validar-lote` | Validar múltiplos certificados |
| POST | `/api/certificados/importar` | Importar certificado (arquivo + metadado) |
| POST | `/api/certificados/importar-lote` | Importar múltiplos certificados |
| GET | `/api/certificados` | Listar certificados |
| GET | `/api/certificados/cnpj/:cnpj` | Obter por CNPJ |
| DELETE | `/api/certificados/cnpj/:cnpj` | Deletar por CNPJ |
| POST | `/api/certificados` | Criar metadado (sem arquivo) |
| PUT | `/api/certificados/:id` | Atualizar metadado |
| DELETE | `/api/certificados/:id` | Deletar por ID |
| GET | `/api/certificados/contabilidade/:id` | Listar por contabilidade |

### 3.2 Rotas de Credenciais

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/credenciais/empresa/:empresa_id` | Obter credenciais por empresa |
| POST | `/api/credenciais` | Criar ou atualizar credencial |
| PUT | `/api/credenciais/:id/status` | Atualizar status |
| PUT | `/api/credenciais/:id` | Atualizar senha |
| DELETE | `/api/credenciais/:id` | Deletar credencial |
| POST | `/api/credenciais/:id/obter-senha` | Obter senha (requer senha admin) |

**Rotas pendentes de implementação**:
- `POST /api/credenciais/empresa/:empresa_id/validar` — validação com Playwright
- `POST /api/credenciais/validar-lote`
- `POST /api/credenciais/importar-planilha/validar`
- `POST /api/credenciais/importar-planilha`

---

## 4. Mapeamento Frontend → Backend

### 4.1 Serviços do Frontend

| Serviço | Arquivo | baseUrl |
|---------|---------|---------|
| CertificadoService | `Frontend/src/app/services/certificado.service.ts` | `environment.apiUrl` |
| CredenciaisService | `Frontend/src/app/services/credenciais.service.ts` | `environment.apiUrl` |

### 4.2 Chamadas da tela Certificado Upload

| Operação | Método | URL (via service) |
|----------|--------|-------------------|
| Upload | POST | `{apiUrl}/certificados` |
| Extrair info | POST | `{apiUrl}/certificados/extrair` |
| Importar com contabilidade | POST | `{apiUrl}/certificados/importar` |
| Validar lote | POST | `{apiUrl}/certificados/validar-lote` |
| Importar lote | POST | `{apiUrl}/certificados/importar-lote` |
| Remover certificado | DELETE | `{apiUrl}/certificados/cnpj/{cnpj}` |

### 4.3 Chamadas da tela Credenciais

| Operação | Método | URL |
|----------|--------|-----|
| Obter por empresa | GET | `{apiUrl}/credenciais/empresa/{empresa_id}` |
| Criar/atualizar | POST | `{apiUrl}/credenciais` |
| Atualizar | PUT | `{apiUrl}/credenciais/{id}` |
| Excluir | DELETE | `{apiUrl}/credenciais/{id}` |
| Validar | POST | `{apiUrl}/credenciais/empresa/{empresa_id}/validar` |
| Validar lote | POST | `{apiUrl}/credenciais/validar-lote` |
| Obter senha | POST | `{apiUrl}/credenciais/{id}/obter-senha` |
| Validar planilha | POST | `{apiUrl}/credenciais/importar-planilha/validar` |
| Importar planilha | POST | `{apiUrl}/credenciais/importar-planilha` |

---

## 5. Configuração do Ambiente

### 5.1 Frontend (`Frontend/src/environments/`)

```typescript
// environment.ts (desenvolvimento)
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
};
```

### 5.2 Backend

- **Node**: porta padrão **3000** (verificar em `Backend/.env` ou script de start)

---

## 6. Recomendações

1. **Unificação da exclusão de certificados**: Garantir que `certificado-upload.component.ts` use `environment.apiUrl` com a rota `/api/certificados/cnpj/{cnpj}` para exclusão múltipla.

2. **Implementação futura**: Implementar as rotas de validação e importação de planilha de credenciais.

3. **Certificados**: O Node armazena arquivos em `CERTIFICATES_DIR`. Revisar políticas de segurança conforme o ambiente.

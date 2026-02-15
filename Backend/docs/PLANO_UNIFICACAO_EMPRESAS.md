# Plano de Unificação: Certificado Digital + Credenciais → Empresas

**Objetivo:** Unificar as telas "Certificado Digital" e "Credenciais" em uma única tela "Empresas" com CNPJ como chave principal.

**Contexto:** Node Express + Angular + Supabase | CNPJ como chave de negócio.

---

## 1. Inventário do que já existe

### 1.1 Backend (Express)

| Módulo | Arquivos | Rotas principais |
|--------|----------|-------------------|
| **empresas** | `routers/empresas.ts`, `repositories/empresas.ts` | GET /, GET /contabilidade/:id, GET /cnpj/:cnpj, GET /:id, POST /, PUT /:id, DELETE /:id |
| **certificados** | `routers/certificados.ts`, `repositories/certificados.ts`, `utils/certificado-utils.ts` | POST /extrair, POST /validar-lote, POST /importar, POST /importar-lote, GET /, GET /cnpj/:cnpj, GET /contabilidade/:id, DELETE /cnpj/:cnpj, POST /, PUT /:id, DELETE /:id |
| **credenciais** | `routers/credenciais.ts`, `repositories/credenciais.ts` | GET /empresa/:id, POST /, PUT /:id, PUT /:id/status, DELETE /:id, POST /:id/obter-senha |

**Rotas de credenciais ausentes no Node:**
- `POST /credenciais/empresa/:empresa_id/validar` (validação Playwright)
- `POST /credenciais/validar-lote`
- `POST /credenciais/importar-planilha/validar`
- `POST /credenciais/importar-planilha`

### 1.2 Banco de dados (Prisma schema)

| Tabela | Campos relevantes | Problemas |
|--------|-------------------|-----------|
| **empresas** | id, cnpj (unique), razao_social, regime, contabilidade_id | OK |
| **credenciais** | id, empresa_id (FK Int), tipo, usuario, senha_criptografada | OK |
| **certificados_digitais** | id, cnpj, arquivo, data_validade (TEXT), empresa_id (TEXT), contabilidade_id | **empresa_id TEXT → deve virar FK Int**; **data_validade TEXT → DATE** |

### 1.3 Frontend (Angular)

| Componente | Rota | Função |
|------------|------|--------|
| **certificado-upload** | `/certificados` | Upload PFX/P12, extração CNPJ, importação individual/lote, validação lote |
| **credenciais** | `/credenciais` | CRUD empresas+credenciais (CNPJ+senha), validação, importação planilha |
| layout | - | Menu com links para Certificados e Credenciais |

| Service | Endpoints usados |
|---------|------------------|
| **CertificadoService** | extrair, importar, importar-lote, validar-lote, certificados/cnpj/:cnpj (delete), certificados/contabilidade/:id |
| **CredenciaisService** | credenciais/empresa/:id, credenciais (POST), credenciais/:id (PUT, DELETE), obter-senha, validar, validar-lote, validar-planilha, importar-planilha |
| **EmpresasService** | empresas (GET, POST), empresas/contabilidade/:id, empresas/cnpj/:cnpj, empresas/:id (GET, PUT, DELETE) |

**Bug:** `certificado-upload.component.ts` linha 703 usa URL hardcoded `http://localhost:8000/api/certificados/metadados/cnpj/` — incompatível com Node.

### 1.4 O que será REMOVIDO / RENOMEADO

| Item | Ação |
|------|------|
| Rota `/certificados` | Remover do app.routes; redirecionar `/certificados` → `/empresas` (301) |
| Rota `/credenciais` | Remover do app.routes; redirecionar `/credenciais` → `/empresas` |
| Componente `certificado-upload` | Refatorar em módulos/seções da nova tela Empresas |
| Componente `credenciais` | Refatorar em módulos/seções da nova tela Empresas |
| Menu "Certificados" | Remover; renomear "Credenciais" → "Empresas" |
| Menu "Credenciais" | Remover (unificado em Empresas) |
| `CertificadoService` | Manter como sub-service ou merge no `EmpresasService` |
| `CredenciaisService` | Manter como sub-service ou merge no `EmpresasService` |

---

## 2. Novos endpoints Express necessários

### 2.1 Endpoint principal unificado (Empresas)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/empresas/completo` | Lista empresas com certificados + credenciais (CNPJ como chave) |
| GET | `/api/empresas/completo/cnpj/:cnpj` | Empresa por CNPJ com certificados + credenciais |
| GET | `/api/empresas/completo/contabilidade/:id` | Lista por contabilidade com certificados + credenciais |

### 2.2 Cadastro via certificado (fluxo unificado)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/empresas/por-certificado` | Extrai CNPJ+razão+validade do PFX, cria empresa se não existir, salva certificado vinculado. Body: multipart (certificado, senha, contabilidade_id?) |

### 2.3 Cadastro via credencial (fluxo unificado)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/empresas/por-credencial` | CNPJ + senha + razão_social (obrigatória se empresa não existir). Body: { cnpj, razao_social?, senha, contabilidade_id? } |

### 2.4 Importações com Preview + Confirmar

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/empresas/importar-certificados/preview` | Valida lotes de PFX; retorna lista de { cnpj, empresa, data_validade } para preview |
| POST | `/api/empresas/importar-certificados/confirmar` | Confirma importação do preview; salva empresa + certificado para cada item |
| POST | `/api/empresas/importar-credenciais/preview` | Valida planilha Excel; retorna linhas válidas/inválidas para preview |
| POST | `/api/empresas/importar-credenciais/confirmar` | Confirma importação do preview; cria empresas + credenciais |

### 2.5 Manutenção dos endpoints atuais (ajustados)

- **Certificados:** Manter rotas existentes, mas garantir que `importar` e `importar-lote` criem empresa e vinculem `empresa_id` (FK int) após migração do banco.
- **Credenciais:** Implementar no Node: `validar`, `validar-lote`, `importar-planilha/validar`, `importar-planilha` (ou migrar para novos endpoints unificados).

---

## 3. Mudanças no banco (DDL / migração)

### 3.1 Migração: certificados_digitais

**Arquivo sugerido:** `prisma/migrations/YYYYMMDD_certificados_empresa_fk/migration.sql`

```sql
-- 1. Adicionar coluna temporária empresa_id_new (INT)
ALTER TABLE certificados_digitais ADD COLUMN IF NOT EXISTS empresa_id_new INTEGER REFERENCES empresas(id) ON DELETE SET NULL;

-- 2. Preencher empresa_id_new: buscar empresa por cnpj ou criar se não existir
-- (Script separado em Node/TS para lógica de negócio)

-- 3. Converter data_validade de TEXT para DATE (nova coluna temporária)
ALTER TABLE certificados_digitais ADD COLUMN IF NOT EXISTS data_validade_new DATE;

-- 4. Atualizar data_validade_new a partir de data_validade (parser DD/MM/YYYY ou ISO)
UPDATE certificados_digitais SET data_validade_new = 
  CASE 
    WHEN data_validade ~ '^\d{4}-\d{2}-\d{2}' THEN data_validade::DATE
    WHEN data_validade ~ '^\d{2}/\d{2}/\d{4}' THEN TO_DATE(data_validade, 'DD/MM/YYYY')
    ELSE NULL
  END
WHERE data_validade IS NOT NULL AND data_validade != '';

-- 5. Remover colunas antigas e renomear
ALTER TABLE certificados_digitais DROP COLUMN empresa_id;
ALTER TABLE certificados_digitais DROP COLUMN data_validade;
ALTER TABLE certificados_digitais RENAME COLUMN empresa_id_new TO empresa_id;
ALTER TABLE certificados_digitais RENAME COLUMN data_validade_new TO data_validade;

-- 6. Índice para busca por empresa
CREATE INDEX IF NOT EXISTS idx_certificados_empresa_id ON certificados_digitais(empresa_id);
```

### 3.2 Atualização do schema Prisma

```prisma
model Certificado {
  id              Int       @id @default(autoincrement())
  empresaId       Int?      @map("empresa_id")  // FK → empresas
  cnpj            String    // Mantido para redundância/legado
  arquivo         String?
  dataValidade    DateTime? @map("data_validade") @db.Date  // DATE no PostgreSQL
  contabilidadeId Int?      @map("contabilidade_id")
  dataCadastro    DateTime  @default(now()) @map("data_cadastro")

  empresa         Empresa?   @relation(fields: [empresaId], references: [id], onDelete: SetNull)
  contabilidade   Contabilidade? @relation(fields: [contabilidadeId], references: [id], onDelete: SetNull)

  @@map("certificados_digitais")
}

model Empresa {
  // ... campos existentes ...
  certificados Certificado[]
}
```

### 3.3 Script de dados para empresa_id

Antes de dropar `empresa_id` (TEXT), popular `empresa_id_new`:

```typescript
// scripts/migrar-certificados-empresa.ts
// Para cada certificado: busca empresa por cnpj; se não existir, cria com razao_social = cnpj
```

---

## 4. Plano de implementação por fases

### Fase 1: Banco de dados (1–2 dias)

1. Criar migration Prisma para:
   - Adicionar `empresa_id_new INT` (FK) em `certificados_digitais`
   - Adicionar `data_validade_new DATE`
2. Executar script de população: para cada certificado, buscar/criar empresa por CNPJ e preencher `empresa_id_new`
3. Converter `data_validade` (TEXT) → `data_validade_new` (parser)
4. Remover colunas antigas, renomear novas
5. Atualizar `schema.prisma` e rodar `prisma generate`

**Critério de aceite:** Certificados têm `empresa_id` como INT válido e `data_validade` como DATE.

---

### Fase 2: Backend Express (2–3 dias)

1. **Repositórios**
   - Atualizar `repositories/certificados.ts`: usar `empresaId` (Int), `dataValidade` (Date)
   - Criar `repositories/empresas-completo.ts` (ou ampliar empresas): listar empresas com include certificados + credenciais

2. **Endpoints unificados**
   - `GET /api/empresas/completo` — listar com certificados e credenciais
   - `GET /api/empresas/completo/cnpj/:cnpj`
   - `GET /api/empresas/completo/contabilidade/:id`

3. **Cadastro por certificado**
   - `POST /api/empresas/por-certificado`: extrair PFX → criar/atualizar empresa → salvar certificado com `empresa_id` (FK)

4. **Cadastro por credencial**
   - `POST /api/empresas/por-credencial`: criar empresa se não existir (razao_social obrigatório) → salvar credencial

5. **Importações Preview + Confirmar**
   - `POST /api/empresas/importar-certificados/preview`
   - `POST /api/empresas/importar-certificados/confirmar`
   - `POST /api/empresas/importar-credenciais/preview`
   - `POST /api/empresas/importar-credenciais/confirmar`

6. **Credenciais faltantes (Node)**
   - Implementar `POST /credenciais/empresa/:id/validar`, `POST /credenciais/validar-lote`, `importar-planilha/validar`, `importar-planilha` (ou delegar para endpoints unificados)

7. **Correções**
   - Garantir que `certificados/importar` e `importar-lote` criem empresa e vinculem `empresa_id`

**Critério de aceite:** Todos os endpoints respondem corretamente e certificados ficam vinculados a empresas por FK.

---

### Fase 3: Frontend Angular (3–4 dias)

1. **Nova tela Empresas**
   - Criar `empresas.component.ts` (ou renomear `credenciais` → `empresas` e expandir)
   - Layout: lista de empresas por CNPJ com abas ou seções: Certificado | Credenciais

2. **Cadastro individual certificado**
   - Reaproveitar fluxo de `certificado-upload`: extrair → vincular contabilidade → salvar
   - Chamar `POST /api/empresas/por-certificado` (ou manter `/certificados/importar` com lógica de criar empresa)

3. **Cadastro individual credencial**
   - Reaproveitar formulário de credenciais: CNPJ + senha + razão social (+ contabilidade)
   - Chamar `POST /api/empresas/por-credencial`

4. **Importação certificados**
   - Fluxo: Upload PFX → Preview (validação) → Confirmar
   - Chamar preview e confirmar

5. **Importação credenciais**
   - Fluxo: Upload planilha → Preview (validação) → Confirmar
   - Chamar preview e confirmar

6. **Rotas e menu**
   - Remover rotas `/certificados` e `/credenciais`
   - Adicionar rota `/empresas` com novo componente
   - Atualizar `layout.component.html`: um único item "Empresas" no menu
   - Redirecionar `/certificados` e `/credenciais` → `/empresas` (redirect)

7. **Correções imediatas**
   - Corrigir `certificado-upload.component.ts` linha 703: usar `environment.apiUrl` + `/api/certificados/cnpj/` (ou equivalente unificado)

8. **Remoção de componentes antigos**
   - Após validação, remover ou arquivar `certificado-upload` e `credenciais` como componentes isolados (se mantiver trechos, extrair para módulos compartilhados)

**Critério de aceite:** Uma única tela "Empresas" permite cadastrar por certificado, por credencial, importar certificados e credenciais com fluxo Preview + Confirmar.

---

### Fase 4: Testes e ajustes finais (1–2 dias)

1. Testar fluxos: certificado individual, credencial individual, importação certificados, importação credenciais
2. Verificar que frontend não acessa Supabase diretamente (apenas API Express)
3. Validar integridade referencial (empresa_id em certificados)
4. Atualizar documentação e README

---

## 5. Resumo de entregas

| # | Entregável | Status |
|---|------------|--------|
| 1 | Inventário do que existe e o que será removido/renomeado | ✅ Documentado acima |
| 2 | Lista de novos endpoints Express | ✅ Seção 2 |
| 3 | Lista de mudanças no banco (DDL/migração) | ✅ Seção 3 |
| 4 | Plano de implementação por fases | ✅ Seção 4 |

---

## 6. Observações importantes

- **CNPJ como chave:** Toda empresa é identificada por CNPJ. Certificados e credenciais são vinculados à empresa (por `empresa_id` FK).
- **Frontend não acessa Supabase:** O Angular já usa `environment.apiUrl` e serviços HTTP; garantir que nenhum `@supabase/supabase-js` ou chamada direta ao Supabase permaneça.
- **Duplicidade de certificado por CNPJ:** Manter regra: um certificado por CNPJ (ou por empresa). Se já existir, atualizar em vez de criar.
- **Razão social obrigatória:** No cadastro por credencial, se a empresa não existir, `razao_social` é obrigatória.

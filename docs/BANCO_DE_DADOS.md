# Banco de Dados

## Visão Geral

- **SGBD**: PostgreSQL 15+ (hospedado no Supabase)
- **ORM**: Prisma 7.4.x
- **Adapter**: `@prisma/adapter-pg` (PostgreSQL nativo)
- **Schema**: `prisma/schema.prisma`
- **Migrações**: Prisma Migrate (`prisma/migrations/`)

---

## Diagrama de Entidades

```
┌────────────────────┐       ┌────────────────────┐
│   Contabilidade    │       │      Settings      │
├────────────────────┤       ├────────────────────┤
│ id (PK)            │       │ id (PK)            │
│ nome_contabilidade │       │ headless           │
│ cnpj (UNIQUE)      │       │ company_timeout_s  │
│ email              │       │ max_retries        │
│ telefone           │       │ max_concurrent     │
│ responsavel        │       │ viewport_preset    │
│ data_cadastro      │       │ downloads_base_path│
└────────┬───────────┘       │ log_level          │
         │                   │ ...                │
         │ 1:N               └────────────────────┘
         ▼
┌────────────────────┐
│      Empresa       │
├────────────────────┤
│ id (PK)            │
│ cnpj (UNIQUE)      │
│ razao_social       │
│ regime             │
│ ativo              │
│ contabilidade_id(FK│───► Contabilidade (SET NULL)
│ created_at         │
│ updated_at         │
└────────┬───────────┘
         │
    ┌────┴────┐
    │         │
    │ 1:N     │ 1:N
    ▼         ▼
┌──────────┐  ┌──────────────┐
│Credencial│  │   Execucao   │
├──────────┤  ├──────────────┤
│ id (PK)  │  │ id (PK)      │
│ empresa_id│  │ empresa_id  │
│ tipo     │  │ cnpj         │
│ usuario  │  │ status       │
│ senha_   │  │ etapa_atual  │
│ cript.   │  │ progresso    │
│ status   │  │ periodo_*    │
│ ultimo_  │  │ tipo         │
│ teste_em │  │ mensagem     │
│ created  │  │ data_inicio  │
│ updated  │  │ data_fim     │
└──────────┘  │ qtd_notas_*  │
              │ resultado    │
              │ created_at   │
              └──────────────┘

┌────────────────────┐
│    Certificado     │
├────────────────────┤
│ id (PK)            │
│ cnpj               │
│ arquivo            │  ← Path no Supabase Storage
│ senha_criptografada│
│ data_validade      │
│ empresa_id         │
│ contabilidade_id(FK│───► Contabilidade (SET NULL)
│ data_cadastro      │
└────────────────────┘
```

---

## Tabelas

### `contabilidades`

Contabilidades parceiras que gerenciam empresas.

| Coluna              | Tipo        | Constraints       | Descrição                    |
| ------------------- | ----------- | ----------------- | ---------------------------- |
| `id`                | SERIAL      | PK                | ID auto-incremento           |
| `nome_contabilidade`| VARCHAR     | NOT NULL          | Nome da contabilidade        |
| `cnpj`              | VARCHAR     | UNIQUE, NOT NULL  | CNPJ da contabilidade        |
| `email`             | VARCHAR     | Nullable          | Email de contato             |
| `telefone`          | VARCHAR     | Nullable          | Telefone                     |
| `responsavel`       | VARCHAR     | Nullable          | Nome do responsável          |
| `data_cadastro`     | TIMESTAMP   | DEFAULT now()     | Data de cadastro             |

**Relacionamentos**:
- 1:N → `empresas` (campo `contabilidade_id`)
- 1:N → `certificados_digitais` (campo `contabilidade_id`)

---

### `empresas`

Empresas cadastradas no sistema.

| Coluna              | Tipo        | Constraints       | Descrição                    |
| ------------------- | ----------- | ----------------- | ---------------------------- |
| `id`                | SERIAL      | PK                | ID auto-incremento           |
| `cnpj`              | VARCHAR     | UNIQUE, NOT NULL  | CNPJ da empresa              |
| `razao_social`      | VARCHAR     | NOT NULL          | Razão social                 |
| `regime`            | VARCHAR     | Nullable          | Regime tributário             |
| `ativo`             | BOOLEAN     | DEFAULT true      | Se a empresa está ativa      |
| `contabilidade_id`  | INT         | FK, Nullable      | Referência à contabilidade   |
| `created_at`        | TIMESTAMP   | DEFAULT now()     | Data de criação              |
| `updated_at`        | TIMESTAMP   | Auto-update       | Última atualização           |

**Relacionamentos**:
- N:1 → `contabilidades` (ON DELETE SET NULL)
- 1:N → `credenciais` (ON DELETE CASCADE)
- 1:N → `execucoes` (ON DELETE CASCADE)

---

### `credenciais`

Credenciais de login para portais NFSe.

| Coluna               | Tipo        | Constraints              | Descrição                 |
| -------------------- | ----------- | ------------------------ | ------------------------- |
| `id`                 | SERIAL      | PK                       | ID auto-incremento        |
| `empresa_id`         | INT         | FK, NOT NULL             | Referência à empresa      |
| `tipo`               | VARCHAR     | NOT NULL                 | `CNPJ_SENHA` ou `CPF_SENHA` |
| `usuario`            | VARCHAR     | NOT NULL                 | CNPJ ou CPF (sem formatação) |
| `senha_criptografada`| VARCHAR     | NOT NULL                 | Senha criptografada (AES-256-CBC) |
| `status`             | VARCHAR     | DEFAULT 'NAO_TESTADO'    | Status da validação       |
| `ultimo_teste_em`    | TIMESTAMP   | Nullable                 | Data do último teste      |
| `created_at`         | TIMESTAMP   | DEFAULT now()            | Data de criação           |
| `updated_at`         | TIMESTAMP   | Auto-update              | Última atualização        |

**Constraints**:
- UNIQUE (`empresa_id`, `tipo`) — uma credencial por tipo por empresa

**Status possíveis**: `NAO_TESTADO`, `OK`, `INVALIDA`, `BLOQUEADA`

---

### `certificados_digitais`

Metadados de certificados digitais A1. O arquivo `.pfx` fica no Supabase Storage.

| Coluna               | Tipo        | Constraints       | Descrição                          |
| -------------------- | ----------- | ----------------- | ---------------------------------- |
| `id`                 | SERIAL      | PK                | ID auto-incremento                 |
| `cnpj`               | VARCHAR     | NOT NULL          | CNPJ do certificado                |
| `arquivo`            | VARCHAR     | Nullable          | Path no Supabase Storage           |
| `senha_criptografada`| VARCHAR     | Nullable          | Senha criptografada (AES-256-CBC)  |
| `data_validade`      | VARCHAR     | Nullable          | Data de validade (ISO ou DD/MM/YYYY)|
| `empresa_id`         | VARCHAR     | Nullable          | ID da empresa (referência lógica)  |
| `contabilidade_id`   | INT         | FK, Nullable      | Referência à contabilidade         |
| `data_cadastro`      | TIMESTAMP   | DEFAULT now()     | Data de cadastro                   |

---

### `settings`

Configurações globais de automação (registro único).

| Coluna                        | Tipo    | Default          | Descrição                        |
| ----------------------------- | ------- | ---------------- | -------------------------------- |
| `id`                          | SERIAL  | PK               | ID (sempre 1)                    |
| `headless`                    | BOOLEAN | false            | Modo headless do Playwright      |
| `company_timeout_seconds`     | INT     | 300              | Timeout por empresa (segundos)   |
| `max_retries_per_step`        | INT     | 3                | Máximo de retentativas por etapa |
| `min_action_delay_ms`         | INT     | 500              | Delay mínimo entre ações (ms)    |
| `max_concurrent_browsers`     | INT     | 5                | Máximo de browsers simultâneos   |
| `default_concurrent_browsers` | INT     | 3                | Concorrência padrão              |
| `browser_launch_delay_ms`     | INT     | 1000             | Delay entre lançamentos          |
| `viewport_preset`             | VARCHAR | "FULLHD"         | Preset de resolução              |
| `viewport_width`              | INT     | Nullable         | Largura customizada              |
| `viewport_height`             | INT     | Nullable         | Altura customizada               |
| `downloads_base_path`         | VARCHAR | "./downloads"    | Diretório base para downloads    |
| `downloads_pattern`           | VARCHAR | "{cnpj}/{ano}/{mes}" | Padrão de organização        |
| `logs_path`                   | VARCHAR | "./logs"         | Diretório de logs                |
| `temp_path`                   | VARCHAR | "./temp"         | Diretório temporário             |
| `log_level`                   | VARCHAR | "INFO"           | Nível de log                     |
| `save_error_screenshots`      | BOOLEAN | true             | Salvar screenshots de erros      |
| `generate_pdf_report`         | BOOLEAN | true             | Gerar relatórios PDF             |
| `log_retention_days`          | INT     | 30               | Retenção de logs (dias)          |
| `max_errors_in_panel`         | INT     | 100              | Máximo de erros no painel        |

---

### `execucoes`

Histórico de execuções de automação.

| Coluna              | Tipo        | Default                  | Descrição                      |
| ------------------- | ----------- | ------------------------ | ------------------------------ |
| `id`                | SERIAL      | PK                       | ID auto-incremento             |
| `empresa_id`        | INT         | FK, NOT NULL             | Referência à empresa           |
| `cnpj`              | VARCHAR     | Nullable                 | CNPJ (snapshot)                |
| `status`            | VARCHAR     | "pendente"               | Status da execução             |
| `etapa_atual`       | VARCHAR     | "inicio"                 | Etapa atual do fluxo           |
| `progresso`         | INT         | 0                        | Percentual de progresso (0-100)|
| `periodo_inicio`    | VARCHAR     | Nullable                 | Período início (YYYY-MM)       |
| `periodo_fim`       | VARCHAR     | Nullable                 | Período fim (YYYY-MM)          |
| `tipo`              | VARCHAR     | "ambas"                  | Tipo: emitidas/recebidas/ambas |
| `mensagem`          | VARCHAR     | "Aguardando execução..." | Mensagem de status             |
| `data_inicio`       | TIMESTAMP   | Nullable                 | Início real da execução        |
| `data_fim`          | TIMESTAMP   | Nullable                 | Fim da execução                |
| `mensagem_erro`     | VARCHAR     | Nullable                 | Mensagem de erro (se houver)   |
| `qtd_notas_emitidas`| INT         | 0                        | Quantidade de notas emitidas   |
| `qtd_notas_recebidas`| INT        | 0                        | Quantidade de notas recebidas  |
| `resultado_final`   | VARCHAR     | Nullable                 | Resultado JSON final           |
| `created_at`        | TIMESTAMP   | DEFAULT now()            | Data de criação                |
| `atualizado_em`     | TIMESTAMP   | Auto-update              | Última atualização             |

**Status possíveis**: `pendente`, `executando`, `concluido`, `erro`, `cancelado`

---

## Migrações

### Migração Inicial
O schema é aplicado via `prisma db push` ou `prisma migrate deploy`.

### `20260214194500_add_senha_criptografada_certificado`
Adiciona coluna `senha_criptografada` à tabela `certificados_digitais`.

---

## Comandos Prisma Úteis

```bash
# Gerar cliente Prisma
npx prisma generate

# Aplicar schema ao banco (desenvolvimento)
npx prisma db push

# Criar migração
npx prisma migrate dev --name nome_da_migracao

# Aplicar migrações (produção)
npx prisma migrate deploy

# Visualizar banco no Prisma Studio
npx prisma studio

# Reset do banco (CUIDADO: apaga todos os dados)
npx prisma migrate reset
```

---

## Índices

| Tabela              | Coluna(s)             | Tipo   |
| ------------------- | --------------------- | ------ |
| `contabilidades`    | `cnpj`                | UNIQUE |
| `empresas`          | `cnpj`                | UNIQUE |
| `credenciais`       | `empresa_id`, `tipo`  | UNIQUE |

---

## Storage (Supabase)

### Bucket: `certificados`
- **Tipo**: privado (acesso via Service Role)
- **Estrutura**: `{cnpj}.pfx`
- **Criação**: automática no bootstrap do servidor
- **Acesso**: `supabase.storage.from('certificados').download(path)`

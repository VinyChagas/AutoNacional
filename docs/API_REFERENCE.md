# API Reference

## Base URL

- **Desenvolvimento**: `http://localhost:4321/api`
- **Produção**: `/api` (relativo)

## Formato de Resposta

Todas as respostas são JSON. Em caso de erro:

```json
{
  "error": true,
  "message": "Descrição do erro"
}
```

---

## Endpoints de Saúde

### `GET /`
Verifica se a API está online.

**Resposta**: `200 OK`
```json
{ "status": "ok" }
```

### `GET /health`
Health check detalhado.

**Resposta**: `200 OK`
```json
{ "status": "ok", "message": "AutoNacional API está funcionando" }
```

---

## Empresas — `/api/empresas`

### `GET /api/empresas`
Lista todas as empresas com filtros e ordenação.

**Query Parameters**:

| Param           | Tipo     | Descrição                                           |
| --------------- | -------- | --------------------------------------------------- |
| `busca`         | string   | Busca por CNPJ ou razão social                      |
| `contabilidade_id` | number | Filtra por contabilidade                           |
| `sort`          | string   | Campo para ordenação (cnpj, razao_social, etc.)     |
| `order`         | string   | Direção: `asc` ou `desc`                            |
| `sem_cert`      | boolean  | Apenas empresas sem certificado                     |
| `sem_cred`      | boolean  | Apenas empresas sem credenciais                     |
| `sem_metodo`    | boolean  | Apenas empresas sem nenhum método (cert nem cred)   |
| `status_cert`   | string   | Filtro por status do certificado                    |
| `status_cred`   | string   | Filtro por status da credencial                     |

**Resposta**: `200 OK`
```json
[
  {
    "id": 1,
    "cnpj": "12345678000199",
    "razao_social": "Empresa Exemplo LTDA",
    "regime": "Simples Nacional",
    "ativo": true,
    "contabilidade_id": 1,
    "contabilidade_nome": "Contabilidade ABC",
    "certificado": {
      "id": 1,
      "data_validade": "2026-12-31",
      "arquivo": "12345678000199.pfx"
    },
    "credencial": {
      "id": 1,
      "tipo": "CNPJ_SENHA",
      "usuario": "12345678000199",
      "status": "OK"
    }
  }
]
```

### `GET /api/empresas/:id`
Detalhes de uma empresa específica.

**Resposta**: `200 OK` — Objeto empresa com certificado e credenciais

### `POST /api/empresas`
Cria uma nova empresa.

**Body**:
```json
{
  "cnpj": "12345678000199",
  "razao_social": "Empresa Exemplo LTDA",
  "regime": "Simples Nacional",
  "contabilidade_id": 1
}
```

**Resposta**: `201 Created`

### `PUT /api/empresas/:id`
Atualiza uma empresa.

**Body**: campos a atualizar (parcial)

**Resposta**: `200 OK`

### `DELETE /api/empresas`
Exclusão em massa de empresas.

**Body**:
```json
{
  "ids": [1, 2, 3]
}
```

**Resposta**: `200 OK`
```json
{ "message": "3 empresa(s) excluída(s) com sucesso" }
```

### `DELETE /api/empresas/:id`
Exclui uma empresa específica.

**Resposta**: `200 OK`

---

## Certificados — `/api/certificados`

### `POST /api/certificados/upload`
Upload de certificado digital (.pfx/.p12).

**Content-Type**: `multipart/form-data`

**Form Fields**:

| Campo            | Tipo   | Obrigatório | Descrição                           |
| ---------------- | ------ | ----------- | ----------------------------------- |
| `certificado`    | File   | Sim         | Arquivo .pfx ou .p12               |
| `senha`          | string | Sim         | Senha do certificado                |
| `contabilidade_id` | number | Não       | ID da contabilidade                 |

**Resposta**: `201 Created`
```json
{
  "id": 1,
  "cnpj": "12345678000199",
  "razao_social": "Empresa Exemplo LTDA",
  "data_validade": "2026-12-31",
  "arquivo": "12345678000199.pfx"
}
```

### `POST /api/certificados/upload-lote`
Upload em lote de certificados.

**Content-Type**: `multipart/form-data`

**Form Fields**:

| Campo             | Tipo     | Descrição                              |
| ----------------- | -------- | -------------------------------------- |
| `certificados`    | File[]   | Múltiplos arquivos .pfx/.p12          |
| `senha`           | string   | Senha padrão para todos               |
| `contabilidade_id`| number   | ID da contabilidade                   |

### `POST /api/certificados/preview-lote`
Pré-visualização de certificados antes do upload em lote.

**Content-Type**: `multipart/form-data`

### `GET /api/certificados/:id/download`
Download de arquivo de certificado.

**Resposta**: `200 OK` — Arquivo binário `.pfx`

### `DELETE /api/certificados/:id`
Remove certificado de uma empresa.

---

## Credenciais — `/api/credenciais`

### `GET /api/credenciais`
Lista todas as credenciais.

### `POST /api/credenciais`
Cria uma credencial.

**Body**:
```json
{
  "empresa_id": 1,
  "tipo": "CNPJ_SENHA",
  "usuario": "12345678000199",
  "senha": "minha-senha-segura"
}
```

**Resposta**: `201 Created`

> A senha é automaticamente criptografada antes de salvar.

### `PUT /api/credenciais/:id`
Atualiza uma credencial.

### `DELETE /api/credenciais/:id`
Remove uma credencial.

---

## Contabilidades — `/api/contabilidades`

### `GET /api/contabilidades`
Lista todas as contabilidades com contagem de empresas.

**Resposta**: `200 OK`
```json
[
  {
    "id": 1,
    "nome_contabilidade": "Contabilidade ABC",
    "cnpj": "98765432000188",
    "email": "contato@abc.com.br",
    "telefone": "(11) 99999-9999",
    "responsavel": "João Silva",
    "_count": { "empresas": 15 }
  }
]
```

### `POST /api/contabilidades`
Cria uma contabilidade.

### `PUT /api/contabilidades/:id`
Atualiza uma contabilidade.

### `DELETE /api/contabilidades/:id`
Remove uma contabilidade. Empresas vinculadas perdem o vínculo (SET NULL).

---

## Configurações — `/api/settings`

### `GET /api/settings`
Retorna as configurações de automação.

**Resposta**: `200 OK`
```json
{
  "id": 1,
  "headless": false,
  "company_timeout_seconds": 3600,
  "max_retries_per_step": 3,
  "max_concurrent_browsers": 3,
  "viewport_preset": "FULLHD",
  "downloads_base_path": "./downloads",
  "downloads_pattern": "{cnpj}/{ano}/{mes}",
  "log_level": "INFO",
  "save_error_screenshots": true,
  "generate_pdf_report": true,
  "log_retention_days": 30
}
```

### `PUT /api/settings`
Atualiza configurações.

**Body**: campos parciais a atualizar

---

## Execução — `/api/execucao`

### `POST /api/execucao/:empresa_id`
Inicia execução de automação NFSe para uma empresa.

**Body**:
```json
{
  "periodo_inicio": "2026-01",
  "periodo_fim": "2026-01",
  "tipo": "ambas"
}
```

**Valores de `tipo`**: `emitidas`, `recebidas`, `ambas`

**Resposta**: `201 Created`
```json
{
  "id": 1,
  "empresa_id": 1,
  "status": "pendente",
  "etapa_atual": "inicio",
  "progresso": 0,
  "mensagem": "Aguardando execução..."
}
```

### `GET /api/execucao/:id/status`
Consulta o status de uma execução em andamento.

**Resposta**: `200 OK`
```json
{
  "id": 1,
  "status": "executando",
  "etapa_atual": "processando_notas",
  "progresso": 45,
  "mensagem": "Processando notas emitidas...",
  "qtd_notas_emitidas": 12,
  "qtd_notas_recebidas": 0
}
```

**Status possíveis**: `pendente`, `executando`, `concluido`, `erro`, `cancelado`

---

## Execuções — `/api/execucoes`

### `GET /api/execucoes`
Lista histórico de execuções.

**Query Parameters**:

| Param         | Tipo   | Descrição                            |
| ------------- | ------ | ------------------------------------ |
| `empresa_id`  | number | Filtra por empresa                   |
| `status`      | string | Filtra por status                    |
| `limit`       | number | Limite de resultados                 |
| `offset`      | number | Offset para paginação                |

---

## Validações — `/api/validacoes`

### `POST /api/validacoes/start`
Inicia job de validação de credenciais em lote.

**Body**:
```json
{
  "empresa_ids": [1, 2, 3],
  "tipo": "credenciais",
  "headless": true,
  "concurrency": 2,
  "timeout_seconds": 60,
  "max_errors": 10
}
```

**Resposta**: `200 OK`
```json
{
  "job_id": "uuid-do-job",
  "total": 3,
  "status": "running"
}
```

### `GET /api/validacoes/:job_id`
Consulta progresso de um job de validação.

**Resposta**: `200 OK`
```json
{
  "job_id": "uuid",
  "status": "running",
  "total": 10,
  "processed": 5,
  "ok": 3,
  "errors": 2,
  "results": [
    { "empresa_id": 1, "cnpj": "...", "status": "OK" },
    { "empresa_id": 2, "cnpj": "...", "status": "INVALIDA", "mensagem": "Senha incorreta" }
  ]
}
```

### `POST /api/validacoes/:job_id/cancel`
Cancela um job de validação em andamento.

---

## Importações — `/api/imports`

### `POST /api/imports/certificados`
Importação em lote de certificados.

### `POST /api/imports/credenciais`
Importação de credenciais via planilha.

**Content-Type**: `multipart/form-data`

**Form Fields**:

| Campo              | Tipo   | Descrição                              |
| ------------------ | ------ | -------------------------------------- |
| `planilha`         | File   | Arquivo .xlsx ou .csv                  |
| `contabilidade_id` | number | ID da contabilidade (opcional)         |

### `POST /api/imports/credenciais/preview`
Pré-visualização dos dados da planilha antes de importar.

---

## Relatórios — `/api/relatorios`

### `GET /api/relatorios/execucoes`
Relatório de execuções com filtros.

---

## Dashboard — `/api/dashboard`

### `GET /api/dashboard`
Dados resumidos para o dashboard.

**Resposta**: `200 OK`
```json
{
  "total_empresas": 150,
  "certificados_vencidos": 5,
  "certificados_vencendo": 12,
  "credenciais_invalidas": 3,
  "credenciais_nao_testadas": 20,
  "empresas_operacionais": 130,
  "execucoes_recentes": [...]
}
```

---

## NFSe — `/api/nfse`

### `POST /api/nfse/abrir-dashboard`
Abre dashboard NFSe autenticado (Playwright).

---

## Códigos de Status HTTP

| Código | Descrição                                      |
| ------ | ---------------------------------------------- |
| 200    | Sucesso                                        |
| 201    | Recurso criado                                 |
| 400    | Requisição inválida (validação Zod)            |
| 404    | Recurso não encontrado                         |
| 409    | Conflito (CNPJ duplicado, etc.)                |
| 500    | Erro interno do servidor                       |

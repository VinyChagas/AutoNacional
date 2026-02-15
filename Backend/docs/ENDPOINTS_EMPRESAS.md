# Endpoints de Empresas

## GET /api/empresas

Lista empresas com campos agregados.

### Query params

| Param | Tipo | Descrição |
|-------|------|-----------|
| `search` | string | Busca em cnpj ou razao_social |
| `contabilidade_id` | number | Filtra por contabilidade |
| `has_cert` | boolean | `true` = só com certificado, `false` = só sem |
| `has_cred` | boolean | `true` = só com credenciais, `false` = só sem |
| `page` | number | Página (default 1) |
| `limit` | number | Itens por página (default 20, max 100) |

### Exemplo de request

```http
GET /api/empresas?search=12345678&contabilidade_id=1&has_cert=true&page=1&limit=10
```

### Exemplo de response

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "1",
        "cnpj": "12345678000199",
        "razao_social": "Empresa Exemplo Ltda",
        "regime": "Simples Nacional",
        "contabilidade_id": 1,
        "ativo": true,
        "created_at": "2025-01-15T10:00:00.000Z",
        "updated_at": "2025-02-14T12:00:00.000Z",
        "has_certificado": true,
        "cert_validade": "2026-12-31",
        "has_credenciais": false,
        "cred_status": null
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

---

## GET /api/empresas/:id

Retorna empresa com certificados e credenciais.

### Exemplo de request

```http
GET /api/empresas/1
```

### Exemplo de response

```json
{
  "success": true,
  "data": {
    "empresa": {
      "id": 1,
      "cnpj": "12345678000199",
      "razao_social": "Empresa Exemplo Ltda",
      "regime": "Simples Nacional",
      "contabilidade_id": 1,
      "ativo": true,
      "created_at": "2025-01-15T10:00:00.000Z",
      "updated_at": "2025-02-14T12:00:00.000Z"
    },
    "certificados_digitais": [
      {
        "id": 1,
        "cnpj": "12345678000199",
        "arquivo": "12345678000199.pfx",
        "data_validade": "2026-12-31",
        "contabilidade_id": 1,
        "data_cadastro": "2025-01-15T10:05:00.000Z"
      }
    ],
    "credenciais": [
      {
        "id": 1,
        "tipo": "CNPJ_SENHA",
        "usuario": "12345678000199",
        "status": "OK",
        "ultimo_teste_em": "2025-02-10T14:30:00.000Z"
      }
    ]
  }
}
```

---

## POST /api/empresas/cadastro/certificado

Cadastra empresa via certificado digital (.pfx/.p12).

### Input (multipart/form-data)

| Campo | Tipo | Obrigatório | Descrição |
|------|------|------------|-----------|
| `file` | File | Sim | Arquivo .pfx ou .p12 |
| `senha` | string | Sim | Senha do certificado |
| `contabilidade_id` | number | Não | ID da contabilidade |

### Fluxo

1. Parse do certificado (CNPJ, razão social, data_validade, serial, thumbprint)
2. Upsert empresa por CNPJ
3. Upload para Supabase Storage (path: `contabilidade/{id}/empresa/{cnpj}/certs/{timestamp}.pfx`)
4. Inserção/atualização em certificados_digitais

### Exemplo de request

```bash
curl -X POST http://localhost:3000/api/empresas/cadastro/certificado \
  -F "file=@empresa.pfx" \
  -F "senha=minhasenha" \
  -F "contabilidade_id=1"
```

### Exemplo de response

```json
{
  "success": true,
  "data": {
    "empresa": {
      "id": 1,
      "cnpj": "12345678000199",
      "razao_social": "Empresa Exemplo Ltda",
      "regime": null,
      "contabilidade_id": 1
    },
    "has_cert": true,
    "has_cred": false,
    "cert_validade": "31/12/2026",
    "cred_status": null
  },
  "message": "Certificado cadastrado com sucesso"
}
```

---

## Outras rotas (compatibilidade)

- `GET /api/empresas/contabilidade/:contabilidade_id` – listagem por contabilidade
- `GET /api/empresas/cnpj/:cnpj` – obter por CNPJ
- `POST /api/empresas` – criar empresa
- `PUT /api/empresas/:empresa_id` – atualizar empresa
- `DELETE /api/empresas/:empresa_id` – deletar empresa

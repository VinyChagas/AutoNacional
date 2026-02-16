# API da Tela Empresas – Exemplos cURL

Base URL (dev): `http://localhost:4321/api`

Todas as rotas unificadas retornam `{ "success": true, "data": ... }` ou em erro `{ "success": false, "detail": "..." }` com status HTTP adequado.

---

## 1) Listagem com filtros

```bash
# Listar primeira página (page=1, limit=20)
curl -s "http://localhost:4321/api/empresas?page=1&limit=20"

# Busca por texto (CNPJ ou razão social)
curl -s "http://localhost:4321/api/empresas?search=54246893"

# Filtrar por contabilidade
curl -s "http://localhost:4321/api/empresas?contabilidade_id=1"

# Chips: com certificado, sem credenciais, sem método
curl -s "http://localhost:4321/api/empresas?has_cert=true"
curl -s "http://localhost:4321/api/empresas?sem_cred=true"
curl -s "http://localhost:4321/api/empresas?sem_metodo=true"

# Ordenação
curl -s "http://localhost:4321/api/empresas?sort=cnpj&order=asc"
curl -s "http://localhost:4321/api/empresas?sort=razao_social&order=desc"
curl -s "http://localhost:4321/api/empresas?sort=status_geral&order=asc"
```

---

## 2) Detalhes e por CNPJ

```bash
# Detalhes da empresa (com certificados e credenciais)
curl -s "http://localhost:4321/api/empresas/1"

# Por CNPJ
curl -s "http://localhost:4321/api/empresas/cnpj/54246893000189"
```

---

## 3) Cadastro por credencial

```bash
curl -s -X POST "http://localhost:4321/api/empresas/cadastro/credencial" \
  -H "Content-Type: application/json" \
  -d '{
    "cnpj": "54246893000189",
    "razao_social": "EMPRESA EXEMPLO LTDA",
    "senha": "minhasenha",
    "tipo": "CNPJ_SENHA",
    "contabilidade_id": 1
  }'
```

---

## 4) Cadastro por certificado (multipart)

```bash
# contabilidade_id é obrigatório
curl -s -X POST "http://localhost:4321/api/empresas/cadastro/certificado" \
  -F "file=@/caminho/para/certificado.pfx" \
  -F "senha=senha_do_certificado" \
  -F "contabilidade_id=1"
```

---

## 5) Exclusão em massa

```bash
curl -s -X DELETE "http://localhost:4321/api/empresas" \
  -H "Content-Type: application/json" \
  -d '{"ids": [10, 11, 12]}'
# Resposta esperada: { "success": true, "data": { "deleted": 3 } }
```

---

## 6) Imports – Preview e confirmar certificados

```bash
# Preview (multipart: files[] + senha)
curl -s -X POST "http://localhost:4321/api/imports/certificados/preview" \
  -F "files=@cert1.pfx" \
  -F "files=@cert2.pfx" \
  -F "senha=senha_comum"

# Confirmar (envia session_id + itens aprovados + senha)
curl -s -X POST "http://localhost:4321/api/imports/certificados/confirmar" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "SESSION_ID_RETORNADO_NO_PREVIEW",
    "senha": "senha_comum",
    "itens": [{"indice": 0}, {"indice": 1}],
    "contabilidade_id": 1
  }'
```

---

## 7) Imports – Preview e confirmar credenciais

```bash
# Preview (planilha .xlsx ou .csv)
curl -s -X POST "http://localhost:4321/api/imports/credenciais/preview" \
  -F "arquivo=@credenciais.xlsx"

# Confirmar
curl -s -X POST "http://localhost:4321/api/imports/credenciais/confirmar" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "SESSION_ID_DO_PREVIEW",
    "linhas_aprovadas": [1, 2, 3]
  }'
```

---

## 8) Validações – Start, status, cancel

```bash
# Iniciar validação
curl -s -X POST "http://localhost:4321/api/validacoes/start" \
  -H "Content-Type: application/json" \
  -d '{
    "targets": ["CERTIFICADO", "CREDENCIAL"],
    "scope": { "mode": "SELECTED", "empresa_ids": [1, 2, 3] }
  }'
# Resposta: { "success": true, "data": { "job_id": "val_..." }, "message": "Validação iniciada" }

# Status do job (polling)
curl -s "http://localhost:4321/api/validacoes/val_1234567890_abc1234"

# Cancelar
curl -s -X POST "http://localhost:4321/api/validacoes/val_1234567890_abc1234/cancel"
```

---

## 9) Dashboard resumo (KPIs)

```bash
curl -s "http://localhost:4321/api/dashboard/resumo?period=30d"
# Campos: empresas_sem_metodo, certificados_vencendo, credenciais_invalidas, empresas_operacionais, ...
```

---

## 10) Contabilidades – Listagem

```bash
curl -s "http://localhost:4321/api/contabilidades"
# Resposta: { "contabilidades": [...], "total": N }
```

---

## 11) Legado – Criar, atualizar, deletar empresa

```bash
# Criar empresa (JSON)
curl -s -X POST "http://localhost:4321/api/empresas" \
  -H "Content-Type: application/json" \
  -d '{
    "cnpj": "12345678000199",
    "razao_social": "MINHA EMPRESA LTDA",
    "regime": "Simples Nacional",
    "contabilidade_id": 1
  }'

# Atualizar
curl -s -X PUT "http://localhost:4321/api/empresas/1" \
  -H "Content-Type: application/json" \
  -d '{"razao_social": "Nova Razão Social", "contabilidade_id": 2}'

# Deletar uma empresa (204 No Content)
curl -s -X DELETE "http://localhost:4321/api/empresas/1" -w "\n%{http_code}\n"
```

---

*Documentação gerada para testes manuais da API da tela Empresas – AutoNacional.*

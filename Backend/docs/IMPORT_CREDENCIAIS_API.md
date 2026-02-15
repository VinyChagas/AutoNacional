# API de Importação de Credenciais

## Estrutura da Planilha

| Coluna | Conteúdo         | Campo destino                  |
|--------|------------------|--------------------------------|
| A      | Razão Social     | empresas.razao_social          |
| B      | Tipo de Login    | credenciais.tipo (CNPJ ou CPF) |
| C      | CNPJ ou CPF      | empresas.cnpj + credenciais.usuario |
| D      | Senha            | credenciais.senha_criptografada |
| E      | Regime Tributário| empresas.regime (opcional)     |

- **Linha 1:** Opcional (título)
- **Linha 2:** Cabeçalhos obrigatórios (Razão Social, Tipo de Login, CNPJ ou CPF, Senha, Regime Tributário)
- **Linha 3+:** Dados

---

## POST /api/imports/credenciais/preview

### Entrada
- **Content-Type:** `multipart/form-data`
- **Campo:** `arquivo` (arquivo .xlsx ou .csv)

### Exemplo (curl)
```bash
curl -X POST http://localhost:4321/api/imports/credenciais/preview \
  -F "arquivo=@planilha_credenciais.xlsx"
```

### Resposta de sucesso (200)
```json
{
  "success": true,
  "data": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "total": 2,
    "validos": 2,
    "erros": 0,
    "items": [
      {
        "linha": 3,
        "razao_social": "BLESSED LICENCAS LTDA",
        "documento": "54246893000189",
        "tipo": "CNPJ",
        "existe_empresa": false,
        "existe_credencial": false,
        "acao": "CRIAR_EMPRESA"
      },
      {
        "linha": 4,
        "razao_social": "CARX - SERVICOS AUTOMOTIVOS LTDA",
        "documento": "32639996000176",
        "tipo": "CNPJ",
        "existe_empresa": true,
        "existe_credencial": true,
        "acao": "ATUALIZAR_CREDENCIAL"
      }
    ]
  }
}
```

### Ações possíveis
- `CRIAR_EMPRESA` - Empresa e credencial serão criadas
- `CRIAR_CREDENCIAL` - Empresa existe, credencial será criada
- `ATUALIZAR_CREDENCIAL` - Ambos existem, credencial será atualizada
- `ERRO` - Linha com erro de validação (campo `erro` contém a mensagem)

### Resposta de erro (400)
```json
{
  "success": false,
  "detail": "Modelo de planilha inválido. Utilize o modelo oficial."
}
```

---

## POST /api/imports/credenciais/confirmar

### Entrada
- **Content-Type:** `application/json`
- **Body:** `{ "session_id": string, "linhas_aprovadas": number[] }`

### Exemplo (curl)
```bash
curl -X POST http://localhost:4321/api/imports/credenciais/confirmar \
  -H "Content-Type: application/json" \
  -d '{"session_id":"550e8400-e29b-41d4-a716-446655440000","linhas_aprovadas":[3,4]}'
```

### Resposta de sucesso (201)
```json
{
  "success": true,
  "data": {
    "success": true,
    "criadas": 2,
    "atualizadas": 0,
    "erros": 0
  },
  "message": "Importação de credenciais concluída"
}
```

### Resposta de erro (400)
```json
{
  "success": false,
  "detail": "Sessão inválida ou expirada. Faça o preview novamente."
}
```

---

## Validações

- **Tipo de Login:** Apenas `CNPJ` ou `CPF`
- **CNPJ:** 14 dígitos (máscara removida)
- **CPF:** 11 dígitos (máscara removida)
- **Razão Social:** Obrigatória
- **Senha:** Obrigatória (criptografada com AES antes de salvar)
- **Regime Tributário:** Opcional

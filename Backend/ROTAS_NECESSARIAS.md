# Lista de Rotas Necessárias para o Frontend

Este documento lista todas as rotas que precisam ser implementadas no backend para que o frontend funcione completamente.

## Base URL
Todas as rotas estão sob o prefixo `/api`

---

## 📋 1. Rotas de Certificados Digitais

### 1.1. POST `/api/certificados`
**Status:** ✅ Já implementada (em `Backend/main.py`)

**Descrição:** Upload de certificado digital (.pfx ou .p12)

**Request:**
- `Content-Type: multipart/form-data`
- `cnpj` (FormData): CNPJ da empresa (14 dígitos)
- `senha` (FormData): Senha do certificado
- `certificado` (File): Arquivo .pfx ou .p12

**Response:**
```json
{
  "sucesso": true,
  "mensagem": "Certificado salvo com sucesso",
  "cnpj": "00000000000011",
  "dataUpload": "2024-01-15T10:30:00Z"
}
```

**Erros possíveis:**
- `400`: CNPJ inválido, senha vazia, arquivo inválido
- `401`: Senha incorreta
- `500`: Erro ao salvar certificado

---

### 1.2. GET `/api/certificados`
**Status:** ❌ **NECESSÁRIA**

**Descrição:** Lista todos os certificados cadastrados

**Request:** Nenhum parâmetro

**Response:**
```json
[
  {
    "id": "uuid-ou-cnpj",
    "cnpj": "00000000000011",
    "nomeArquivo": "00000000000011.pfx",
    "dataUpload": "2024-01-15T10:30:00Z",
    "dataValidade": "2025-01-15T23:59:59Z",
    "diasAteExpiracao": 365,
    "status": "valido"
  }
]
```

**Status possíveis:**
- `valido`: Certificado válido (mais de 30 dias até expiração)
- `proximo_vencimento`: Entre 0 e 30 dias até expiração
- `vencido`: Já expirado

**Observações:**
- Deve ler os arquivos criptografados do diretório `certificados_armazenados/`
- Deve calcular `diasAteExpiracao` baseado na data de validade do certificado
- Deve determinar `status` baseado nos dias até expiração

---

### 1.3. GET `/api/certificados/{cnpj}`
**Status:** ❌ **NECESSÁRIA**

**Descrição:** Obtém informações de um certificado específico

**Parâmetros:**
- `cnpj` (path): CNPJ da empresa (14 dígitos)

**Response:**
```json
{
  "id": "uuid-ou-cnpj",
  "cnpj": "00000000000011",
  "nomeArquivo": "00000000000011.pfx",
  "dataUpload": "2024-01-15T10:30:00Z",
  "dataValidade": "2025-01-15T23:59:59Z",
  "diasAteExpiracao": 365,
  "status": "valido"
}
```

**Erros possíveis:**
- `404`: Certificado não encontrado
- `400`: CNPJ inválido

---

### 1.4. PUT `/api/certificados/{cnpj}`
**Status:** ❌ **NECESSÁRIA**

**Descrição:** Atualiza informações de um certificado (principalmente data de validade)

**Parâmetros:**
- `cnpj` (path): CNPJ da empresa (14 dígitos)

**Request Body:**
```json
{
  "dataValidade": "2025-01-15T23:59:59Z"  // Opcional
}
```

**Response:**
```json
{
  "sucesso": true,
  "mensagem": "Certificado atualizado com sucesso",
  "cnpj": "00000000000011",
  "dataValidade": "2025-01-15T23:59:59Z"
}
```

**Erros possíveis:**
- `404`: Certificado não encontrado
- `400`: Data inválida

---

### 1.5. DELETE `/api/certificados/{cnpj}`
**Status:** ❌ **NECESSÁRIA**

**Descrição:** Remove um certificado do sistema

**Parâmetros:**
- `cnpj` (path): CNPJ da empresa (14 dígitos)

**Response:**
```json
{
  "sucesso": true,
  "mensagem": "Certificado removido com sucesso",
  "cnpj": "00000000000011"
}
```

**Erros possíveis:**
- `404`: Certificado não encontrado
- `500`: Erro ao remover arquivos

**Observações:**
- Deve remover tanto o arquivo `.pfx.enc` quanto o `.pwd.enc`

---

## 🚀 2. Rotas de Execução NFSe

### 2.1. POST `/api/nfse/{cnpj}/abrir`
**Status:** ✅ Já implementada (em `Backend/src/routers/nfse.py`)

**Descrição:** Executa automação para abrir o dashboard NFSe

**Parâmetros:**
- `cnpj` (path): CNPJ da empresa (14 dígitos)
- `headless` (query, opcional): Boolean para modo headless (padrão: false)

**Request Body:** Vazio `{}`

**Response:**
```json
{
  "sucesso": true,
  "url_atual": "https://nfse.nacional.gov.br/dashboard",
  "titulo": "Dashboard NFSe",
  "mensagem": "Autenticação realizada com sucesso",
  "logs": [
    "Iniciando automação...",
    "Carregando certificado...",
    "Autenticando no portal...",
    "Navegando para dashboard...",
    "Sucesso!"
  ]
}
```

**Erros possíveis:**
- `400`: CNPJ inválido
- `401`: Falha na autenticação (certificado não encontrado ou senha incorreta)
- `500`: Erro durante a execução

---

## 🏢 3. Rotas de Empresas (Opcional - se necessário)

### 3.1. GET `/api/empresas`
**Status:** ⚠️ Implementada como stub (em `Backend/src/routers/empresas.py`)

**Descrição:** Lista todas as empresas cadastradas

**Request:** Nenhum parâmetro

**Response:**
```json
[
  {
    "id": "uuid",
    "cnpj": "00000000000011",
    "razao_social": "Empresa Exemplo LTDA",
    "nome_fantasia": "Exemplo",
    "certificado_cadastrado": true,
    "data_cadastro": "2024-01-15T10:30:00Z"
  }
]
```

**Observações:**
- Atualmente retorna apenas dados mockados
- Se necessário, pode ser integrado com banco de dados

---

### 3.2. GET `/api/empresas/{id}`
**Status:** ❌ **NECESSÁRIA** (se usar empresas)

**Descrição:** Obtém informações de uma empresa específica

**Parâmetros:**
- `id` (path): ID ou CNPJ da empresa

**Response:**
```json
{
  "id": "uuid",
  "cnpj": "00000000000011",
  "razao_social": "Empresa Exemplo LTDA",
  "nome_fantasia": "Exemplo",
  "certificado_cadastrado": true,
  "data_cadastro": "2024-01-15T10:30:00Z"
}
```

---

## 📊 Resumo de Status

### ✅ Rotas Já Implementadas
1. `POST /api/certificados` - Upload de certificado
2. `POST /api/nfse/{cnpj}/abrir` - Executar automação NFSe

### ❌ Rotas Necessárias (Prioridade Alta)
1. `GET /api/certificados` - Listar certificados
2. `GET /api/certificados/{cnpj}` - Obter certificado específico
3. `PUT /api/certificados/{cnpj}` - Atualizar certificado
4. `DELETE /api/certificados/{cnpj}` - Remover certificado

### ⚠️ Rotas Opcionais (Dependem da necessidade)
1. `GET /api/empresas` - Listar empresas (já existe como stub)
2. `GET /api/empresas/{id}` - Obter empresa específica

---

## 🔧 Observações Técnicas

### Armazenamento de Certificados
- Os certificados são armazenados em `Backend/certificados_armazenados/`
- Formato: `{cnpj}.pfx.enc` (certificado criptografado) e `{cnpj}.pwd.enc` (senha criptografada)
- Criptografia: Fernet (chave em variável de ambiente `FERNET_KEY`)

### Extração de Data de Validade
- A data de validade pode ser extraída do próprio certificado usando `cryptography.x509`
- Exemplo de código:
```python
from cryptography import x509
from cryptography.hazmat.primitives.serialization import pkcs12

# Após descriptografar e carregar o certificado
cert_data = pkcs12.load_key_and_certificates(conteudo_pfx, senha.encode())
cert = cert_data[1]  # Certificado
data_validade = cert.not_valid_after  # datetime
```

### Cálculo de Status
- `valido`: `diasAteExpiracao > 30` ou `diasAteExpiracao === null`
- `proximo_vencimento`: `0 <= diasAteExpiracao <= 30`
- `vencido`: `diasAteExpiracao < 0`

### Formato de Datas
- Todas as datas devem ser retornadas em formato ISO 8601 (UTC)
- Exemplo: `"2024-01-15T10:30:00Z"`

---

## 📝 Próximos Passos

1. **Implementar rotas de certificados:**
   - Criar router em `Backend/src/routers/certificados.py`
   - Implementar funções de leitura/atualização/remoção de certificados
   - Extrair data de validade dos certificados
   - Calcular status baseado na validade

2. **Integrar com o router principal:**
   - Adicionar router de certificados em `Backend/src/main.py`
   - Garantir que todas as rotas estejam sob `/api`

3. **Testar integração:**
   - Verificar se o frontend consegue listar certificados
   - Testar atualização e remoção
   - Validar cálculos de status e dias até expiração


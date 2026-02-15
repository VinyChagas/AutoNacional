# 🔧 Endpoints de Limpeza e Verificação de Integridade

## 📋 Endpoints Implementados

### 1. **POST `/api/empresas/limpar-contabilidades-orfaos`**

Remove vínculos de empresas com contabilidades que não existem mais.

**Descrição:**
- Busca todas as empresas com `contabilidade_id` preenchido
- Verifica se a contabilidade ainda existe no banco principal (`get_conn()`)
- Remove o vínculo (define `contabilidade_id` como `None`) se não existir
- Retorna estatísticas da operação

**⚠️ Atenção:** Esta operação **modifica dados** no banco. Use com cuidado.

**Resposta:**
```json
{
  "total_empresas_verificadas": 10,
  "empresas_com_contabilidade": 8,
  "contabilidades_orfaos_encontradas": 2,
  "empresas_atualizadas": 2,
  "empresas_afetadas": [
    {
      "id": 5,
      "cnpj": "12345678000190",
      "razao_social": "Empresa Exemplo",
      "contabilidade_id_removido": 99
    }
  ]
}
```

**Exemplo de uso:**
```bash
curl -X POST http://localhost:8000/api/empresas/limpar-contabilidades-orfaos
```

---

### 2. **GET `/api/empresas/verificar-integridade`**

Verifica a integridade dos vínculos entre empresas e contabilidades.

**Descrição:**
- Operação **somente leitura** (não modifica dados)
- Conta todas as empresas no banco
- Verifica quais têm contabilidades vinculadas
- Identifica empresas com contabilidades órfãs
- Retorna estatísticas detalhadas

**Recomendação:** Use este endpoint antes de executar a limpeza para verificar se há problemas.

**Resposta:**
```json
{
  "total_empresas": 15,
  "empresas_sem_contabilidade": 5,
  "empresas_com_contabilidade": 10,
  "contabilidades_validas": 3,
  "contabilidades_orfaos": 2,
  "empresas_orfaos": [
    {
      "id": 5,
      "cnpj": "12345678000190",
      "razao_social": "Empresa Exemplo",
      "contabilidade_id_invalido": 99
    },
    {
      "id": 8,
      "cnpj": "98765432000111",
      "razao_social": "Outra Empresa",
      "contabilidade_id_invalido": 100
    }
  ],
  "status": "encontrados_orfaos"
}
```

**Status possíveis:**
- `"ok"`: Nenhuma contabilidade órfã encontrada
- `"encontrados_orfaos"`: Há contabilidades órfãs que precisam ser limpas

**Exemplo de uso:**
```bash
curl http://localhost:8000/api/empresas/verificar-integridade
```

---

### 3. **GET `/api/empresas/contabilidades-orfaos`**

Lista empresas que têm contabilidades órfãs.

**Descrição:**
- Operação **somente leitura**
- Retorna apenas empresas com problemas de integridade
- Útil para visualização rápida de problemas

**Resposta:**
```json
[
  {
    "id": 5,
    "cnpj": "12345678000190",
    "razao_social": "Empresa Exemplo",
    "contabilidade_id_invalido": 99
  },
  {
    "id": 8,
    "cnpj": "98765432000111",
    "razao_social": "Outra Empresa",
    "contabilidade_id_invalido": 100
  }
]
```

**Exemplo de uso:**
```bash
curl http://localhost:8000/api/empresas/contabilidades-orfaos
```

---

## 🔄 Fluxo Recomendado de Uso

### 1. **Verificar Integridade Primeiro**
```bash
# Verifica se há problemas
GET /api/empresas/verificar-integridade
```

### 2. **Listar Empresas com Problemas (Opcional)**
```bash
# Lista empresas específicas com contabilidades órfãs
GET /api/empresas/contabilidades-orfaos
```

### 3. **Executar Limpeza (Se Necessário)**
```bash
# Remove vínculos órfãos
POST /api/empresas/limpar-contabilidades-orfaos
```

### 4. **Verificar Novamente**
```bash
# Confirma que a limpeza funcionou
GET /api/empresas/verificar-integridade
```

---

## 📊 Exemplo Completo de Uso

```bash
# 1. Verificar integridade
curl http://localhost:8000/api/empresas/verificar-integridade | jq

# Resposta esperada se houver problemas:
# {
#   "status": "encontrados_orfaos",
#   "contabilidades_orfaos": 2,
#   ...
# }

# 2. Listar empresas afetadas
curl http://localhost:8000/api/empresas/contabilidades-orfaos | jq

# 3. Executar limpeza
curl -X POST http://localhost:8000/api/empresas/limpar-contabilidades-orfaos | jq

# 4. Verificar novamente (deve retornar status: "ok")
curl http://localhost:8000/api/empresas/verificar-integridade | jq
```

---

## ⚠️ Considerações Importantes

### Segurança
- Estes endpoints não requerem autenticação especial (usam a mesma autenticação do resto da API)
- Considere adicionar permissões administrativas se necessário

### Performance
- A verificação pode ser lenta com muitos registros
- A limpeza faz commit em lote para melhor performance
- Logs detalhados são gerados para auditoria

### Logs
- Todas as operações são logadas
- Empresas afetadas são registradas com detalhes
- Use os logs para auditoria e troubleshooting

---

## 🔍 Detalhes Técnicos

### Funções CRUD Implementadas

1. **`limpar_contabilidades_orfaos(db: Session) -> dict`**
   - Localização: `Backend/src/db/crud_empresas.py`
   - Desabilita temporariamente foreign keys durante operação
   - Atualiza `updated_at` das empresas modificadas

2. **`verificar_integridade_vinculos(db: Session) -> dict`**
   - Localização: `Backend/src/db/crud_empresas.py`
   - Operação somente leitura
   - Não modifica dados do banco

### Schemas de Resposta

- **`LimpezaContabilidadesOrfaosResponse`**: Schema para resposta de limpeza
- **`VerificacaoIntegridadeResponse`**: Schema para resposta de verificação

Localização: `Backend/src/schemas/empresas.py`

---

## 📝 Notas de Implementação

- As funções consultam o banco `get_conn()` para obter contabilidades válidas
- A limpeza usa `PRAGMA foreign_keys=OFF` temporariamente para evitar erros
- Todas as operações são transacionais (rollback em caso de erro)
- Logs detalhados são gerados para cada operação

---

**Data de Criação**: 2026-01-03  
**Versão**: 1.0


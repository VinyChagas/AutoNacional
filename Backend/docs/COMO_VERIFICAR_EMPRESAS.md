# Como Verificar Empresas Cadastradas no Banco de Dados

Este documento explica as diferentes formas de verificar as empresas cadastradas no sistema.

## 📋 Métodos Disponíveis

### 1. Via Script Python (Recomendado)

Use o script `listar_empresas.py` que foi criado especialmente para isso:

```bash
# Listar todas as empresas
python scripts/listar_empresas.py

# Listar apenas empresas COM credenciais
python scripts/listar_empresas.py --com-credenciais

# Listar apenas empresas SEM credenciais
python scripts/listar_empresas.py --sem-credenciais

# Buscar empresa por CNPJ específico
python scripts/listar_empresas.py --cnpj 12345678000190
```

**Saída do script:**
```
====================================================================================================
ID     CNPJ                 Razão Social                                    Regime          Credenciais
====================================================================================================
103    22.760.220/0001-56   JOSE MAURICIO MOREIRA                            SIMPLES        1
114    60.896.301/0001-77   MAKOB - SERV - 2005                              SIMPLES        1
...

Total de empresas: 46
  - Com credenciais: 6
  - Sem credenciais: 40
  - Total de credenciais: 6
```

### 2. Via API REST (Endpoint HTTP)

Use o endpoint da API para listar empresas:

```bash
# Listar todas as empresas (primeiras 100)
curl http://localhost:8000/api/empresas

# Com paginação (pular 0, limitar a 100)
curl http://localhost:8000/api/empresas?skip=0&limit=100

# Buscar empresa por CNPJ
curl http://localhost:8000/api/empresas/cnpj/12345678000190

# Buscar empresa por ID
curl http://localhost:8000/api/empresas/103
```

**Resposta JSON:**
```json
[
  {
    "id": "103",
    "cnpj": "22760220000156",
    "razao_social": "JOSE MAURICIO MOREIRA",
    "regime": "SIMPLES",
    "contabilidade_id": 11,
    "created_at": "2026-01-05T13:06:59",
    "updated_at": "2026-01-05T13:06:59"
  },
  ...
]
```

### 3. Via SQLite Diretamente

Se você tem acesso ao arquivo do banco de dados, pode consultar diretamente:

```bash
# Localização do banco de dados
cd Backend/db

# Abrir SQLite
sqlite3 certificados.db

# Listar todas as empresas
SELECT id, cnpj, razao_social, regime, contabilidade_id, created_at 
FROM empresas 
ORDER BY razao_social;

# Contar total de empresas
SELECT COUNT(*) FROM empresas;

# Listar empresas com credenciais
SELECT e.id, e.cnpj, e.razao_social, COUNT(c.id) as qtd_credenciais
FROM empresas e
LEFT JOIN credenciais_login c ON e.id = c.empresa_id
GROUP BY e.id, e.cnpj, e.razao_social
HAVING COUNT(c.id) > 0
ORDER BY e.razao_social;

# Listar empresas sem credenciais
SELECT e.id, e.cnpj, e.razao_social
FROM empresas e
LEFT JOIN credenciais_login c ON e.id = c.empresa_id
WHERE c.id IS NULL
ORDER BY e.razao_social;

# Buscar empresa por CNPJ
SELECT * FROM empresas WHERE cnpj = '22760220000156';

# Ver credenciais de uma empresa específica
SELECT c.id, c.tipo, c.usuario, c.status, c.created_at
FROM credenciais_login c
WHERE c.empresa_id = 103;
```

### 4. Via Frontend (Interface Web)

Se o frontend estiver configurado, você pode acessar a interface web e navegar até a seção de empresas para visualizar todas as empresas cadastradas.

## 🔍 Verificações Úteis

### Verificar se uma empresa específica existe

```bash
# Via script
python scripts/listar_empresas.py --cnpj 22760220000156

# Via API
curl http://localhost:8000/api/empresas/cnpj/22760220000156

# Via SQLite
sqlite3 db/certificados.db "SELECT * FROM empresas WHERE cnpj = '22760220000156';"
```

### Verificar empresas com credenciais

```bash
# Via script
python scripts/listar_empresas.py --com-credenciais

# Via SQLite
sqlite3 db/certificados.db "
SELECT e.id, e.cnpj, e.razao_social, COUNT(c.id) as credenciais
FROM empresas e
LEFT JOIN credenciais_login c ON e.id = c.empresa_id
GROUP BY e.id
HAVING COUNT(c.id) > 0;"
```

### Verificar empresas sem credenciais

```bash
# Via script
python scripts/listar_empresas.py --sem-credenciais

# Via SQLite
sqlite3 db/certificados.db "
SELECT e.id, e.cnpj, e.razao_social
FROM empresas e
LEFT JOIN credenciais_login c ON e.id = c.empresa_id
WHERE c.id IS NULL;"
```

### Contar total de empresas e credenciais

```bash
# Via SQLite
sqlite3 db/certificados.db "
SELECT 
    (SELECT COUNT(*) FROM empresas) as total_empresas,
    (SELECT COUNT(*) FROM credenciais_login) as total_credenciais,
    (SELECT COUNT(DISTINCT empresa_id) FROM credenciais_login) as empresas_com_credenciais;"
```

## 📊 Estatísticas Rápidas

Para obter estatísticas rápidas do banco:

```bash
# Executar o script sem filtros mostra estatísticas no final
python scripts/listar_empresas.py
```

## 🗑️ Limpar Todas as Empresas

Se precisar resetar completamente o banco:

```bash
# Via API
curl -X DELETE http://localhost:8000/api/empresas/limpar-tudo

# Via SQLite (CUIDADO: operação irreversível!)
sqlite3 db/certificados.db "
DELETE FROM credenciais_login;
DELETE FROM empresas;"
```

## 📝 Notas Importantes

1. **Banco de Dados**: O arquivo do banco está em `Backend/db/certificados.db`
2. **Backup**: Sempre faça backup antes de deletar dados
3. **API**: A API roda em `http://localhost:8000` por padrão
4. **Scripts**: Os scripts Python devem ser executados a partir do diretório `Backend/`

## 🆘 Troubleshooting

### Erro ao executar o script

Se o script não funcionar, verifique:
- Python 3.8+ instalado
- Dependências instaladas (`pip install -r requirements.txt`)
- Banco de dados existe em `Backend/db/certificados.db`

### Erro ao acessar API

Se a API não responder:
- Verifique se o servidor está rodando (`python run_server.py`)
- Verifique se a porta 8000 está disponível
- Verifique os logs do servidor

### Empresas não aparecem

Se empresas não aparecem mas você sabe que existem:
- Verifique se está usando o banco de dados correto
- Verifique se há filtros aplicados
- Execute uma consulta SQL direta para confirmar


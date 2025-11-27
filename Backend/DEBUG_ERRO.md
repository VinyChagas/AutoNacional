# 🔍 Debug do Erro HTTP 0 Unknown Error

## Problema
Erro HTTP 0 Unknown Error ao tentar executar automação via frontend.

## Possíveis Causas

1. **Erro de Importação**: Os módulos `playwright_nfse` ou `emitidas_automation` não estão sendo encontrados após a reorganização
2. **Erro no Servidor**: O servidor pode estar crashando ao tentar processar a requisição
3. **CORS**: Problema de CORS impedindo a requisição
4. **Exceção Não Tratada**: Alguma exceção está sendo lançada antes de retornar a resposta

## Soluções Implementadas

### 1. Handler Global de Exceções
Adicionado em `main.py` para capturar todas as exceções não tratadas e retornar resposta JSON apropriada.

### 2. Import Lazy do ExecutionService
Modificado o router para importar o execution_service apenas quando necessário, evitando erros de importação circular.

### 3. Logging Melhorado
Adicionado logging detalhado de erros com traceback completo.

## Como Debugar

### 1. Verificar Logs do Servidor
```bash
# Inicie o servidor e observe os logs
./scripts/init/iniciar_backend.sh
```

### 2. Testar Endpoint Diretamente
```bash
curl -X POST "http://localhost:8000/api/execucao/00363320000106?competencia=102025&tipo=ambas&headless=false"
```

### 3. Verificar Imports
```python
# Teste se os imports estão funcionando
python3 -c "import sys; sys.path.insert(0, 'src'); from services.execution_service import get_execution_service; print('OK')"
```

### 4. Verificar CORS
Verifique se o frontend está na lista de origens permitidas em `src/infrastructure/config.py`.

## Próximos Passos

1. Verificar logs do servidor quando o erro ocorrer
2. Testar o endpoint diretamente com curl
3. Verificar se os arquivos em `scripts/automation/` estão acessíveis
4. Verificar se o path está sendo adicionado corretamente no `execution_service.py`


# 🔧 Solução para Problema do Playwright no Windows

## Problema

Ao executar automações com Playwright no Windows, ocorre o erro:
```
NotImplementedError
```

Isso acontece porque o Playwright precisa criar subprocessos para iniciar o navegador, e o loop de eventos padrão no Windows (`SelectorEventLoop`) não suporta subprocessos adequadamente.

## Solução Implementada

Criamos um script personalizado `run_server.py` que configura o `ProactorEventLoop` **ANTES** do uvicorn iniciar seu event loop. Isso garante que subprocessos funcionem corretamente.

### Arquivos Criados/Modificados

1. **`Backend/run_server.py`** - Novo script que:
   - Configura `WindowsProactorEventLoopPolicy` antes de importar uvicorn
   - Executa uvicorn programaticamente com a política já configurada

2. **`Backend/scripts/init/iniciar_backend.bat`** - Atualizado para usar `run_server.py`

3. **`Backend/asyncio_windows_fix.py`** - Mantido como backup (importado no `main.py`)

4. **`Backend/scripts/automation/playwright_nfse.py`** - Adicionada verificação/ajuste de política (como segurança adicional)

## Como Usar

### Windows

Use o script de inicialização atualizado:

```cmd
cd Backend
.\scripts\init\iniciar_backend.bat
```

Ou diretamente:

```cmd
cd Backend
python run_server.py --host 0.0.0.0 --port 8000
```

### Linux/macOS

O script `iniciar_backend.sh` continua funcionando normalmente, pois o problema só ocorre no Windows.

## Por Que Funciona

O `ProactorEventLoop` no Windows suporta criação de subprocessos através do `asyncio.create_subprocess_exec()`, que o Playwright usa para iniciar o navegador Chromium.

Configurar a política **antes** do uvicorn iniciar garante que:
1. O primeiro event loop criado pelo uvicorn já use o `ProactorEventLoop`
2. Todos os subprocessos criados depois funcionem corretamente
3. O Playwright possa criar seus subprocessos sem erros

## Verificação

Após reiniciar o backend com o novo script, você deve ver no console:
```
[run_server] ✅ ProactorEventLoop configurado para Windows (Python 3.13)
[run_server] 🚀 Iniciando uvicorn...
```

E as automações devem funcionar sem o erro `NotImplementedError`.

## Alternativas (se não funcionar)

1. **Downgrade para Python 3.12** - Versão mais estável com subprocessos
2. **Executar sem reload** - Use `--no-reload` ao iniciar o servidor
3. **Usar Docker** - Container Linux evita o problema completamente


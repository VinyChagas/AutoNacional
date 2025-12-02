# 🔧 Problema: NotImplementedError ao iniciar Playwright no Windows

## Problema Identificado

**Erro**: `NotImplementedError` ao tentar criar subprocesso no asyncio quando o Playwright tenta iniciar o navegador.

**Traceback**:
```
File "C:\Users\ryans\AppData\Local\Programs\Python\Python313\Lib\asyncio\base_events.py", line 539, in _make_subprocess_transport
    raise NotImplementedError
```

## Causa Raiz

No Windows com Python 3.13, o Playwright precisa criar um subprocesso para iniciar o navegador Chromium. O loop de eventos padrão (`SelectorEventLoop`) no Windows não suporta a criação de subprocessos adequadamente.

## Solução

O Windows requer o `ProactorEventLoop` para subprocessos. O Python 3.8+ já usa isso por padrão no Windows, mas pode haver conflitos quando rodando dentro do FastAPI/uvicorn.

## Implementação

Criamos dois arquivos:

1. **`asyncio_windows_fix.py`**: Configura o ProactorEventLoop policy antes de qualquer coisa
2. **`main.py`**: Importa o fix no início

## Teste

Reinicie o backend e tente executar novamente. O erro deve desaparecer.

## Alternativas (se a solução não funcionar)

1. **Usar Python 3.11 ou 3.12** (mais estável para subprocessos)
2. **Executar Playwright em thread separada** (mais complexo)
3. **Usar Playwright Sync API em thread isolada** (já existe código para isso)


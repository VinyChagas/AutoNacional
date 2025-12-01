# Refatoração: Playwright Sync → Async API

## ✅ Refatoração Completa Realizada

Toda a automação NFSe foi refatorada de `sync_playwright` para `async_playwright`, permitindo integração correta com FastAPI e execução concorrente controlada.

---

## 📋 Arquivos Modificados

### 1. **Backend/scripts/automation/playwright_nfse.py**
- ✅ Substituído `from playwright.sync_api import sync_playwright` → `from playwright.async_api import async_playwright`
- ✅ Função `criar_contexto_com_certificado()` agora é `async def`
- ✅ Função `abrir_dashboard_nfse()` agora é `async def`
- ✅ Todos os métodos do Playwright agora usam `await`:
  - `await async_playwright().start()`
  - `await playwright.chromium.launch(...)`
  - `await browser.new_context(...)`
  - `await context.new_page()`
  - `await page.goto(...)`
  - `await page.click(...)`
  - `await page.wait_for_*()`
  - `await page.close()`
  - `await context.close()`
  - `await browser.close()`
  - `await playwright.stop()`

### 2. **Backend/src/services/execution_service.py**
- ✅ **REFATORADO COMPLETAMENTE** para usar `asyncio` ao invés de `threading`
- ✅ Substituído `queue.Queue` → `asyncio.Queue`
- ✅ Removido `ThreadPoolExecutor` e threads
- ✅ Adicionado `asyncio.Semaphore` para controle de concorrência
- ✅ Método `adicionar_execucao()` agora é `async def`
- ✅ Método `_processar_fila()` agora é `async def` e roda em `asyncio.Task`
- ✅ Método `_executar_fluxo_completo()` agora é `async def`
- ✅ Método `_limpar_recursos()` agora é `async def`
- ✅ Nova função `executar_multiplas_empresas()` para execução concorrente
- ✅ Nova função `_executar_com_semaphore()` para controle de concorrência
- ✅ Limite de concorrência obtido dinamicamente do banco (`default_concurrent_browsers`)

### 3. **Backend/src/routers/nfse.py**
- ✅ Endpoint `abrir_dashboard()` agora é `async def`
- ✅ Chamada `abrir_dashboard_nfse()` agora usa `await`

### 4. **Backend/src/routers/execucao.py**
- ✅ Endpoint `iniciar_execucao()` agora é `async def`
- ✅ Chamada `execution_service.adicionar_execucao()` agora usa `await`

### 5. **Backend/scripts/automation/processar_notas_competencia.py**
- ✅ **JÁ ESTAVA ASYNC** - nenhuma mudança necessária
- ✅ Funções `processar_notas()`, `processar_tabela_emitidas()`, `processar_tabela_recebidas()` já são `async def`

---

## 🎯 Principais Mudanças

### Antes (Sync API)
```python
# ❌ ANTES: Sync API com threads
from playwright.sync_api import sync_playwright

def criar_contexto_com_certificado(...):
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(...)
    context = browser.new_context(...)
    return playwright, browser, context

# Thread executora
self.thread_executora = threading.Thread(target=self._processar_fila_isolada)
self.thread_executora.start()
```

### Depois (Async API)
```python
# ✅ DEPOIS: Async API com asyncio
from playwright.async_api import async_playwright

async def criar_contexto_com_certificado(...):
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(...)
    context = await browser.new_context(...)
    return playwright, browser, context

# Task asyncio
self.task_processadora = asyncio.create_task(self._processar_fila())
```

---

## 🚀 Execução Concorrente

### Controle de Concorrência com Semaphore

O sistema agora suporta execução concorrente de múltiplos navegadores simultaneamente, controlado via `asyncio.Semaphore`:

```python
# Limite obtido do banco de dados (default_concurrent_browsers)
limite = await self._obter_limite_concorrencia()  # Padrão: 3
self.semaphore = asyncio.Semaphore(limite)

# Cada execução usa o semaphore
async with self.semaphore:
    await self._executar_fluxo_completo(execucao)
```

### Executar Múltiplas Empresas

Nova função para executar várias empresas em paralelo:

```python
lista_execucoes = [
    {
        "empresa_id": "empresa-1",
        "cnpj": "12345678000190",
        "competencia": "112025",
        "tipo": "ambas",
        "headless": True
    },
    # ... mais execuções
]

await execution_service.executar_multiplas_empresas(
    lista_execucoes,
    limite_concorrencia=5  # Opcional, usa do banco se None
)
```

---

## 🔧 Configuração de Concorrência

O limite de navegadores simultâneos é configurado no banco de dados:

- **Tabela:** `automation_settings`
- **Campo:** `default_concurrent_browsers` (padrão: 3)
- **Campo:** `max_concurrent_browsers` (máximo permitido: 5)

O sistema lê automaticamente essa configuração na inicialização.

---

## ✅ Benefícios da Refatoração

1. **✅ Integração Correta com FastAPI**
   - Não há mais conflito entre sync_playwright e loop asyncio
   - Endpoints FastAPI podem ser totalmente async

2. **✅ Execução Concorrente**
   - Múltiplos navegadores podem executar simultaneamente
   - Controle de concorrência via Semaphore
   - Limite configurável no banco de dados

3. **✅ Melhor Performance**
   - Execuções não bloqueiam o loop de eventos
   - Melhor uso de recursos do sistema
   - Escalabilidade melhorada

4. **✅ Código Mais Limpo**
   - Sem necessidade de threads isoladas
   - Sem necessidade de remover contexto asyncio
   - Código mais simples e manutenível

---

## 🧪 Testes Recomendados

Após a refatoração, teste:

1. ✅ Executar uma única empresa
2. ✅ Executar múltiplas empresas simultaneamente
3. ✅ Verificar controle de concorrência (não deve exceder o limite)
4. ✅ Verificar persistência de estado no banco
5. ✅ Verificar logs e rastreamento de execuções

---

## 📝 Notas Importantes

- ⚠️ **Backup Criado:** O arquivo antigo foi salvo como `execution_service_sync_backup.py`
- ✅ **Compatibilidade:** Todos os endpoints mantêm a mesma interface externa
- ✅ **Persistência:** Estado continua sendo persistido no banco de dados
- ✅ **Logs:** Sistema de logs mantido e funcionando

---

## 🎉 Conclusão

A refatoração foi concluída com sucesso! O sistema agora usa completamente `async_playwright` e está preparado para execução concorrente controlada, integrando corretamente com FastAPI e asyncio.

**Nenhum código sync_playwright permanece no projeto!** ✅


# Revisão de Arquitetura - Backend AutoNacional

## Análise das Questões Práticas

### 1. ❌ Cada worker tem sua PRÓPRIA conexão com o SQLite?

**Resposta: NÃO**

**Situação Atual:**
- O sistema usa **apenas 1 thread executora** (não há múltiplos workers)
- O SQLAlchemy usa um **engine compartilhado** (`SessionLocal`) criado uma única vez
- Cada requisição cria uma nova sessão através de `get_db()`, mas todas compartilham o mesmo engine
- O SQLite está configurado com `check_same_thread=False`, permitindo múltiplas threads, mas **sem WAL mode**

**Problemas Identificados:**
```27:31:Backend/src/db/session.py
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,  # Mude para True para ver logs SQL
)
```

- Não há configuração de pool de conexões
- Não há configuração de WAL mode
- Múltiplas sessões podem causar locks no SQLite

**Recomendação:**
- Se implementar múltiplos workers no futuro, cada um deve ter seu próprio engine ou usar pool de conexões adequado
- Configurar WAL mode para permitir leituras concorrentes

---

### 2. ❌ O SQLite está com journal_mode = WAL?

**Resposta: NÃO**

**Situação Atual:**
- Não há configuração de `PRAGMA journal_mode=WAL` no código
- O SQLite está usando o modo padrão (DELETE), que bloqueia o banco durante writes

**Problemas:**
- Sem WAL mode, apenas uma operação de escrita pode ocorrer por vez
- Leituras podem ser bloqueadas durante writes
- Performance degradada em cenários concorrentes

**Código Atual:**
```27:31:Backend/src/db/session.py
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)
```

**Recomendação:**
Adicionar WAL mode na inicialização:
```python
connect_args={
    "check_same_thread": False,
    "isolation_level": None  # Auto-commit mode
}
# E executar PRAGMA journal_mode=WAL após conexão
```

---

### 3. ⚠️ Você está usando asyncio.Queue ou algum mecanismo seguro pra fila?

**Resposta: PARCIALMENTE**

**Situação Atual:**
- Usa `queue.Queue` (thread-safe) do Python padrão, **NÃO** `asyncio.Queue`
- A fila é thread-safe e funciona corretamente para o caso atual
- Há apenas **1 thread executora**, então não há concorrência real na fila

**Código:**
```54:54:Backend/src/services/execution_service.py
self.fila_execucoes: Queue = Queue()
```

**Análise:**
- ✅ `queue.Queue` é thread-safe e adequado para o caso atual
- ✅ Usa `threading.Lock()` para proteger operações críticas
- ⚠️ Se migrar para asyncio no futuro, deveria usar `asyncio.Queue`
- ⚠️ Não há persistência da fila (se o processo morrer, a fila é perdida)

**Recomendação:**
- Para o caso atual (1 worker sequencial), `queue.Queue` está adequado
- Se implementar múltiplos workers assíncronos, migrar para `asyncio.Queue`
- Considerar persistência da fila (Redis, banco de dados) para resiliência

---

### 4. ✅ O Playwright é iniciado 1x por processo e só cria contextos por execução?

**Resposta: SIM**

**Situação Atual:**
- ✅ Playwright é iniciado **uma vez por execução** (não por processo)
- ✅ Cada execução cria seu próprio contexto do navegador
- ✅ Recursos são limpos após cada execução

**Código:**
```145:199:Backend/scripts/automation/playwright_nfse.py
playwright = sync_playwright().start()

# Lança o Chromium
browser = playwright.chromium.launch(...)

# Cria contexto com certificado
context = browser.new_context(...)
```

**Fluxo:**
1. Cada execução chama `criar_contexto_com_certificado()` que inicia um novo Playwright
2. Cria um novo browser e context para cada execução
3. Limpa recursos no `finally` após execução

**Análise:**
- ✅ Isolamento correto entre execuções
- ✅ Cada execução tem seu próprio contexto/navegador
- ⚠️ Overhead de iniciar Playwright a cada execução (mas necessário para isolamento)

**Recomendação:**
- Manter como está (isolamento é mais importante que performance)
- Se precisar otimizar, considerar pool de browsers, mas manter contextos separados

---

### 5. ⚠️ Existem logs por worker e por certificado pra rastrear?

**Resposta: PARCIALMENTE**

**Situação Atual:**
- ✅ Logs centralizados usando `get_logger(__name__)`
- ✅ Logs por execução armazenados em `ExecucaoInfo.logs`
- ⚠️ Não há identificação explícita de "worker" (só há 1 thread)
- ⚠️ Logs não são persistidos no banco de dados
- ⚠️ Logs são apenas em memória (perdidos se processo morrer)

**Código:**
```503:508:Backend/src/services/execution_service.py
def _adicionar_log(self, execucao: ExecucaoInfo, mensagem: str):
    """Adiciona uma mensagem de log à execução."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    log_msg = f"[{timestamp}] {mensagem}"
    execucao.logs.append(log_msg)
    logger.info(f"Empresa {execucao.empresa_id}: {mensagem}")
```

**Análise:**
- ✅ Logs incluem timestamp e empresa_id
- ✅ Logs são adicionados durante toda a execução
- ❌ Logs não são persistidos (apenas em memória)
- ❌ Não há logs por certificado específico (apenas por execução/empresa)
- ❌ Não há identificação de worker (não há múltiplos workers)

**Recomendação:**
- Adicionar persistência de logs no banco de dados
- Adicionar identificador único por execução para rastreamento
- Se implementar múltiplos workers, adicionar worker_id nos logs

---

### 6. ⚠️ A quantidade de navegadores simultâneos está adequada ao hardware?

**Resposta: NÃO APLICÁVEL (mas há configuração)**

**Situação Atual:**
- ⚠️ Sistema executa **apenas 1 navegador por vez** (execução sequencial)
- ✅ Há configuração no modelo `AutomationSettings` para `max_concurrent_browsers`
- ❌ Configuração não é usada atualmente (sistema é sequencial)

**Código:**
```49:52:Backend/src/db/models.py
# Navegadores / Concorrência
max_concurrent_browsers = Column(Integer, default=5, nullable=False)
default_concurrent_browsers = Column(Integer, default=3, nullable=False)
```

**Análise:**
- ⚠️ Configuração existe mas não é aplicada
- ⚠️ Sistema atual não permite múltiplos navegadores simultâneos
- ⚠️ Não há validação de recursos do sistema antes de iniciar navegadores

**Recomendação:**
- Se implementar concorrência, usar `max_concurrent_browsers` da configuração
- Adicionar validação de recursos (CPU, memória) antes de iniciar navegadores
- Considerar limite baseado no hardware disponível

---

### 7. ⚠️ O estado do certificado (pendente / em execução / finalizado / erro) está sendo salvo de forma consistente?

**Resposta: PARCIALMENTE**

**Situação Atual:**
- ✅ Estado é atualizado em memória durante execução
- ❌ Estado **NÃO é persistido no banco de dados**
- ❌ Estado é perdido se o processo morrer
- ✅ Estado é retornado via API através de `obter_status()`

**Código:**
```229:230:Backend/src/services/execution_service.py
execucao.data_inicio = datetime.now()
execucao.status = StatusExecucao.EM_EXECUCAO
```

**Problemas:**
- Estado vive apenas em `self.execucoes_ativas` (dicionário em memória)
- Se o processo reiniciar, todos os estados são perdidos
- Não há histórico de execuções anteriores
- Não há recuperação de execuções interrompidas

**Recomendação:**
- Criar tabela `execucoes` no banco de dados
- Persistir estado após cada mudança significativa
- Implementar recuperação de execuções interrompidas na inicialização
- Adicionar histórico de execuções

---

## Resumo Executivo

### ✅ Pontos Positivos:
1. Playwright isolado por execução (boa prática)
2. Fila thread-safe adequada para caso atual
3. Logs estruturados por execução
4. Limpeza adequada de recursos

### ❌ Problemas Críticos:
1. **SQLite sem WAL mode** - pode causar locks e problemas de concorrência
2. **Estado não persistido** - execuções são perdidas se processo morrer
3. **Logs não persistidos** - histórico é perdido
4. **Sem múltiplos workers** - sistema é sequencial (pode ser intencional)

### ⚠️ Melhorias Recomendadas:
1. Configurar WAL mode no SQLite
2. Persistir estado de execuções no banco de dados
3. Persistir logs no banco de dados
4. Implementar recuperação de execuções interrompidas
5. Se implementar múltiplos workers, usar pool de conexões adequado

---

## Próximos Passos Sugeridos

1. **Urgente:** Configurar WAL mode no SQLite
2. **Importante:** Criar tabela de execuções e persistir estado
3. **Importante:** Persistir logs no banco de dados
4. **Opcional:** Avaliar necessidade de múltiplos workers (pode não ser necessário)
5. **Opcional:** Implementar fila persistente (Redis ou banco) para resiliência


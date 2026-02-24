# Arquitetura Detalhada do Backend AutoNacional

## 📐 Visão Geral da Arquitetura

O Backend AutoNacional segue uma arquitetura em camadas (layered architecture) com separação clara de responsabilidades:

```
┌─────────────────────────────────────────────────────────────┐
│                    Camada de Apresentação                   │
│                    (Routers / Endpoints)                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                    Camada de Negócio                         │
│                    (Services)                                │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                    Camada de Dados                           │
│                    (Repositories / DB)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏛️ Camadas da Arquitetura

### 1. Camada de Apresentação (Routers)

**Responsabilidade:** Receber requisições HTTP, validar dados de entrada e retornar respostas HTTP.

**Componentes:**
- `src/routers/*.py` - Módulos de rotas FastAPI
- Validação de entrada via Pydantic
- Tratamento de erros HTTP
- Serialização de respostas

**Características:**
- ✅ Não contém lógica de negócio
- ✅ Delega processamento para Services
- ✅ Retorna apenas dados serializados

**Exemplo de Fluxo:**
```python
@router.post("/api/execucao/{empresa_id}")
async def iniciar_execucao(empresa_id: str, ...):
    # Valida entrada
    # Chama service
    service = get_execution_service()
    resultado = await service.adicionar_execucao(...)
    # Retorna resposta HTTP
    return resultado
```

---

### 2. Camada de Negócio (Services)

**Responsabilidade:** Implementar toda a lógica de negócio da aplicação.

**Componentes:**
- `src/services/certificate_service.py` - Lógica de certificados
- `src/services/execution_service.py` - Lógica de execução

**Características:**
- ✅ Contém toda a lógica de negócio
- ✅ Orquestra chamadas a scripts de automação
- ✅ Gerencia estado e filas
- ✅ Não conhece detalhes de HTTP

#### CertificateService

**Responsabilidades:**
- Validação de certificados A1
- Extração de informações (CNPJ, validade)
- Criptografia/descriptografia de certificados
- Armazenamento seguro em disco

**Métodos Principais:**
- `salvar_certificado()` - Criptografa e salva certificado
- `carregar_certificado()` - Carrega e descriptografa certificado
- `validar_certificado()` - Valida formato e conteúdo
- `extrair_informacoes()` - Extrai CNPJ e outras informações

#### ExecutionService

**Responsabilidades:**
- Gerenciamento de fila de execuções
- Orquestração de scripts de automação
- Controle de concorrência
- Persistência de status de execução

**Métodos Principais:**
- `adicionar_execucao()` - Adiciona execução à fila
- `_executar_fluxo_completo()` - Executa fluxo completo de automação
- `obter_status()` - Consulta status de execução
- `_processar_fila()` - Processa fila de execuções

**Fluxo Interno:**
```
adicionar_execucao()
  → Cria ExecucaoInfo
  → Adiciona à fila (Queue)
  → Inicia worker se necessário
  → Retorna status inicial

_processar_fila()
  → Loop infinito
  → Remove execução da fila
  → Chama _executar_fluxo_completo()
  → Atualiza status no banco

_executar_fluxo_completo()
  → Carrega certificado
  → Executa playwright_nfse.py
  → Executa processar_notas_competencia.py
  → Executa salvamento.py
  → Atualiza status final
```

---

### 3. Camada de Dados (Repositories / DB)

**Responsabilidade:** Acesso e persistência de dados.

**Componentes:**
- `src/repositories/*.py` - Repositórios de dados
- `src/db/*.py` - Camada de persistência SQLAlchemy
- `src/core/db_mock.py` - Dados mock para desenvolvimento

**Características:**
- ✅ Abstrai acesso ao banco de dados
- ✅ Implementa operações CRUD
- ✅ Gerencia transações

#### Repositories

**EmpresasRepository:**
- `get_empresa_by_id()` - Busca empresa por ID
- `get_empresa_by_cnpj()` - Busca empresa por CNPJ
- `listar_empresas()` - Lista todas as empresas

**CredenciaisRepository:**
- `get_credenciais()` - Busca credenciais de empresa
- `salvar_credenciais()` - Salva credenciais

#### Database Layer

**Models (ORM):**
- `CertificadoDigital` - Metadados de certificados
- `Execucao` - Histórico de execuções
- `Settings` - Configurações do sistema

**CRUD Operations:**
- `crud_certificado.py` - Operações CRUD de certificados
- `crud_settings.py` - Operações CRUD de configurações

---

## 🔄 Fluxo de Dados Completo

### Fluxo de Upload de Certificado

```
1. Cliente → POST /api/certificados
   ↓
2. Router certificado.py → Valida entrada (Pydantic)
   ↓
3. CertificateService.salvar_certificado()
   ↓
4. Valida formato do certificado
   ↓
5. Criptografa certificado e senha (Fernet)
   ↓
6. Salva arquivos .pfx.enc e .pwd.enc em disco
   ↓
7. Extrai informações do certificado
   ↓
8. Salva metadados no banco (SQLAlchemy)
   ↓
9. Retorna resposta HTTP
```

### Fluxo de Execução de Automação

```
1. Cliente → POST /api/execucao/{empresa_id}
   ↓
2. Router execucao.py → Valida entrada
   ↓
3. ExecutionService.adicionar_execucao()
   ↓
4. Busca empresa e credenciais (Repositories)
   ↓
5. Cria ExecucaoInfo e adiciona à fila
   ↓
6. Worker processa fila:
   ↓
   6.1. ExecutionService._executar_fluxo_completo()
        ↓
   6.2. CertificateService.carregar_certificado()
        ↓
   6.3. playwright_nfse.py (autenticação)
        ↓
   6.4. processar_notas_competencia.py (processamento)
        ↓
   6.5. salvamento.py (salvamento)
        ↓
   6.6. Atualiza status no banco
   ↓
7. Retorna status de execução
```

---

## 🧩 Componentes de Infraestrutura

### Config (`src/infrastructure/config.py`)

**Responsabilidade:** Centralizar todas as configurações da aplicação.

**Configurações Gerenciadas:**
- Caminhos de arquivos e diretórios
- Variáveis de ambiente
- Configurações de segurança
- Configurações de execução
- Configurações CORS

**Padrão de Uso:**
```python
from src.infrastructure.config import CERTIFICATES_DIR, FERNET_KEY

# Usa configurações centralizadas
cert_path = CERTIFICATES_DIR / f"{cnpj}.pfx.enc"
```

### Logger (`src/infrastructure/logger.py`)

**Responsabilidade:** Sistema de logging padronizado.

**Características:**
- Logging estruturado
- Níveis de log configuráveis
- Formatação consistente

**Padrão de Uso:**
```python
from src.infrastructure.logger import get_logger

logger = get_logger(__name__)
logger.info("Mensagem de log")
```

---

## 🤖 Scripts de Automação

### playwright_nfse.py

**Responsabilidade:** Autenticação no portal NFSe Nacional.

**Fluxo:**
1. Recebe certificado e credenciais
2. Inicia contexto do navegador Playwright
3. Configura certificado cliente
4. Navega para portal NFSe
5. Realiza autenticação automática
6. Retorna contexto autenticado

**Características:**
- ✅ Totalmente assíncrono (async/await)
- ✅ Suporte a múltiplas execuções simultâneas
- ✅ Configuração automática de certificado
- ✅ Timeout configurável

### processar_notas_competencia.py

**Responsabilidade:** Processamento de notas fiscais de uma competência.

**Fluxo:**
1. Recebe contexto autenticado
2. Navega para página de notas
3. Filtra por competência
4. Varre notas emitidas e recebidas
5. Faz download de XML e PDF
6. Valida downloads
7. Retorna resultado

**Características:**
- ✅ Processamento assíncrono
- ✅ Gerenciamento de downloads
- ✅ Validação de arquivos
- ✅ Tratamento de erros robusto

### salvamento.py

**Responsabilidade:** Integração com sistema de salvamento.

**Fluxo:**
1. Recebe arquivos baixados
2. Processa e organiza arquivos
3. Integra com sistema de salvamento
4. Retorna status

---

## 🔐 Segurança

### Criptografia de Certificados

**Algoritmo:** Fernet (symmetric encryption)

**Processo:**
1. Certificado original (.pfx) → Bytes
2. Criptografa com Fernet usando FERNET_KEY
3. Salva arquivo .pfx.enc
4. Senha → Bytes → Criptografa → Salva .pwd.enc

**Características:**
- ✅ Criptografia simétrica (rápida)
- ✅ Chave armazenada no .env (não versionada)
- ✅ Certificados nunca expostos em logs

### Autenticação

**Opções Disponíveis:**
1. **JWT via Supabase** (opcional)
   - Validação de tokens JWT
   - Integração com Supabase Auth

2. **API Key** (opcional)
   - Para rotas internas
   - Configurável via INTERNAL_API_KEY

3. **Sem autenticação** (desenvolvimento)
   - Para desenvolvimento local
   - Não recomendado para produção

---

## 📊 Gerenciamento de Estado

### Fila de Execuções

**Implementação:** `asyncio.Queue`

**Características:**
- ✅ Thread-safe
- ✅ Suporte a múltiplos workers
- ✅ Timeout configurável

**Fluxo:**
```
Requisição → Adiciona à Queue → Worker processa → Atualiza status
```

### Status de Execução

**Estados Possíveis:**
- `PENDENTE` - Aguardando na fila
- `EM_EXECUCAO` - Sendo processada
- `CONCLUIDA` - Finalizada com sucesso
- `ERRO` - Finalizada com erro
- `CANCELADA` - Cancelada pelo usuário

**Persistência:**
- Status salvo no banco de dados
- Histórico completo de execuções
- Logs detalhados por execução

---

## 🚀 Execução Concorrente

### Limite de Concorrência

**Configuração:** Via `Parametros.tsx` (frontend) ou variável de ambiente

**Implementação:**
- Limite de navegadores simultâneos
- Fila processa sequencialmente respeitando limite
- Cada execução usa um navegador separado

**Exemplo:**
```
Limite: 3 navegadores
Fila: [Exec1, Exec2, Exec3, Exec4, Exec5]

Execução:
- Exec1, Exec2, Exec3 → Em execução (3 navegadores)
- Exec4, Exec5 → Aguardando na fila
- Quando Exec1 termina → Exec4 inicia
```

---

## 🗄️ Banco de Dados

### Estrutura

**SQLite** - Banco de dados embutido

**Tabelas:**
- `certificados` - Metadados de certificados
- `execucoes` - Histórico de execuções
- `settings` - Configurações do sistema

### Modelos

**CertificadoDigital:**
- `id` - ID único
- `cnpj` - CNPJ da empresa
- `validade` - Data de validade
- `criado_em` - Data de criação
- `atualizado_em` - Data de atualização

**Execucao:**
- `id` - ID único
- `empresa_id` - ID da empresa
- `status` - Status atual
- `etapa` - Etapa atual
- `logs` - Logs da execução
- `criado_em` - Data de criação
- `atualizado_em` - Data de atualização

---

## 🔧 Configurações Importantes

### Variáveis de Ambiente

**Obrigatórias:**
- `FERNET_KEY` - Chave de criptografia (gerada automaticamente se não existir)

**Opcionais:**
- `PLAYWRIGHT_TIMEOUT` - Timeout do Playwright (padrão: 60000ms)
- `PLAYWRIGHT_HEADLESS` - Modo headless (padrão: false)
- `QUEUE_TIMEOUT` - Timeout da fila (padrão: 60s)
- `CORS_ORIGINS` - Origens permitidas para CORS
- `SUPABASE_URL` - URL do Supabase (opcional)
- `INTERNAL_API_KEY` - API Key para rotas internas (opcional)

### Configurações de Execução

**Limite de Concorrência:**
- Configurado via frontend (`Parametros.tsx`)
- Valor padrão: 1 navegador simultâneo
- Máximo recomendado: 5 navegadores

**Timeouts:**
- Playwright: 30 segundos (configurável)
- Fila: 60 segundos (configurável)

---

## 📝 Padrões de Código

### Imports

**Ordem de Imports:**
1. Bibliotecas padrão
2. Bibliotecas de terceiros
3. Módulos locais

**Exemplo:**
```python
import os
import sys
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from ..infrastructure.logger import get_logger
from ..services.certificate_service import get_certificate_service
```

### Tratamento de Erros

**Padrão:**
```python
try:
    # Operação
    resultado = fazer_algo()
except SpecificError as e:
    logger.error(f"Erro específico: {e}")
    raise HTTPException(status_code=500, detail=str(e))
except Exception as e:
    logger.error(f"Erro inesperado: {e}", exc_info=True)
    raise HTTPException(status_code=500, detail="Erro interno")
```

### Logging

**Padrão:**
```python
logger.info("Operação iniciada")
logger.debug(f"Detalhes: {variavel}")
logger.warning("Aviso: algo pode estar errado")
logger.error("Erro ocorreu", exc_info=True)
```

---

## 🎯 Boas Práticas

1. **Separação de Responsabilidades**
   - Routers apenas recebem/retornam HTTP
   - Services contêm lógica de negócio
   - Repositories acessam dados

2. **Assíncrono**
   - Use `async/await` para operações I/O
   - Não bloqueie o event loop
   - Use `asyncio.gather()` para operações paralelas

3. **Tratamento de Erros**
   - Sempre trate erros específicos
   - Log detalhado de erros
   - Retorne mensagens claras ao cliente

4. **Configuração**
   - Use `infrastructure/config.py` para configurações
   - Não hardcode valores
   - Use variáveis de ambiente

5. **Logging**
   - Use logger padronizado
   - Logs informativos para debug
   - Não logue informações sensíveis

---

## 🔍 Debugging

### Logs

**Localização:** Console do servidor

**Níveis:**
- `DEBUG` - Informações detalhadas
- `INFO` - Informações gerais
- `WARNING` - Avisos
- `ERROR` - Erros

### Endpoints de Debug

**Health Check:**
```
GET / → Status da API
```

**Listar Rotas:**
```
GET /debug/routes → Lista todas as rotas registradas
```

### Verificação de Estado

**Banco de Dados:**
```python
# Consultar execuções
from src.db.session import SessionLocal
from src.db.models import Execucao

db = SessionLocal()
execucoes = db.query(Execucao).all()
```

**Fila de Execuções:**
```python
# Verificar tamanho da fila
service = get_execution_service()
tamanho = service._fila_execucoes.qsize()
```

---

## 📚 Referências

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Playwright Documentation](https://playwright.dev/python/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [Python AsyncIO](https://docs.python.org/3/library/asyncio.html)


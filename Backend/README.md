# Backend AutoNacional - Documentação Completa

## 📋 Visão Geral

O Backend AutoNacional é uma API REST desenvolvida em Python com FastAPI para automação do portal NFSe Nacional. O sistema utiliza Playwright para automação de navegador e certificados digitais A1 (ICP-Brasil) para autenticação segura.

### Principais Funcionalidades

- ✅ **Gerenciamento de Certificados Digitais**: Upload, armazenamento seguro e criptografia de certificados A1 (.pfx/.p12)
- ✅ **Automação NFSe**: Automação completa do portal NFSe Nacional via Playwright
- ✅ **Processamento de Notas**: Download automático de XML e PDF (DANFS-e) de notas fiscais
- ✅ **Fila de Execução**: Sistema de fila para gerenciar múltiplas execuções simultâneas
- ✅ **API REST**: Endpoints completos para integração com frontend
- ✅ **Persistência de Dados**: Banco de dados SQLite para metadados e histórico de execuções

---

## 🏗️ Arquitetura do Sistema

### Estrutura de Diretórios

```
Backend/
├── main.py                          # Ponto de entrada principal da aplicação FastAPI
├── run_server.py                     # Script para iniciar servidor (configura event loop no Windows)
├── asyncio_windows_fix.py           # Fix para asyncio no Windows
├── requirements.txt                 # Dependências Python
├── settings.json                    # Configurações gerais
├── certificados_meta.json           # Metadados de certificados
│
├── src/                             # Código fonte principal
│   ├── infrastructure/              # Componentes técnicos
│   │   ├── config.py                # Configurações centralizadas
│   │   └── logger.py                # Sistema de logging
│   │
│   ├── models/                      # Modelos de dados e schemas
│   │   ├── certificado.py          # Modelos de certificado
│   │   └── execucao.py             # Modelos de execução
│   │
│   ├── services/                    # Lógica de negócio
│   │   ├── certificate_service.py  # Service de certificados
│   │   └── execution_service.py    # Service de execução (orquestração)
│   │
│   ├── routers/                     # Rotas HTTP (endpoints)
│   │   ├── certificado.py         # Endpoints de certificado
│   │   ├── execucao.py            # Endpoints de execução
│   │   ├── nfse.py                # Endpoints NFSe
│   │   ├── empresas.py            # Endpoints de empresas
│   │   ├── credenciais.py         # Endpoints de credenciais
│   │   ├── relatorios.py          # Endpoints de relatórios
│   │   └── settings.py             # Endpoints de configurações
│   │
│   ├── repositories/               # Acesso a dados
│   │   ├── empresas_repo.py       # Repositório de empresas
│   │   └── credenciais_repo.py    # Repositório de credenciais
│   │
│   ├── utils/                      # Funções auxiliares
│   │   └── certificado_utils.py   # Utilitários de certificado
│   │
│   ├── core/                       # Configurações core
│   │   ├── db.py                   # Conexão com banco de dados
│   │   ├── db_mock.py              # Banco mock SQLite (dados de teste)
│   │   └── security.py             # Segurança e autenticação
│   │
│   └── db/                         # Camada de persistência SQLAlchemy
│       ├── session.py              # Configuração do banco e sessões
│       ├── models.py               # Modelos ORM
│       ├── crud_certificado.py     # Funções CRUD para certificados
│       └── crud_settings.py        # Funções CRUD para configurações
│
├── scripts/                        # Scripts auxiliares
│   ├── automation/                 # Scripts de automação
│   │   ├── playwright_nfse.py     # Automação Playwright NFSe (login)
│   │   ├── processar_notas_competencia.py  # Processamento assíncrono de notas
│   │   ├── processar_notas_competencia_sync.py  # Processamento síncrono (backup)
│   │   ├── emitidas_automation.py  # Automação de notas emitidas
│   │   ├── salvamento.py          # Salvamento automático
│   │   ├── executar_login_nfse.py # Script de login standalone
│   │   ├── download_manager.py    # Gerenciador de downloads
│   │   └── verificar_downloads.py # Verificação de downloads
│   │
│   └── init/                       # Scripts de inicialização
│       ├── iniciar_backend.sh      # Iniciar backend (Linux/Mac)
│       ├── iniciar_backend.bat     # Iniciar backend (Windows)
│       ├── executar_login.sh       # Executar login (Linux/Mac)
│       ├── executar_login.bat      # Executar login (Windows)
│       └── desativar_backend.sh    # Desativar ambiente virtual
│
├── docs/                           # Documentação
│   ├── README.md                   # Documentação principal
│   ├── REFATORACAO.md              # Documentação da refatoração
│   ├── REFATORACAO_ASYNC_PLAYWRIGHT.md  # Refatoração async
│   ├── REVISAO_ARQUITETURA.md     # Revisão de arquitetura
│   ├── ROTAS_NECESSARIAS.md        # Documentação de rotas
│   └── TESTAR_ROTAS.md             # Guia de testes
│
├── db/                             # Banco de dados SQLite
│   └── certificados.db            # Banco SQLite (gerado automaticamente)
│
├── certificados_armazenados/       # Certificados criptografados
│   └── [arquivos .pfx.enc e .pwd.enc]
│
└── db_mock.sqlite                  # Banco mock SQLite (dados de teste)
```

---

## 🔧 Componentes Principais

### 1. **Infrastructure** (`src/infrastructure/`)

#### `config.py`
Centraliza todas as configurações da aplicação:
- Caminhos de arquivos e diretórios
- Configurações de certificado (FERNET_KEY)
- Configurações de banco de dados
- Configurações de segurança (Supabase)
- Configurações CORS
- Configurações de execução (timeouts, headless)

#### `logger.py`
Sistema de logging padronizado para toda a aplicação.

### 2. **Services** (`src/services/`)

#### `certificate_service.py`
Service responsável pelo gerenciamento de certificados digitais:
- Validação de certificados A1
- Extração de informações (CNPJ, validade, etc.)
- Armazenamento seguro com criptografia Fernet
- Recuperação de certificados para uso na automação

#### `execution_service.py`
Service de orquestração de execuções:
- Gerencia fila de execuções
- Coordena scripts de automação na ordem correta
- Controla execução concorrente (limite de navegadores simultâneos)
- Registra status e logs de execução
- Persiste histórico no banco de dados

**Fluxo de Execução:**
1. Recebe requisição de execução
2. Adiciona à fila de execuções
3. Processa fila sequencialmente (respeitando limite de concorrência)
4. Para cada execução:
   - Carrega certificado e credenciais
   - Executa `playwright_nfse.py` (autenticação)
   - Executa `processar_notas_competencia.py` (processamento)
   - Executa `salvamento.py` (salvamento automático)
5. Atualiza status e retorna resultado

### 3. **Routers** (`src/routers/`)

#### `certificado.py`
Endpoints para gerenciamento de certificados:
- `POST /api/certificados` - Upload de certificado
- `POST /api/certificados/importar` - Importar certificado
- `GET /api/certificados` - Listar certificados
- `GET /api/certificados/{cnpj}` - Obter certificado específico
- `DELETE /api/certificados/{cnpj}` - Remover certificado

#### `execucao.py`
Endpoints para execução de automações:
- `POST /api/execucao/{empresa_id}` - Iniciar execução única
- `POST /api/execucao/multiplas` - Iniciar múltiplas execuções
- `GET /api/execucao/{empresa_id}/status` - Obter status de execução
- `GET /api/execucao/{empresa_id}/historico` - Obter histórico

#### `nfse.py`
Endpoints para automação NFSe:
- `POST /api/nfse/{cnpj}/abrir` - Abrir dashboard NFSe

#### `empresas.py`
Endpoints para gerenciamento de empresas:
- `GET /api/empresas` - Listar empresas
- `POST /api/empresas` - Criar empresa
- `PUT /api/empresas/{id}` - Atualizar empresa
- `DELETE /api/empresas/{id}` - Remover empresa

#### `credenciais.py`
Endpoints para gerenciamento de credenciais:
- `GET /api/credenciais/{empresa_id}` - Obter credenciais
- `POST /api/credenciais` - Criar/atualizar credenciais
- `DELETE /api/credenciais/{empresa_id}` - Remover credenciais

#### `relatorios.py`
Endpoints para geração de relatórios:
- `POST /api/relatorios/gerar` - Gerar relatório PDF

#### `settings.py`
Endpoints para configurações:
- `GET /api/settings` - Obter configurações
- `PUT /api/settings` - Atualizar configurações

### 4. **Scripts de Automação** (`scripts/automation/`)

#### `playwright_nfse.py`
Script principal de automação do portal NFSe:
- Autenticação via certificado A1
- Navegação no portal usando Playwright Async API
- Suporte a múltiplas execuções simultâneas
- Configuração automática de certificado cliente

**Características:**
- Usa `async_playwright` para integração com FastAPI
- Autenticação automática sem popups
- Suporte a modo headless e visível
- Timeout configurável

#### `processar_notas_competencia.py`
Script para processamento de notas fiscais:
- Varredura de notas emitidas e recebidas
- Download de XML e PDF (DANFS-e)
- Validação de downloads
- Geração de relatórios

**Características:**
- Processamento assíncrono
- Gerenciamento de downloads
- Validação de arquivos baixados
- Tratamento de erros robusto

#### `salvamento.py`
Script para salvamento automático:
- Integração com sistema de salvamento
- Processamento de arquivos baixados

#### `executar_login_nfse.py`
Script standalone para executar login:
- Útil para testes e debug
- Pode ser executado independentemente

### 5. **Database** (`src/db/`)

#### `session.py`
Configuração do SQLAlchemy:
- Engine e sessões do banco de dados
- Inicialização do banco (criação de tabelas)

#### `models.py`
Modelos ORM:
- `CertificadoDigital` - Metadados de certificados
- `Execucao` - Histórico de execuções
- `Settings` - Configurações do sistema

#### `crud_certificado.py` e `crud_settings.py`
Funções CRUD para operações no banco de dados.

---

## 🔄 Fluxo de Execução Completo

### 1. Inicialização do Sistema

```
main.py → Configura FastAPI → Registra Routers → Inicializa Banco de Dados
```

### 2. Upload de Certificado

```
Cliente → POST /api/certificados
  → Router certificado.py
  → CertificateService
  → Valida certificado
  → Criptografa e salva em certificados_armazenados/
  → Salva metadados no banco de dados
  → Retorna resposta
```

### 3. Execução de Automação

```
Cliente → POST /api/execucao/{empresa_id}
  → Router execucao.py
  → ExecutionService.adicionar_execucao()
  → Adiciona à fila de execuções
  → Worker processa fila:
    1. ExecutionService._executar_fluxo_completo()
    2. Carrega certificado via CertificateService
    3. Executa playwright_nfse.py (autenticação)
    4. Executa processar_notas_competencia.py (processamento)
    5. Executa salvamento.py (salvamento)
    6. Atualiza status no banco
  → Retorna status de execução
```

### 4. Consulta de Status

```
Cliente → GET /api/execucao/{empresa_id}/status
  → Router execucao.py
  → ExecutionService.obter_status()
  → Consulta banco de dados
  → Retorna status atual
```

---

## 🚀 Instalação e Configuração

### Pré-requisitos

- **Python 3.10+** (recomendado 3.12+)
- **pip** (geralmente vem com Python)
- **Git** (para clonar o repositório)

### Instalação

#### Linux / macOS

```bash
# Navegue até a pasta Backend
cd Backend

# Crie e ative o ambiente virtual
python3 -m venv .venv
source .venv/bin/activate

# Instale as dependências
pip install -r requirements.txt

# Instale o navegador Chromium do Playwright
playwright install chromium
```

#### Windows

```cmd
REM Navegue até a pasta Backend
cd Backend

REM Crie e ative o ambiente virtual
python -m venv .venv
.venv\Scripts\activate

REM Instale as dependências
pip install -r requirements.txt

REM Instale o navegador Chromium do Playwright
playwright install chromium
```

### Configuração

#### Variáveis de Ambiente

Crie um arquivo `.env` na pasta `Backend`:

```bash
# Chave Fernet para criptografia de certificados
# Será gerada automaticamente se não existir
FERNET_KEY=sua_chave_fernet_aqui

# Configurações de execução (opcional)
PLAYWRIGHT_TIMEOUT=30000
PLAYWRIGHT_HEADLESS=false
QUEUE_TIMEOUT=60

# Configurações CORS (opcional)
CORS_ORIGINS=http://localhost:4200,http://127.0.0.1:4200

# Configurações de segurança (opcional)
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_JWKS_URL=https://seu-projeto.supabase.co/.well-known/jwks.json
INTERNAL_API_KEY=sua_api_key_aqui
```

**Nota:** Se você não criar o `.env`, o sistema gerará uma chave FERNET_KEY automaticamente na primeira execução.

### Iniciar o Servidor

#### Linux / macOS

```bash
# Usando o script de inicialização
./scripts/init/iniciar_backend.sh

# Ou diretamente
python run_server.py
```

#### Windows

```cmd
REM Usando o script de inicialização
scripts\init\iniciar_backend.bat

REM Ou diretamente
python run_server.py
```

O servidor estará disponível em `http://localhost:8000`

### Documentação da API

Acesse a documentação interativa:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

---

## 📚 Stack Tecnológica

### Backend Framework
- **FastAPI**: Framework web moderno e rápido para APIs REST
- **Uvicorn**: Servidor ASGI de alta performance

### Automação
- **Playwright**: Automação de navegador moderna e confiável
- **Async Playwright**: Suporte a execução assíncrona

### Banco de Dados
- **SQLAlchemy**: ORM para Python
- **SQLite**: Banco de dados leve e embutido

### Segurança
- **Cryptography**: Biblioteca de criptografia
- **Fernet**: Criptografia simétrica para certificados
- **Python-JOSE**: Processamento de tokens JWT

### Outras Bibliotecas
- **python-dotenv**: Gerenciamento de variáveis de ambiente
- **Pydantic**: Validação de dados
- **httpx**: Cliente HTTP assíncrono

---

## 🔐 Segurança

### Certificados Digitais

- Certificados são armazenados com criptografia Fernet
- Senhas são criptografadas separadamente
- Chave de criptografia armazenada no `.env` (não versionada)
- Certificados nunca são expostos em logs ou respostas da API

### Autenticação

- Suporte a autenticação JWT via Supabase (opcional)
- API Key para rotas internas (opcional)
- CORS configurável para restringir origens

---

## 🐛 Troubleshooting

### Problema: Erro ao executar Playwright no Windows

**Solução:** Use o script `run_server.py` que configura o event loop corretamente:

```cmd
python run_server.py
```

### Problema: Certificado não encontrado

**Solução:** Verifique se o certificado foi importado corretamente:

```bash
# Verificar certificados armazenados
ls certificados_armazenados/
```

### Problema: Erro de importação de módulos

**Solução:** Certifique-se de que está executando a partir da raiz do Backend:

```bash
cd Backend
python run_server.py
```

---

## 📝 Notas Importantes

1. **Windows**: Sempre use `run_server.py` para iniciar o servidor, pois configura o event loop corretamente
2. **Certificados**: A chave FERNET_KEY é crítica - não a perca ou você não conseguirá descriptografar os certificados
3. **Concorrência**: O sistema limita o número de navegadores simultâneos para evitar sobrecarga
4. **Logs**: Todos os logs são salvos e podem ser consultados para debug

---

## 📖 Documentação Adicional

- [REFATORACAO.md](docs/REFATORACAO.md) - Detalhes da refatoração do código
- [ROTAS_NECESSARIAS.md](docs/ROTAS_NECESSARIAS.md) - Documentação completa das rotas
- [REVISAO_ARQUITETURA.md](docs/REVISAO_ARQUITETURA.md) - Revisão da arquitetura

---

## 🤝 Contribuindo

Para contribuir com o projeto:

1. Faça um fork do repositório
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

---

## 📄 Licença

Este projeto é proprietário e confidencial.

---

## 📧 Contato

Para dúvidas ou suporte, entre em contato com a equipe de desenvolvimento.


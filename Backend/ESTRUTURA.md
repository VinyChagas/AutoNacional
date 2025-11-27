# Estrutura do Backend

## 📁 Organização de Pastas

```
Backend/
├── main.py                          # Ponto de entrada da aplicação FastAPI
├── requirements.txt                 # Dependências Python
├── cert_storage.py                 # ⚠️ DEPRECATED - Use CertificateService
├── db_mock.sqlite                  # Banco de dados SQLite mock
│
├── src/                            # Código fonte principal
│   ├── main.py                     # Alternativa de entrada (usa config centralizada)
│   │
│   ├── infrastructure/             # Componentes técnicos
│   │   ├── config.py               # Configurações centralizadas
│   │   └── logger.py               # Sistema de logging
│   │
│   ├── models/                     # Modelos de dados
│   │   ├── execucao.py            # Modelos de execução
│   │   └── certificado.py         # Modelos de certificado
│   │
│   ├── services/                   # Lógica de negócio
│   │   ├── certificate_service.py  # Service de certificados
│   │   └── execution_service.py   # Service de execução (orquestração)
│   │
│   ├── utils/                      # Funções auxiliares
│   │   └── certificado_utils.py   # Utilitários de certificado
│   │
│   ├── routers/                    # Rotas HTTP (endpoints)
│   │   ├── certificado.py         # Endpoints de certificado
│   │   ├── execucao.py            # Endpoints de execução
│   │   ├── nfse.py                # Endpoints NFSe
│   │   ├── empresas.py            # Endpoints de empresas
│   │   └── credenciais.py         # Endpoints de credenciais
│   │
│   ├── repositories/               # Acesso a dados
│   │   ├── empresas_repo.py       # Repositório de empresas
│   │   └── credenciais_repo.py    # Repositório de credenciais
│   │
│   └── core/                       # Configurações core
│       ├── db.py                   # Conexão com banco de dados
│       ├── db_mock.py              # Banco mock SQLite
│       ├── env.py                  # ⚠️ DEPRECATED - Use infrastructure/config.py
│       └── security.py             # Segurança e autenticação
│
├── scripts/                        # Scripts auxiliares
│   ├── automation/                 # Scripts de automação
│   │   ├── playwright_nfse.py     # Automação Playwright NFSe
│   │   ├── emitidas_automation.py  # Automação de notas emitidas
│   │   ├── salvamento.py          # Salvamento automático
│   │   └── executar_login_nfse.py # Script de login standalone
│   │
│   └── init/                       # Scripts de inicialização
│       ├── iniciar_backend.sh      # Iniciar backend (Linux/Mac)
│       ├── iniciar_backend.bat     # Iniciar backend (Windows)
│       ├── executar_login.sh       # Executar login (Linux/Mac)
│       ├── executar_login.bat      # Executar login (Windows)
│       └── desativar_backend.sh    # Desativar ambiente virtual
│
├── tests/                          # Testes
│   ├── testar_execucao.py         # Teste de execução
│   ├── testar_todas_rotas.py      # Teste de todas as rotas
│   ├── testar_todas_rotas.sh      # Script de teste (Linux/Mac)
│   ├── testar_todas_rotas.bat     # Script de teste (Windows)
│   ├── testar_importacao.sh        # Teste de importação (Linux/Mac)
│   └── testar_importacao.bat       # Teste de importação (Windows)
│
├── docs/                           # Documentação
│   ├── README.md                   # Documentação principal
│   ├── REFATORACAO.md             # Documentação da refatoração
│   ├── ROTAS_NECESSARIAS.md       # Documentação de rotas
│   └── TESTAR_ROTAS.md            # Guia de testes
│
└── certificados_armazenados/       # Certificados criptografados
    └── [arquivos .pfx.enc e .pwd.enc]
```

## 🚀 Como Usar

### Iniciar o Backend

**Linux/Mac:**
```bash
./scripts/init/iniciar_backend.sh
```

**Windows:**
```cmd
scripts\init\iniciar_backend.bat
```

### Executar Login com Certificado

**Linux/Mac:**
```bash
./scripts/init/executar_login.sh [CNPJ]
```

**Windows:**
```cmd
scripts\init\executar_login.bat [CNPJ]
```

### Executar Testes

**Linux/Mac:**
```bash
cd tests
./testar_todas_rotas.sh
```

**Windows:**
```cmd
cd tests
testar_todas_rotas.bat
```

## 📝 Notas Importantes

- **cert_storage.py**: Arquivo deprecated. Use `CertificateService` em `src/services/certificate_service.py`
- **core/env.py**: Arquivo deprecated. Use `infrastructure/config.py`
- **orquestrador_execucao.py**: Arquivo deprecated. Use `ExecutionService` em `src/services/execution_service.py`

## 🔄 Migração

Se você estava usando os arquivos antigos, atualize seus imports:

**Antes:**
```python
from cert_storage import carregar_certificado
from orquestrador_execucao import obter_orquestrador
```

**Depois:**
```python
from services.certificate_service import get_certificate_service
from services.execution_service import get_execution_service

certificate_service = get_certificate_service()
certificate_service.carregar_certificado(cnpj)
```


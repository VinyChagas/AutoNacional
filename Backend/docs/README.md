# Backend AutoNacional

Backend em Python com FastAPI para automação do portal NFSe Nacional usando Playwright e certificados digitais A1.

## 📋 Sobre o Projeto

Este backend fornece:
- **API REST** para upload e gerenciamento de certificados digitais A1 (.pfx/.p12)
- **Automação com Playwright** para login automático no portal NFSe Nacional
- **Armazenamento seguro** de certificados com criptografia Fernet
- **Autenticação via certificado cliente** sem popups de seleção

## 🚀 Instalação Rápida

### 1. Pré-requisitos

- **Python 3.10+** (recomendado 3.14+)
- **pip** (geralmente vem com Python)

### 2. Instalação

#### 🐧 Linux / 🍎 macOS

```bash
# Clone ou navegue até a pasta Backend
cd Backend

# Crie e ative o ambiente virtual
python3 -m venv .venv
source .venv/bin/activate

# Instale as dependências
pip install -r requirements.txt

# Instale o navegador Chromium do Playwright
playwright install chromium
```

#### 🪟 Windows

```cmd
REM Clone ou navegue até a pasta Backend
cd Backend

REM Crie e ative o ambiente virtual
python -m venv .venv
.venv\Scripts\activate

REM Instale as dependências
pip install -r requirements.txt

REM Instale o navegador Chromium do Playwright
playwright install chromium
```

**Pronto!** 🎉

## 📦 Estrutura do Projeto

```
Backend/
├── main.py                    # API FastAPI principal (upload de certificados)
├── cert_storage.py            # Módulo de armazenamento seguro de certificados
├── requirements.txt           # Dependências Python
├── .env                       # Variáveis de ambiente (FERNET_KEY)
├── certificados_armazenados/  # Certificados criptografados (gerado automaticamente)
├── src/
│   ├── main.py               # API FastAPI alternativa (routers modulares)
│   ├── playwright_nfse.py     # Automação NFSe com Playwright
│   ├── executar_login_nfse.py # Script CLI para executar login
│   ├── routers/
│   │   ├── nfse.py          # Endpoints de automação NFSe
│   │   ├── empresas.py      # Endpoints de empresas
│   │   └── credenciais.py   # Endpoints de credenciais
│   ├── core/                 # Configurações core (db, security, env)
│   └── repositories/         # Camada de acesso a dados
├── executar_login.sh         # Script bash para executar login (Linux/macOS)
├── executar_login.bat        # Script batch para executar login (Windows)
├── iniciar_backend.sh        # Script bash para iniciar API (Linux/macOS)
└── iniciar_backend.bat       # Script batch para iniciar API (Windows)
```

## 🔐 Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na pasta `Backend`:

```bash
# Chave Fernet para criptografia de certificados
# Será gerada automaticamente se não existir
FERNET_KEY=sua_chave_fernet_aqui

# CNPJ padrão (opcional)
CNPJ_PADRAO=00000000000011
```

**Nota:** Se você não criar o `.env`, o sistema gerará uma chave automaticamente na primeira execução.

## 🎯 Como Usar

### 1. Executar Automação NFSe (Login Automático)

#### 🐧 Linux / 🍎 macOS

**Forma mais fácil (recomendada):**

```bash
./executar_login.sh 00000000000011
```

**Ou diretamente com Python:**

```bash
source .venv/bin/activate
python3 src/executar_login_nfse.py 00000000000011
```

#### 🪟 Windows

**Forma mais fácil (recomendada):**

```cmd
executar_login.bat 00000000000011
```

**Ou diretamente com Python:**

```cmd
.venv\Scripts\activate
python src\executar_login_nfse.py 00000000000011
```

**Opções:**
- `--headless`: Executa sem abrir navegador (modo invisível)
- `--no-headless` ou `--visible`: Executa com navegador visível (padrão)

**Exemplos:**

**Linux/macOS:**
```bash
# Com navegador visível (padrão)
python3 src/executar_login_nfse.py 00000000000011

# Sem navegador (headless)
python3 src/executar_login_nfse.py 00000000000011 --headless
```

**Windows:**
```cmd
REM Com navegador visível (padrão)
python src\executar_login_nfse.py 00000000000011

REM Sem navegador (headless)
python src\executar_login_nfse.py 00000000000011 --headless
```

### 2. Iniciar API REST

#### 🐧 Linux / 🍎 macOS

```bash
./iniciar_backend.sh
```

Ou manualmente:

```bash
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

#### 🪟 Windows

```cmd
iniciar_backend.bat
```

Ou manualmente:

```cmd
.venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

A API estará disponível em:
- **API**: http://localhost:8000
- **Documentação Swagger**: http://localhost:8000/docs
- **Documentação ReDoc**: http://localhost:8000/redoc

### 3. Endpoints Principais

#### Upload de Certificado
```bash
POST /api/certificados
Content-Type: multipart/form-data

cnpj: 00000000000011
senha: senha_do_certificado
certificado: arquivo.pfx
```

#### Automação NFSe
```bash
POST /api/nfse/{cnpj}/abrir?headless=false
```

## 🔧 Funcionalidades

### ✅ Upload e Armazenamento de Certificados

- Upload de certificados A1 (.pfx/.p12)
- Validação automática do certificado e senha
- Armazenamento criptografado usando Fernet
- Um certificado por CNPJ

### ✅ Automação NFSe com Playwright

- Login automático no portal NFSe Nacional
- Autenticação via certificado cliente (sem popups)
- Navegador Chromium controlado programaticamente
- Suporte a modo headless e visível

### ✅ API REST Completa

- Endpoints para gerenciamento de certificados
- Endpoints para automação NFSe
- Documentação automática (Swagger/ReDoc)
- CORS configurado para frontend Angular

## 🛠️ Tecnologias

- **FastAPI** - Framework web moderno e rápido
- **Playwright** - Automação de navegador
- **Cryptography** - Criptografia e validação de certificados
- **Python-dotenv** - Gerenciamento de variáveis de ambiente
- **Uvicorn** - Servidor ASGI de alta performance

## 🪟 Guia Rápido Windows

### Comandos Principais no Windows

```cmd
REM 1. Ativar ambiente virtual
.venv\Scripts\activate

REM 2. Executar automação (com navegador visível)
python src\executar_login_nfse.py 00000000000011

REM 3. Executar automação (sem navegador)
python src\executar_login_nfse.py 00000000000011 --headless

REM 4. Iniciar API
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Diferenças principais:**
- Use `python` em vez de `python3`
- Use `\` em vez de `/` nos caminhos
- Use `.bat` em vez de `.sh` para scripts
- Ative o venv com `.venv\Scripts\activate`

## 📝 Exemplos de Uso

### Exemplo 1: Upload de Certificado via API

```bash
curl -X POST "http://localhost:8000/api/certificados" \
  -F "cnpj=00000000000011" \
  -F "senha=minha_senha" \
  -F "certificado=@/caminho/para/certificado.pfx"
```

### Exemplo 2: Executar Login via API

```bash
curl -X POST "http://localhost:8000/api/nfse/00000000000011/abrir?headless=false"
```

### Exemplo 3: Usar em Python

```python
from src.playwright_nfse import abrir_dashboard_nfse

resultado = abrir_dashboard_nfse(
    cnpj="00000000000011",
    headless=False  # Navegador visível
)

print(f"Sucesso: {resultado['sucesso']}")
print(f"URL: {resultado['url_atual']}")
```

## ⚠️ Troubleshooting

### Erro: "Certificado não encontrado"
- Certifique-se de que o certificado foi enviado via API primeiro
- Verifique se o CNPJ está correto (14 dígitos, sem formatação)

### Erro: "Playwright não encontrado"
```bash
pip install playwright>=1.46.0
playwright install chromium
```

### Erro: "FERNET_KEY não definida"
- Crie o arquivo `.env` com `FERNET_KEY=sua_chave`
- Ou deixe o sistema gerar automaticamente

### Erro: "Chromium não instalado"
```bash
playwright install chromium
```

## 📚 Documentação Adicional

- [Documentação FastAPI](https://fastapi.tiangolo.com/)
- [Documentação Playwright](https://playwright.dev/python/)
- [Swagger UI](http://localhost:8000/docs) (quando API estiver rodando)

## 🔒 Segurança

- Certificados são armazenados criptografados (Fernet)
- Senhas nunca são expostas em logs ou respostas da API
- Chave de criptografia armazenada em `.env` (não versionada)
- Validação rigorosa de certificados antes do armazenamento

## 📄 Licença

Uso interno - VinyChagas


# AutoNacional

Projeto com Frontend em Angular + Tailwind e Backend em Python + Selenium.

---

## 📋 Pré-requisitos

### Todos os sistemas operacionais

- **Python 3.14+** (ou 3.10+)
- **Node.js 20.9.0+** e npm 8.0.0+
- **Git**

---

## 🚀 Instalação

### 1️⃣ Clonar o repositório

```bash
git clone <URL_DO_REPOSITORIO>
cd AutoNacional
```

---

## 🖥️ Configuração por Sistema Operacional

<details>
<summary><strong>🐧 Linux (Ubuntu/Debian)</strong></summary>

### Backend (Python + Selenium)

```bash
# Instalar Python 3 e pip (se não estiver instalado)
sudo apt update
sudo apt install python3 python3-pip python3-venv -y

# Criar ambiente virtual
cd Backend
python3 -m venv .venv
source .venv/bin/activate

# Instalar dependências
pip install --upgrade pip
pip install -r requirements.txt

# Validar instalação
python -c "import selenium; print('Selenium:', selenium.__version__)"
```

### Frontend (Angular + Tailwind)

```bash
# Instalar Node.js 20+ via nvm (recomendado)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20.19.0
nvm use 20.19.0

# Instalar dependências do Angular
cd ../Frontend
npm install

# Rodar servidor de desenvolvimento (porta 1234)
npm start
```

Acesse: **http://localhost:1234**

</details>

<details>
<summary><strong>🪟 Windows</strong></summary>

### Backend (Python + Selenium)

```powershell
# Baixe e instale Python 3.14 em https://www.python.org/downloads/
# Marque "Add Python to PATH" durante a instalação

# Abra PowerShell ou CMD e navegue até a pasta do projeto
cd AutoNacional\Backend

# Criar ambiente virtual
python -m venv .venv

# Ativar ambiente virtual
.venv\Scripts\activate

# Instalar dependências
pip install --upgrade pip
pip install -r requirements.txt

# Validar instalação
python -c "import selenium; print('Selenium:', selenium.__version__)"
```

### Frontend (Angular + Tailwind)

```powershell
# Instalar Node.js 20+ via nvm-windows ou diretamente:
# https://nodejs.org/en/download/

# Instalar dependências do Angular
cd ..\Frontend
npm install

# Rodar servidor de desenvolvimento (porta 1234)
npm start
```

Acesse: **http://localhost:1234**

</details>

<details>
<summary><strong>🍎 macOS</strong></summary>

### Backend (Python + Selenium)

```bash
# Instalar Python 3.14 (via Homebrew ou Python.org)
# Homebrew:
brew install python@3.14

# Ou baixe diretamente: https://www.python.org/downloads/macos/

# Criar ambiente virtual
cd Backend
python3 -m venv .venv
source .venv/bin/activate

# Instalar dependências
pip install --upgrade pip
pip install -r requirements.txt

# Validar instalação
python -c "import selenium; print('Selenium:', selenium.__version__)"
```

### Frontend (Angular + Tailwind)

```bash
# Instalar Node.js 20+ via nvm (recomendado)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install 20.19.0
nvm use 20.19.0

# Instalar dependências do Angular
cd ../Frontend
npm install

# Rodar servidor de desenvolvimento (porta 1234)
npm start
```

Acesse: **http://localhost:1234**

</details>

---

## 🏃 Executando o Projeto

### Backend

```bash
cd Backend
source .venv/bin/activate   # Linux/macOS
# ou
.venv\Scripts\activate      # Windows

python seu_script.py
```

### Frontend

```bash
cd Frontend
npm start
```

Servidor rodando em: **http://localhost:1234**

---

## 📦 Estrutura do Projeto

```
AutoNacional/
├── Backend/
│   ├── .venv/               # Ambiente virtual Python (não versionado)
│   └── requirements.txt     # Dependências Python
├── Frontend/
│   ├── src/                 # Código-fonte Angular
│   ├── node_modules/        # Dependências Node (não versionado)
│   ├── package.json
│   ├── tailwind.config.js   # Configuração Tailwind CSS
│   └── angular.json         # Configuração Angular
├── .gitignore
└── README.md
```

---

## 🛠️ Tecnologias Utilizadas

- **Frontend**: Angular 17, Tailwind CSS
- **Backend**: Python 3.14, Selenium 4.36
- **Ferramentas**: Node.js, npm, venv

---

## 📝 Notas

- O Frontend roda na **porta 1234** por padrão
- Certifique-se de ativar o ambiente virtual Python (`source .venv/bin/activate`) antes de rodar scripts do Backend
- Para atualizar dependências do Backend: `pip freeze > requirements.txt`
- Para atualizar dependências do Frontend: `npm update`

---

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

---

## 📄 Licença

Este projeto é de uso interno do VinyChagas.

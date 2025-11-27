@echo off
REM Script para testar todas as rotas da API de uma só vez (Windows)

cd /d "%~dp0"

REM Ativa o ambiente virtual se existir
if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
    echo ✅ Ambiente virtual ativado
)

REM Verifica se Python está disponível
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Erro: Python não encontrado
    exit /b 1
)

REM Verifica se requests está instalado
python -c "import requests" >nul 2>&1
if errorlevel 1 (
    echo ⚠️  Biblioteca 'requests' não encontrada
    echo    Instalando...
    pip install requests
)

REM Executa o script Python
echo 🧪 Executando testes de todas as rotas...
echo.

python testar_todas_rotas.py %*


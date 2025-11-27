@echo off
REM Script para executar o login com certificado digital usando Playwright (Windows)

REM Navega para o diretório raiz do backend (dois níveis acima deste script)
cd /d "%~dp0\..\.."

REM Ativa o ambiente virtual
if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
    echo ✅ Ambiente virtual ativado (.venv)
) else (
    echo ⚠️  Ambiente virtual não encontrado em .venv\Scripts\activate.bat
    echo    Criando ambiente virtual...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    echo ✅ Ambiente virtual criado e ativado
    echo 📦 Instalando dependências...
    pip install -r requirements.txt
    echo 🌐 Instalando navegador Chromium do Playwright...
    playwright install chromium
)

REM Verifica se o Playwright está instalado
python -c "import playwright" 2>nul
if errorlevel 1 (
    echo 📦 Instalando Playwright...
    pip install "playwright>=1.46.0"
    playwright install chromium
)

echo.
echo 🚀 Executando login com certificado digital (Playwright)...
echo.

REM Executa o script Python
REM Se um CNPJ foi passado como argumento, usa ele; caso contrário, tenta usar o definido no .env
if "%1"=="" (
    set DEFAULT_CNPJ=%CNPJ_PADRAO%
    if "%DEFAULT_CNPJ%"=="" set DEFAULT_CNPJ=%CNPJ_CERTIFICADO%
    if "%DEFAULT_CNPJ%"=="" set DEFAULT_CNPJ=00000000000011
    
    if "%DEFAULT_CNPJ%"=="" (
        echo ❌ Nenhum CNPJ informado.
        echo    • Informe via argumento: executar_login.bat 12345678000199
        echo    • Ou defina CNPJ_PADRAO no arquivo .env
        exit /b 1
    )
    
    echo ℹ️  Nenhum CNPJ passado como argumento. Usando CNPJ do .env: %DEFAULT_CNPJ%
) else (
    set DEFAULT_CNPJ=%1
    echo ℹ️  Usando CNPJ informado: %DEFAULT_CNPJ%
)

echo.
python scripts\automation\executar_login_nfse.py %DEFAULT_CNPJ%


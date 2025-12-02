@echo off
REM Script para iniciar o backend com a chave Fernet correta (Windows)
REM Este script usa run_server.py que configura o ProactorEventLoop para suportar Playwright
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM Navega para o diretório raiz do backend (dois níveis acima deste script)
cd /d "%~dp0\..\.."

REM Verifica se o ambiente virtual existe e usa o Python diretamente
if exist ".venv\Scripts\python.exe" (
    set "PYTHON_CMD=.venv\Scripts\python.exe"
    echo ✅ Ambiente virtual encontrado (.venv)
    goto :env_check
) else (
    echo ⚠️  Ambiente virtual não encontrado em .venv\Scripts\
    echo    Certifique-se de que o ambiente virtual está criado
    echo    Execute: python -m venv .venv
    exit /b 1
)

:env_check
REM Carrega todas as variáveis do .env se existir (igual ao script .sh)
REM Usa PowerShell para processar o arquivo .env corretamente
if exist ".env" (
    REM Usa PowerShell para ler o arquivo .env e carregar todas as variáveis
    REM Ignora linhas que começam com # (comentários) e linhas vazias
    for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Content '.env' | Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*$' -and $_ -match '=' } | ForEach-Object { $_.Trim() }"') do (
        set "line=%%i"
        REM Divide a linha no primeiro = para obter VAR=valor
        for /f "tokens=1,* delims==" %%a in ("!line!") do (
            set "var_name=%%a"
            set "var_value=%%b"
            REM Remove espaços do nome da variável
            for /f "tokens=* delims= " %%c in ("!var_name!") do set "var_name=%%c"
            REM Remove aspas se existirem no valor
            if defined var_value (
                set "var_value=!var_value:"=!"
                set "var_value=!var_value:'=!"
            )
            REM Define a variável de ambiente
            if defined var_value (
                set "!var_name!=!var_value!"
            ) else (
                set "!var_name!="
            )
        )
    )
    echo ✅ Variáveis do .env carregadas
) else (
    echo ⚠️  Arquivo .env não encontrado
    echo    Defina FERNET_KEY manualmente:
    echo    set "FERNET_KEY=sua_chave_aqui"
)

REM Verifica se FERNET_KEY está definida
if "!FERNET_KEY!"=="" (
    echo ❌ ERRO: FERNET_KEY não está definida!
    echo    Defina no arquivo .env ou exporte manualmente
    exit /b 1
)

echo 🚀 Iniciando servidor com run_server.py...
echo    O script run_server.py configura o ProactorEventLoop para suportar Playwright
set "chave_preview=!FERNET_KEY:~0,40!"
echo    Chave FERNET_KEY: !chave_preview!...
echo    Host: 0.0.0.0 (acessível de qualquer IP)
echo    Porta: 8000
echo    Reload: Desabilitado por padrão (use --reload para habilitar)
echo.

REM Inicia o servidor usando o script personalizado run_server.py
REM O script run_server.py configura o ProactorEventLoop ANTES do uvicorn iniciar
REM Isso é ESSENCIAL para o Playwright funcionar no Windows
REM Todas as variáveis de ambiente definidas serão herdadas pelo processo Python
"!PYTHON_CMD!" run_server.py --host 0.0.0.0 --port 8000

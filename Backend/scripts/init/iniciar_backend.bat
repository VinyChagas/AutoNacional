@echo off
REM Script para iniciar o backend com a chave Fernet correta (Windows)
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM Navega para o diretório raiz do backend (dois níveis acima deste script)
cd /d "%~dp0\..\.."

REM Verifica se o ambiente virtual existe e usa o Python diretamente
if exist ".venv\Scripts\python.exe" (
    set "PYTHON_CMD=.venv\Scripts\python.exe"
    echo [OK] Ambiente virtual encontrado (.venv)
    goto :env_check
) else (
    echo [ERRO] Ambiente virtual nao encontrado em .venv\Scripts\
    echo         Certifique-se de que o ambiente virtual esta criado
    echo         Execute: python -m venv .venv
    exit /b 1
)

:env_check
REM Carrega a chave do .env se existir usando PowerShell para lidar com BOM
if exist ".env" (
    REM Usa PowerShell para ler o arquivo .env e definir a variável (lida melhor com BOM)
    for /f "delims=" %%i in ('powershell -Command "$content = Get-Content '.env' -Raw; if ($content -match 'FERNET_KEY=(.+)') { $matches[1] }"') do (
        set "FERNET_KEY=%%i"
    )
    echo [OK] Chave FERNET_KEY carregada do .env
) else (
    echo [AVISO] Arquivo .env nao encontrado
    echo         Defina FERNET_KEY manualmente:
    echo         set "FERNET_KEY=sua_chave_aqui"
)

REM Verifica se FERNET_KEY está definida
if "!FERNET_KEY!"=="" (
    echo [ERRO] ERRO: FERNET_KEY nao esta definida!
    echo         Defina no arquivo .env ou exporte manualmente
    exit /b 1
)

echo [INFO] Iniciando uvicorn com FERNET_KEY configurada...
set "chave_preview=!FERNET_KEY:~0,40!"
echo    Chave: !chave_preview!...
echo    Host: 0.0.0.0 (acessivel de qualquer IP)
echo    Porta: 8000
echo.

REM Inicia o uvicorn usando Python do ambiente virtual
REM A variável FERNET_KEY será herdada pelo processo Python
"!PYTHON_CMD!" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

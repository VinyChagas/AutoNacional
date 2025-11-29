@echo off
REM Script para iniciar o backend com a chave Fernet correta (Windows)
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM Navega para o diretório raiz do backend (dois níveis acima deste script)
cd /d "%~dp0\..\.."

REM Ativa o ambiente virtual
if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
    echo [OK] Ambiente virtual ativado (.venv)
) else (
    echo [AVISO] Ambiente virtual nao encontrado em .venv\Scripts\activate.bat
    echo         Certifique-se de que o ambiente virtual esta criado
    exit /b 1
)

REM Carrega a chave do .env se existir
if exist .env (
    REM Carrega todas as variáveis do .env (ignorando linhas comentadas)
    for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
        set "%%a=%%b"
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
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
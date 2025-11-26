@echo off
REM Script para iniciar o backend com a chave Fernet correta (Windows)

cd /d "%~dp0"

REM Ativa o ambiente virtual
if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
    echo ✅ Ambiente virtual ativado (.venv)
) else (
    echo ⚠️  Ambiente virtual não encontrado em .venv\Scripts\activate.bat
    echo    Certifique-se de que o ambiente virtual está criado
    exit /b 1
)

REM Carrega variáveis do .env se existir
if exist .env (
    for /f "tokens=1* delims==" %%a in (.env) do (
        if not "%%a"=="" if not "%%a"=="#" (
            set "%%a=%%b"
        )
    )
    echo ✅ Chave FERNET_KEY carregada do .env
) else (
    echo ⚠️  Arquivo .env não encontrado
    echo    Defina FERNET_KEY manualmente:
    echo    set FERNET_KEY=sua_chave_aqui
)

REM Verifica se FERNET_KEY está definida
if "%FERNET_KEY%"=="" (
    echo ❌ ERRO: FERNET_KEY não está definida!
    echo    Defina no arquivo .env ou exporte manualmente
    exit /b 1
)

echo 🚀 Iniciando uvicorn com FERNET_KEY configurada...
echo    Chave: %FERNET_KEY:~0,40%...
echo    Host: 0.0.0.0 (acessível de qualquer IP)
echo    Porta: 8000
echo.

REM Inicia o uvicorn
uvicorn main:app --reload --host 0.0.0.0 --port 8000


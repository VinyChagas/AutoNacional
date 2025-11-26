@echo off
REM Script para iniciar o backend com a chave Fernet correta (Windows)
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM Verifica se o ambiente virtual existe
if not exist .venv\Scripts\python.exe (
    echo [AVISO] Ambiente virtual nao encontrado em .venv\Scripts\python.exe
    echo         Certifique-se de que o ambiente virtual esta criado
    echo         Execute: python -m venv .venv
    exit /b 1
)

REM Adiciona o ambiente virtual ao PATH
setlocal disabledelayedexpansion
set "PATH=%~dp0.venv\Scripts;%PATH%"
setlocal enabledelayedexpansion
echo [OK] Ambiente virtual configurado

REM Verifica se as dependências estão instaladas
python -c "import uvicorn" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Dependencias nao encontradas. Instalando do requirements.txt...
    if exist requirements.txt (
        python -m pip install -r requirements.txt
        if errorlevel 1 (
            echo [ERRO] Falha ao instalar dependencias do requirements.txt
            exit /b 1
        )
        echo [OK] Dependencias instaladas com sucesso
    ) else (
        echo [INFO] requirements.txt nao encontrado. Instalando uvicorn...
        python -m pip install uvicorn
        if errorlevel 1 (
            echo [ERRO] Falha ao instalar uvicorn
            exit /b 1
        )
        echo [OK] uvicorn instalado com sucesso
    )
)

REM Carrega a chave do .env se existir
if exist .env (
    echo [OK] Carregando FERNET_KEY do arquivo .env...
    for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
        if /i "%%a"=="FERNET_KEY" (
            set "FERNET_KEY=%%b"
        )
    )
    if not "!FERNET_KEY!"=="" (
        echo [OK] Chave FERNET_KEY carregada do .env
    )
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

echo.
echo [INFO] Iniciando uvicorn com FERNET_KEY configurada...
set "chave_preview=!FERNET_KEY:~0,40!"
echo        Chave: !chave_preview!...
echo        Host: 0.0.0.0 (acessivel de qualquer IP)
echo        Porta: 8000
echo.

REM Inicia o uvicorn usando o Python do ambiente virtual
REM A variável FERNET_KEY será herdada pelo processo Python
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
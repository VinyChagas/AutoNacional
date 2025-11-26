@echo off
REM Script para testar a rota de importação de certificado (Windows)

echo 🧪 Testando rota de importação de certificado...
echo.

REM Verifica se o arquivo foi passado como argumento
if "%~1"=="" (
    echo ❌ Erro: Forneça o caminho do arquivo .pfx ou .p12
    echo    Uso: testar_importacao.bat C:\caminho\para\certificado.pfx [senha]
    exit /b 1
)

set CERTIFICADO=%~1
set SENHA=%~2

REM Verifica se o arquivo existe
if not exist "%CERTIFICADO%" (
    echo ❌ Erro: Arquivo não encontrado: %CERTIFICADO%
    exit /b 1
)

REM Verifica se a senha foi fornecida
if "%SENHA%"=="" (
    echo ⚠️  Senha não fornecida. Será solicitada interativamente.
    set /p SENHA="Digite a senha do certificado: "
)

echo 📤 Enviando requisição para: http://localhost:8000/api/certificados/importar
echo    Arquivo: %CERTIFICADO%
echo.

REM Faz a requisição
curl -X POST "http://localhost:8000/api/certificados/importar" ^
  -F "certificado=@%CERTIFICADO%" ^
  -F "senha=%SENHA%"

echo.
echo.
echo ✅ Teste concluído!


#!/bin/bash
# Script para executar o login com certificado digital usando Playwright

# Navega para o diretório raiz do backend (dois níveis acima deste script)
cd "$(dirname "$0")/../.."

# Ativa o ambiente virtual
if [ -f .venv/bin/activate ]; then
    source .venv/bin/activate
    echo "✅ Ambiente virtual ativado (.venv)"
else
    echo "⚠️  Ambiente virtual não encontrado em .venv/bin/activate"
    echo "   Criando ambiente virtual..."
    python3 -m venv .venv
    source .venv/bin/activate
    echo "✅ Ambiente virtual criado e ativado"
    echo "📦 Instalando dependências..."
    pip install -r requirements.txt
    echo "🌐 Instalando navegador Chromium do Playwright..."
    playwright install chromium
fi

# Carrega a chave do .env se existir
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
    echo "✅ Chave FERNET_KEY carregada do .env"
else
    echo "⚠️  Arquivo .env não encontrado"
    echo "   O script tentará gerar uma chave automaticamente se necessário"
fi

# Verifica se o Playwright está instalado
if ! python3 -c "import playwright" 2>/dev/null; then
    echo "📦 Instalando Playwright..."
    pip install "playwright>=1.46.0"
    playwright install chromium
fi

echo ""
echo "🚀 Executando login com certificado digital (Playwright)..."
echo ""

# Executa o script Python
# Se um CNPJ foi passado como argumento, usa ele; caso contrário, tenta usar o definido no .env
DEFAULT_CNPJ="${1:-${CNPJ_PADRAO:-${CNPJ_CERTIFICADO:-00000000000011}}}"

if [ -z "$DEFAULT_CNPJ" ]; then
    echo "❌ Nenhum CNPJ informado."
    echo "   • Informe via argumento: ./executar_login.sh 12345678000199"
    echo "   • Ou defina CNPJ_PADRAO no arquivo .env"
    exit 1
fi

if [ -z "$1" ]; then
    echo "ℹ️  Nenhum CNPJ passado como argumento. Usando CNPJ do .env: $DEFAULT_CNPJ"
else
    echo "ℹ️  Usando CNPJ informado: $DEFAULT_CNPJ"
fi

echo ""
python3 scripts/automation/executar_login_nfse.py "$DEFAULT_CNPJ"


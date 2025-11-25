#!/bin/bash
# Script para iniciar o backend com a chave Fernet correta

cd "$(dirname "$0")"

# Ativa o ambiente virtual
if [ -f .venv/bin/activate ]; then
    source .venv/bin/activate
    echo "✅ Ambiente virtual ativado (.venv)"
else
    echo "⚠️  Ambiente virtual não encontrado em .venv/bin/activate"
    echo "   Certifique-se de que o ambiente virtual está criado"
    exit 1
fi

# Carrega a chave do .env se existir
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
    echo "✅ Chave FERNET_KEY carregada do .env"
else
    echo "⚠️  Arquivo .env não encontrado"
    echo "   Defina FERNET_KEY manualmente:"
    echo "   export FERNET_KEY='sua_chave_aqui'"
fi

# Verifica se FERNET_KEY está definida
if [ -z "$FERNET_KEY" ]; then
    echo "❌ ERRO: FERNET_KEY não está definida!"
    echo "   Defina no arquivo .env ou exporte manualmente"
    exit 1
fi

echo "🚀 Iniciando uvicorn com FERNET_KEY configurada..."
echo "   Chave: ${FERNET_KEY:0:40}..."
echo "   Host: 0.0.0.0 (acessível de qualquer IP)"
echo "   Porta: 8000"
echo ""

# Inicia o uvicorn
uvicorn main:app --reload --host 0.0.0.0 --port 8000


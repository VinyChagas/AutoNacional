#!/bin/bash
# Script para testar todas as rotas da API de uma só vez

cd "$(dirname "$0")"

# Ativa o ambiente virtual se existir
if [ -f .venv/bin/activate ]; then
    source .venv/bin/activate
    echo "✅ Ambiente virtual ativado"
fi

# Verifica se Python está disponível
if ! command -v python3 &> /dev/null; then
    echo "❌ Erro: python3 não encontrado"
    exit 1
fi

# Verifica se requests está instalado
if ! python3 -c "import requests" 2>/dev/null; then
    echo "⚠️  Biblioteca 'requests' não encontrada"
    echo "   Instalando..."
    pip install requests
fi

# Executa o script Python
echo "🧪 Executando testes de todas as rotas..."
echo ""

python3 testar_todas_rotas.py "$@"


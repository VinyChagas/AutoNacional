#!/bin/bash
# Script para testar a rota de importação de certificado

echo "🧪 Testando rota de importação de certificado..."
echo ""

# Verifica se o arquivo foi passado como argumento
if [ -z "$1" ]; then
    echo "❌ Erro: Forneça o caminho do arquivo .pfx ou .p12"
    echo "   Uso: ./testar_importacao.sh /caminho/para/certificado.pfx [senha]"
    exit 1
fi

CERTIFICADO="$1"
SENHA="${2:-}"

# Verifica se o arquivo existe
if [ ! -f "$CERTIFICADO" ]; then
    echo "❌ Erro: Arquivo não encontrado: $CERTIFICADO"
    exit 1
fi

# Verifica se a senha foi fornecida
if [ -z "$SENHA" ]; then
    echo "⚠️  Senha não fornecida. Será solicitada interativamente."
    read -s -p "Digite a senha do certificado: " SENHA
    echo ""
fi

echo "📤 Enviando requisição para: http://localhost:8000/api/certificados/importar"
echo "   Arquivo: $CERTIFICADO"
echo ""

# Faz a requisição
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:8000/api/certificados/importar" \
  -F "certificado=@$CERTIFICADO" \
  -F "senha=$SENHA")

# Separa o corpo da resposta do código HTTP
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "📥 Resposta do servidor:"
echo "   Status HTTP: $HTTP_CODE"
echo ""
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"


#!/bin/bash
# Script para desativar o ambiente virtual

# Verifica se há um ambiente virtual ativo
if [ -n "$VIRTUAL_ENV" ]; then
    echo "🔌 Desativando ambiente virtual: $VIRTUAL_ENV"
    deactivate
    echo "✅ Ambiente virtual desativado com sucesso"
else
    echo "ℹ️  Nenhum ambiente virtual está ativo no momento"
fi


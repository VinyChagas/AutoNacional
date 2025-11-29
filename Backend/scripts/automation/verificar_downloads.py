#!/usr/bin/env python3
"""
Script utilitário para verificar downloads de NFS-e.

Este script pode ser executado independentemente para verificar se os downloads
foram bem-sucedidos e se estão na pasta correta.

Uso:
    python verificar_downloads.py --base_path "/caminho/base" --competencia "10/2025" --empresa "Empresa XYZ"
    
    # Verificar apenas Emitidas
    python verificar_downloads.py --base_path "/caminho/base" --competencia "10/2025" --empresa "Empresa XYZ" --tipo "Emitidas"
    
    # Verificar apenas Recebidas
    python verificar_downloads.py --base_path "/caminho/base" --competencia "10/2025" --empresa "Empresa XYZ" --tipo "Recebidas"
"""

import argparse
import sys
from pathlib import Path

# Adiciona o diretório pai ao path para importar módulos
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scripts.automation.processar_notas_competencia_sync import (
    verificar_downloads_competencia,
    gerar_relatorio_downloads
)
from scripts.automation.download_manager import get_download_base_path


def main():
    parser = argparse.ArgumentParser(
        description="Verifica downloads de NFS-e de uma competência específica"
    )
    
    parser.add_argument(
        '--base_path',
        type=str,
        help='Caminho base de downloads (opcional, usa padrão do sistema se não informado)'
    )
    
    parser.add_argument(
        '--competencia',
        type=str,
        required=True,
        help='Competência no formato MM/AAAA (ex: 10/2025)'
    )
    
    parser.add_argument(
        '--empresa',
        type=str,
        required=True,
        help='Nome da empresa'
    )
    
    parser.add_argument(
        '--tipo',
        type=str,
        choices=['Emitidas', 'Recebidas'],
        default=None,
        help='Tipo de nota a verificar (Emitidas ou Recebidas). Se não informado, verifica ambos.'
    )
    
    parser.add_argument(
        '--json',
        action='store_true',
        help='Saída em formato JSON'
    )
    
    args = parser.parse_args()
    
    # Determina base_path
    if args.base_path:
        base_path = args.base_path
    else:
        base_path = str(get_download_base_path())
        print(f"ℹ️  Caminho base não informado. Usando padrão: {base_path}")
    
    # Verifica downloads
    resultado = verificar_downloads_competencia(
        base_path=base_path,
        competencia=args.competencia,
        empresa=args.empresa,
        tipo_nota=args.tipo
    )
    
    if args.json:
        # Saída em JSON
        import json
        print(json.dumps(resultado, indent=2, ensure_ascii=False))
    else:
        # Saída formatada
        gerar_relatorio_downloads(
            base_path=base_path,
            competencia=args.competencia,
            empresa=args.empresa,
            tipo_nota=args.tipo
        )
        
        # Exit code baseado no resultado
        if resultado['arquivos_invalidos'] > 0:
            sys.exit(1)  # Erro se houver arquivos inválidos
        else:
            sys.exit(0)  # Sucesso


if __name__ == "__main__":
    main()


#!/usr/bin/env python3
"""
Script para listar todas as empresas cadastradas no banco de dados.

Uso:
    python scripts/listar_empresas.py
    python scripts/listar_empresas.py --com-credenciais  # Mostra apenas empresas com credenciais
    python scripts/listar_empresas.py --sem-credenciais  # Mostra apenas empresas sem credenciais
    python scripts/listar_empresas.py --cnpj 12345678000190  # Busca por CNPJ específico
"""

import sys
import os
from pathlib import Path

# Adiciona o diretório raiz ao path para imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from src.db.session import SessionLocal
from src.db.models import Empresa, CredencialLogin
from sqlalchemy import func
import argparse


def formatar_cnpj(cnpj: str) -> str:
    """Formata CNPJ para exibição."""
    if len(cnpj) == 14:
        return f"{cnpj[:2]}.{cnpj[2:5]}.{cnpj[5:8]}/{cnpj[8:12]}-{cnpj[12:]}"
    return cnpj


def listar_empresas(com_credenciais: bool = None, cnpj_filtro: str = None):
    """Lista todas as empresas do banco de dados."""
    db = SessionLocal()
    
    try:
        # Query base
        query = db.query(
            Empresa.id,
            Empresa.cnpj,
            Empresa.razao_social,
            Empresa.regime,
            Empresa.contabilidade_id,
            func.count(CredencialLogin.id).label('qtd_credenciais')
        ).outerjoin(
            CredencialLogin, Empresa.id == CredencialLogin.empresa_id
        ).group_by(
            Empresa.id,
            Empresa.cnpj,
            Empresa.razao_social,
            Empresa.regime,
            Empresa.contabilidade_id
        )
        
        # Aplica filtros
        if cnpj_filtro:
            cnpj_limpo = cnpj_filtro.replace(".", "").replace("/", "").replace("-", "").strip()
            query = query.filter(Empresa.cnpj == cnpj_limpo)
        
        empresas = query.order_by(Empresa.razao_social.asc()).all()
        
        # Filtra por credenciais se necessário
        if com_credenciais is True:
            empresas = [e for e in empresas if e.qtd_credenciais > 0]
        elif com_credenciais is False:
            empresas = [e for e in empresas if e.qtd_credenciais == 0]
        
        # Exibe resultados
        print("\n" + "="*100)
        print(f"{'ID':<6} {'CNPJ':<20} {'Razão Social':<50} {'Regime':<15} {'Credenciais':<12}")
        print("="*100)
        
        if not empresas:
            print("Nenhuma empresa encontrada.")
        else:
            for emp in empresas:
                cnpj_formatado = formatar_cnpj(emp.cnpj)
                razao_social = emp.razao_social[:47] + "..." if len(emp.razao_social) > 50 else emp.razao_social
                regime = emp.regime or "N/A"
                qtd_credenciais = emp.qtd_credenciais
                
                print(f"{emp.id:<6} {cnpj_formatado:<20} {razao_social:<50} {regime:<15} {qtd_credenciais:<12}")
        
        print("="*100)
        print(f"\nTotal de empresas: {len(empresas)}")
        
        # Estatísticas
        total_com_credenciais = sum(1 for e in empresas if e.qtd_credenciais > 0)
        total_sem_credenciais = len(empresas) - total_com_credenciais
        total_credenciais = sum(e.qtd_credenciais for e in empresas)
        
        print(f"  - Com credenciais: {total_com_credenciais}")
        print(f"  - Sem credenciais: {total_sem_credenciais}")
        print(f"  - Total de credenciais: {total_credenciais}")
        
    except Exception as e:
        print(f"❌ Erro ao listar empresas: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(
        description="Lista empresas cadastradas no banco de dados",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  python scripts/listar_empresas.py
  python scripts/listar_empresas.py --com-credenciais
  python scripts/listar_empresas.py --sem-credenciais
  python scripts/listar_empresas.py --cnpj 12345678000190
        """
    )
    
    parser.add_argument(
        '--com-credenciais',
        action='store_true',
        help='Mostra apenas empresas que possuem credenciais cadastradas'
    )
    
    parser.add_argument(
        '--sem-credenciais',
        action='store_true',
        help='Mostra apenas empresas que NÃO possuem credenciais cadastradas'
    )
    
    parser.add_argument(
        '--cnpj',
        type=str,
        help='Busca empresa por CNPJ específico'
    )
    
    args = parser.parse_args()
    
    # Validação: não pode usar --com-credenciais e --sem-credenciais ao mesmo tempo
    if args.com_credenciais and args.sem_credenciais:
        print("❌ Erro: Não é possível usar --com-credenciais e --sem-credenciais ao mesmo tempo.", file=sys.stderr)
        sys.exit(1)
    
    com_credenciais = None
    if args.com_credenciais:
        com_credenciais = True
    elif args.sem_credenciais:
        com_credenciais = False
    
    listar_empresas(com_credenciais=com_credenciais, cnpj_filtro=args.cnpj)


if __name__ == "__main__":
    main()


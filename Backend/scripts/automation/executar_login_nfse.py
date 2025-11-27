#!/usr/bin/env python3
"""
Script para executar login no portal NFSe Nacional usando Playwright.

Este script é uma interface simples para executar a automação NFSe
via linha de comando usando Playwright com certificado A1.
"""

import sys
import os

# Adiciona src ao path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src_path = os.path.join(backend_dir, "src")
if src_path not in sys.path:
    sys.path.insert(0, src_path)

# Carrega variáveis de ambiente
from dotenv import load_dotenv
env_path = os.path.join(backend_dir, ".env")
load_dotenv(env_path)
load_dotenv()

from playwright_nfse import abrir_dashboard_nfse, NFSeAutenticacaoError

def main():
    """Função principal que executa o login."""
    # Pega CNPJ dos argumentos
    cnpj = None
    headless = False  # Por padrão, mostra o navegador para facilitar debug
    
    for arg in sys.argv[1:]:
        if arg == "--headless":
            headless = True
        elif arg == "--no-headless" or arg == "--visible":
            headless = False
        elif not arg.startswith("--"):
            cnpj = arg
    
    if not cnpj:
        cnpj = os.getenv("CNPJ_PADRAO", os.getenv("CNPJ_CERTIFICADO", "00000000000011"))
        print(f"ℹ️  Nenhum CNPJ informado. Usando CNPJ padrão: {cnpj}")
        print(f"   Para usar outro CNPJ: python3 {sys.argv[0]} <CNPJ>")
    
    # Remove formatação do CNPJ
    cnpj_limpo = cnpj.replace(".", "").replace("/", "").replace("-", "").strip()
    
    if len(cnpj_limpo) != 14:
        print(f"❌ ERRO: CNPJ inválido. Deve conter 14 dígitos. Recebido: {len(cnpj_limpo)} dígitos")
        sys.exit(1)
    
    print("=" * 60)
    print("🚀 AUTOMAÇÃO NFSe COM PLAYWRIGHT")
    print("=" * 60)
    print(f"CNPJ: {cnpj_limpo}")
    print(f"Modo: {'Headless' if headless else 'Visível'}")
    print("=" * 60)
    print()
    
    try:
        resultado = abrir_dashboard_nfse(
            cnpj=cnpj_limpo,
            headless=headless,
            timeout=30000
        )
        
        print()
        print("=" * 60)
        print("📊 RESULTADO")
        print("=" * 60)
        print(f"✅ Sucesso: {resultado['sucesso']}")
        print(f"📍 URL Atual: {resultado['url_atual']}")
        print(f"📝 Título: {resultado['titulo']}")
        print(f"💬 Mensagem: {resultado['mensagem']}")
        print()
        print("📋 Logs:")
        for log in resultado['logs']:
            print(f"   {log}")
        print("=" * 60)
        
        if resultado['sucesso']:
            print("✅ Login realizado com sucesso!")
            if not headless:
                print("\n⏸️  Navegador aberto. Pressione Enter para fechar...")
                input()
            sys.exit(0)
        else:
            print("⚠️  Login concluído com avisos")
            sys.exit(1)
            
    except NFSeAutenticacaoError as e:
        print()
        print("=" * 60)
        print("❌ ERRO DE AUTENTICAÇÃO")
        print("=" * 60)
        print(f"Erro: {str(e)}")
        print()
        print("Possíveis causas:")
        print("  • Certificado não encontrado para este CNPJ")
        print("  • Senha do certificado incorreta")
        print("  • Certificado inválido ou expirado")
        print("  • Problema de conexão com o portal NFSe")
        print("=" * 60)
        sys.exit(1)
        
    except Exception as e:
        print()
        print("=" * 60)
        print("❌ ERRO INESPERADO")
        print("=" * 60)
        print(f"Erro: {str(e)}")
        import traceback
        print()
        print("Traceback completo:")
        traceback.print_exc()
        print("=" * 60)
        sys.exit(1)

if __name__ == "__main__":
    main()


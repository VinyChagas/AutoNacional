#!/usr/bin/env python3
"""
Script para testar a execução completa da rota de execução.
"""

import sys
import os
import requests
import json

# Navega para o diretório raiz do backend (um nível acima deste script)
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(backend_dir)

def testar_rota_execucao():
    """Testa a rota de execução."""
    base_url = "http://localhost:8000"
    empresa_id = "13250208000100"
    competencia = "112025"
    tipo = "ambas"
    headless = True
    
    url = f"{base_url}/api/execucao/{empresa_id}?competencia={competencia}&tipo={tipo}&headless={headless}"
    
    print("=" * 60)
    print("TESTE DE EXECUÇÃO")
    print("=" * 60)
    print(f"URL: {url}")
    print(f"Método: POST")
    print("=" * 60)
    print()
    
    try:
        response = requests.post(url, json={}, timeout=10)
        
        print(f"Status Code: {response.status_code}")
        print(f"Headers: {dict(response.headers)}")
        print()
        
        if response.status_code == 200:
            data = response.json()
            print("✅ SUCESSO!")
            print(f"Resposta: {json.dumps(data, indent=2, ensure_ascii=False)}")
        else:
            print("❌ ERRO!")
            print(f"Resposta: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ ERRO: Não foi possível conectar ao servidor.")
        print("   Certifique-se de que o servidor está rodando em http://localhost:8000")
    except Exception as e:
        print(f"❌ ERRO: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    testar_rota_execucao()


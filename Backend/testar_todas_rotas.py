#!/usr/bin/env python3
"""
Script para testar todas as rotas da API de uma só vez.

Uso:
    python testar_todas_rotas.py [--base-url BASE_URL] [--cnpj CNPJ] [--certificado CAMINHO_PFX] [--senha SENHA]

Exemplos:
    # Testar todas as rotas (algumas podem falhar por falta de dados)
    python testar_todas_rotas.py

    # Testar com CNPJ específico
    python testar_todas_rotas.py --cnpj 00363320000106

    # Testar com certificado
    python testar_todas_rotas.py --certificado certificado.pfx --senha senha123 --cnpj 00363320000106
"""

import argparse
import sys
import json
from typing import Dict, Any, Optional
from datetime import datetime

try:
    import requests
except ImportError:
    print("❌ Erro: Biblioteca 'requests' não encontrada.")
    print("   Instale com: pip install requests")
    sys.exit(1)


# Configurações padrão
DEFAULT_BASE_URL = "http://localhost:8000"
DEFAULT_CNPJ = "00363320000106"  # CNPJ de exemplo


class Colors:
    """Cores para output no terminal."""
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


def print_header(text: str):
    """Imprime um cabeçalho formatado."""
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*70}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text.center(70)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*70}{Colors.ENDC}\n")


def print_success(message: str):
    """Imprime mensagem de sucesso."""
    print(f"{Colors.OKGREEN}✅ {message}{Colors.ENDC}")


def print_error(message: str):
    """Imprime mensagem de erro."""
    print(f"{Colors.FAIL}❌ {message}{Colors.ENDC}")


def print_warning(message: str):
    """Imprime mensagem de aviso."""
    print(f"{Colors.WARNING}⚠️  {message}{Colors.ENDC}")


def print_info(message: str):
    """Imprime mensagem informativa."""
    print(f"{Colors.OKCYAN}ℹ️  {message}{Colors.ENDC}")


def print_result(route: str, method: str, status_code: int, response_data: Any, error: Optional[str] = None):
    """Imprime resultado de uma requisição."""
    status_emoji = "✅" if 200 <= status_code < 300 else "❌"
    status_color = Colors.OKGREEN if 200 <= status_code < 300 else Colors.FAIL
    
    print(f"\n{status_color}{status_emoji} {method} {route}{Colors.ENDC}")
    print(f"   Status: {status_code}")
    
    if error:
        print(f"   Erro: {error}")
    elif response_data:
        # Limita o tamanho da resposta para não poluir o output
        response_str = json.dumps(response_data, indent=2, ensure_ascii=False)
        if len(response_str) > 500:
            response_str = response_str[:500] + "\n   ... (resposta truncada)"
        print(f"   Resposta: {response_str}")
    
    return status_code < 400


def test_health_check(base_url: str) -> bool:
    """Testa o endpoint de health check."""
    print_header("1. Health Check")
    
    try:
        response = requests.get(f"{base_url}/", timeout=5)
        data = response.json() if response.content else None
        return print_result("/", "GET", response.status_code, data)
    except requests.exceptions.ConnectionError:
        print_error(f"Não foi possível conectar ao servidor em {base_url}")
        print_info("Certifique-se de que o backend está rodando (./iniciar_backend.sh ou iniciar_backend.bat)")
        return False
    except Exception as e:
        print_error(f"Erro inesperado: {str(e)}")
        return False


def test_listar_empresas(base_url: str) -> bool:
    """Testa o endpoint de listar empresas."""
    print_header("2. Listar Empresas")
    
    try:
        response = requests.get(f"{base_url}/empresas", timeout=5)
        data = response.json() if response.content else None
        return print_result("/empresas", "GET", response.status_code, data)
    except Exception as e:
        print_error(f"Erro: {str(e)}")
        return False


def test_post_credenciais(base_url: str) -> bool:
    """Testa o endpoint de criar/atualizar credenciais."""
    print_header("3. Criar/Atualizar Credenciais")
    
    try:
        # Dados de exemplo (stub)
        payload = {
            "empresa_id": "demo",
            "portal": "nfse_nacional",
            "usuario": "usuario_teste",
            "senha": "senha_teste"
        }
        
        response = requests.post(
            f"{base_url}/credenciais",
            json=payload,
            timeout=5
        )
        data = response.json() if response.content else None
        return print_result("/credenciais", "POST", response.status_code, data)
    except Exception as e:
        print_error(f"Erro: {str(e)}")
        return False


def test_listar_certificados(base_url: str) -> bool:
    """Testa o endpoint de listar certificados."""
    print_header("4. Listar Certificados")
    
    try:
        response = requests.get(f"{base_url}/api/certificados", timeout=5)
        data = response.json() if response.content else None
        
        # Se retornar 404, pode ser que a rota não exista ainda
        if response.status_code == 404:
            print_warning("Rota não implementada ainda (conforme ROTAS_NECESSARIAS.md)")
        
        return print_result("/api/certificados", "GET", response.status_code, data)
    except Exception as e:
        print_error(f"Erro: {str(e)}")
        return False


def test_obter_certificado(base_url: str, cnpj: str) -> bool:
    """Testa o endpoint de obter certificado específico."""
    print_header(f"5. Obter Certificado (CNPJ: {cnpj})")
    
    try:
        response = requests.get(f"{base_url}/api/certificados/{cnpj}", timeout=5)
        data = response.json() if response.content else None
        
        if response.status_code == 404:
            print_warning("Rota não implementada ainda ou certificado não encontrado")
        
        return print_result(f"/api/certificados/{cnpj}", "GET", response.status_code, data)
    except Exception as e:
        print_error(f"Erro: {str(e)}")
        return False


def test_importar_certificado(base_url: str, certificado_path: Optional[str], senha: Optional[str]) -> bool:
    """Testa o endpoint de importar certificado."""
    print_header("6. Importar Certificado")
    
    if not certificado_path or not senha:
        print_warning("Certificado ou senha não fornecidos. Pulando teste.")
        print_info("Use --certificado e --senha para testar esta rota")
        return None  # Não conta como falha
    
    try:
        with open(certificado_path, 'rb') as f:
            files = {'certificado': (certificado_path, f, 'application/x-pkcs12')}
            data = {'senha': senha}
            
            response = requests.post(
                f"{base_url}/api/certificados/importar",
                files=files,
                data=data,
                timeout=30
            )
        
        response_data = response.json() if response.content else None
        return print_result("/api/certificados/importar", "POST", response.status_code, response_data)
    except FileNotFoundError:
        print_error(f"Arquivo não encontrado: {certificado_path}")
        return False
    except Exception as e:
        print_error(f"Erro: {str(e)}")
        return False


def test_upload_certificado(base_url: str, certificado_path: Optional[str], senha: Optional[str], cnpj: str) -> bool:
    """Testa o endpoint de upload de certificado."""
    print_header("7. Upload de Certificado")
    
    if not certificado_path or not senha:
        print_warning("Certificado ou senha não fornecidos. Pulando teste.")
        print_info("Use --certificado e --senha para testar esta rota")
        return None  # Não conta como falha
    
    try:
        with open(certificado_path, 'rb') as f:
            files = {'certificado': (certificado_path, f, 'application/x-pkcs12')}
            data = {
                'cnpj': cnpj,
                'senha': senha
            }
            
            response = requests.post(
                f"{base_url}/api/certificados",
                files=files,
                data=data,
                timeout=30
            )
        
        response_data = response.json() if response.content else None
        return print_result("/api/certificados", "POST", response.status_code, response_data)
    except FileNotFoundError:
        print_error(f"Arquivo não encontrado: {certificado_path}")
        return False
    except Exception as e:
        print_error(f"Erro: {str(e)}")
        return False


def test_abrir_nfse(base_url: str, cnpj: str, headless: bool = False) -> bool:
    """Testa o endpoint de abrir dashboard NFSe."""
    print_header(f"8. Abrir Dashboard NFSe (CNPJ: {cnpj}, Headless: {headless})")
    
    try:
        response = requests.post(
            f"{base_url}/api/nfse/{cnpj}/abrir",
            params={'headless': headless},
            json={},
            timeout=60  # Timeout maior pois pode demorar
        )
        
        response_data = response.json() if response.content else None
        
        if response.status_code == 401:
            print_warning("Falha na autenticação - certificado não encontrado ou senha incorreta")
        elif response.status_code == 500:
            print_warning("Erro interno - verifique os logs do servidor")
        
        return print_result(f"/api/nfse/{cnpj}/abrir", "POST", response.status_code, response_data)
    except Exception as e:
        print_error(f"Erro: {str(e)}")
        return False


def main():
    """Função principal."""
    parser = argparse.ArgumentParser(
        description="Testa todas as rotas da API AutoNacional",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  # Testar todas as rotas básicas
  python testar_todas_rotas.py

  # Testar com CNPJ específico
  python testar_todas_rotas.py --cnpj 00363320000106

  # Testar com certificado
  python testar_todas_rotas.py --certificado cert.pfx --senha senha123 --cnpj 00363320000106

  # Testar em servidor diferente
  python testar_todas_rotas.py --base-url http://localhost:3000
        """
    )
    
    parser.add_argument(
        '--base-url',
        default=DEFAULT_BASE_URL,
        help=f'URL base da API (padrão: {DEFAULT_BASE_URL})'
    )
    
    parser.add_argument(
        '--cnpj',
        default=DEFAULT_CNPJ,
        help=f'CNPJ para testes (padrão: {DEFAULT_CNPJ})'
    )
    
    parser.add_argument(
        '--certificado',
        help='Caminho para arquivo .pfx/.p12 para testes de upload/importação'
    )
    
    parser.add_argument(
        '--senha',
        help='Senha do certificado (usado com --certificado)'
    )
    
    parser.add_argument(
        '--headless',
        action='store_true',
        help='Executar teste NFSe em modo headless'
    )
    
    args = parser.parse_args()
    
    # Validação
    if (args.certificado and not args.senha) or (args.senha and not args.certificado):
        print_error("--certificado e --senha devem ser fornecidos juntos")
        sys.exit(1)
    
    # Limpa CNPJ (remove formatação)
    cnpj_limpo = args.cnpj.replace('.', '').replace('/', '').replace('-', '').strip()
    if len(cnpj_limpo) != 14:
        print_error(f"CNPJ inválido: {args.cnpj} (deve ter 14 dígitos)")
        sys.exit(1)
    
    print_header("🧪 TESTE DE TODAS AS ROTAS DA API")
    print_info(f"Base URL: {args.base_url}")
    print_info(f"CNPJ: {cnpj_limpo}")
    print_info(f"Certificado: {args.certificado or 'Não fornecido'}")
    print_info(f"Headless: {args.headless}")
    
    # Lista de testes
    resultados = []
    
    # 1. Health Check
    resultados.append(("Health Check", test_health_check(args.base_url)))
    
    # Se não conseguiu conectar, para aqui
    if not resultados[0][1]:
        print_error("\n❌ Não foi possível conectar ao servidor. Abortando testes.")
        sys.exit(1)
    
    # 2. Listar Empresas
    resultados.append(("Listar Empresas", test_listar_empresas(args.base_url)))
    
    # 3. Criar/Atualizar Credenciais
    resultados.append(("Criar/Atualizar Credenciais", test_post_credenciais(args.base_url)))
    
    # 4. Listar Certificados
    resultados.append(("Listar Certificados", test_listar_certificados(args.base_url)))
    
    # 5. Obter Certificado
    resultados.append(("Obter Certificado", test_obter_certificado(args.base_url, cnpj_limpo)))
    
    # 6. Importar Certificado
    resultado_importar = test_importar_certificado(args.base_url, args.certificado, args.senha)
    if resultado_importar is not None:
        resultados.append(("Importar Certificado", resultado_importar))
    
    # 7. Upload Certificado
    resultado_upload = test_upload_certificado(args.base_url, args.certificado, args.senha, cnpj_limpo)
    if resultado_upload is not None:
        resultados.append(("Upload Certificado", resultado_upload))
    
    # 8. Abrir NFSe
    resultados.append(("Abrir Dashboard NFSe", test_abrir_nfse(args.base_url, cnpj_limpo, args.headless)))
    
    # Resumo final
    print_header("📊 RESUMO DOS TESTES")
    
    sucessos = sum(1 for _, resultado in resultados if resultado is True)
    falhas = sum(1 for _, resultado in resultados if resultado is False)
    pulados = sum(1 for _, resultado in resultados if resultado is None)
    total = len(resultados)
    
    print(f"\n{Colors.BOLD}Total de testes: {total}{Colors.ENDC}")
    print_success(f"Sucessos: {sucessos}")
    if falhas > 0:
        print_error(f"Falhas: {falhas}")
    if pulados > 0:
        print_warning(f"Pulados: {pulados}")
    
    print("\n" + "="*70)
    
    # Lista detalhada
    print(f"\n{Colors.BOLD}Detalhes:{Colors.ENDC}\n")
    for nome, resultado in resultados:
        if resultado is True:
            print_success(f"{nome}")
        elif resultado is False:
            print_error(f"{nome}")
        else:
            print_warning(f"{nome} (pulado)")
    
    print("\n" + "="*70 + "\n")
    
    # Exit code
    if falhas > 0:
        print_warning("Alguns testes falharam. Verifique os detalhes acima.")
        sys.exit(1)
    else:
        print_success("Todos os testes executados com sucesso!")
        sys.exit(0)


if __name__ == "__main__":
    main()


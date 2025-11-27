"""
Endpoints FastAPI para automação do portal NFSe Nacional.

Este módulo fornece endpoints REST para iniciar automações no portal NFSe
usando certificados A1 através do Playwright.
"""

from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel

# Import lazy - só importa quando necessário para não bloquear registro do router
import sys
import os

_current_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_current_dir)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

# Adiciona scripts/automation ao path
import os
import sys
_backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_scripts_automation_path = os.path.join(_backend_dir, "scripts", "automation")
if _scripts_automation_path not in sys.path:
    sys.path.insert(0, _scripts_automation_path)

# Função para importar playwright_nfse apenas quando necessário
def _get_playwright_functions():
    """Importa playwright_nfse apenas quando necessário."""
    try:
        from playwright_nfse import abrir_dashboard_nfse, NFSeAutenticacaoError
        return abrir_dashboard_nfse, NFSeAutenticacaoError
    except ImportError:
        # Se não conseguir importar, levanta erro apropriado
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de automação não disponível. Verifique se o playwright está instalado."
        )

router = APIRouter(prefix="/api/nfse", tags=["NFSe"])


class NFSeAbrirResponse(BaseModel):
    """Resposta do endpoint de abertura do dashboard NFSe."""
    sucesso: bool
    url_atual: str
    titulo: str
    mensagem: str
    logs: list[str]


@router.post("/{cnpj}/abrir", response_model=NFSeAbrirResponse, summary="Abrir dashboard NFSe")
def abrir_dashboard(
    cnpj: str,
    headless: bool = Query(default=False, description="Executar navegador em modo headless (padrão: False - navegador visível)")
) -> NFSeAbrirResponse:
    """
    Abre o dashboard do portal NFSe Nacional autenticado com certificado A1.
    
    Este endpoint:
    1. Carrega o certificado A1 associado ao CNPJ fornecido
    2. Inicia o Playwright com Chromium configurado para usar o certificado
    3. Acessa o portal NFSe Nacional e autentica automaticamente
    4. Navega até o dashboard autenticado
    5. Retorna informações sobre o resultado da autenticação
    
    Args:
        cnpj: CNPJ da empresa (sem formatação, apenas números)
        headless: Se True, executa o navegador em modo headless (padrão: False - navegador visível)
        
    Returns:
        NFSeAbrirResponse com informações sobre o resultado da autenticação
        
    Raises:
        HTTPException: Se o certificado não for encontrado ou a autenticação falhar
    """
    try:
        # Remove formatação do CNPJ se houver
        cnpj_limpo = cnpj.replace(".", "").replace("/", "").replace("-", "").strip()
        
        if not cnpj_limpo or len(cnpj_limpo) != 14:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CNPJ inválido. Deve conter 14 dígitos."
            )
        
        # Importa funções do playwright apenas quando necessário
        abrir_dashboard_nfse, NFSeAutenticacaoError = _get_playwright_functions()
        
        # Executa a automação
        resultado = abrir_dashboard_nfse(
            cnpj=cnpj_limpo,
            headless=headless,
            timeout=30000
        )
        
        # Retorna o resultado
        return NFSeAbrirResponse(
            sucesso=resultado["sucesso"],
            url_atual=resultado["url_atual"],
            titulo=resultado["titulo"],
            mensagem=resultado["mensagem"],
            logs=resultado["logs"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        # Verifica se é erro de autenticação
        if "NFSeAutenticacaoError" in str(type(e)) or "autenticação" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Falha na autenticação: {str(e)}"
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Falha na autenticação: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro inesperado ao abrir dashboard NFSe: {str(e)}"
        )


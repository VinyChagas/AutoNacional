"""
Endpoints FastAPI para gerenciamento de certificados digitais.

Este módulo fornece endpoints REST para upload, importação e validação
de certificados digitais ICP-Brasil.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, status
from fastapi.responses import JSONResponse

from ..services.certificate_service import get_certificate_service
from ..utils.certificado_utils import validar_pfx, extrair_informacoes_certificado
from ..models.certificado import CertificadoUploadResponse, CertificadoImportResponse
from ..infrastructure.logger import get_logger
from cryptography import x509

logger = get_logger(__name__)

router = APIRouter(prefix="/api/certificados", tags=["Certificados"])


@router.post("", response_model=CertificadoUploadResponse, summary="Upload de certificado")
async def upload_certificado(
    cnpj: str = Form(...),
    senha: str = Form(...),
    certificado: UploadFile = File(...)
) -> CertificadoUploadResponse:
    """
    Endpoint para upload de certificado digital (.pfx ou .p12).
    
    Valida o certificado e salva criptografado no disco.
    
    Args:
        cnpj: CNPJ da empresa (14 dígitos, com ou sem formatação)
        senha: Senha do certificado
        certificado: Arquivo .pfx ou .p12
        
    Returns:
        CertificadoUploadResponse com informações do upload
        
    Raises:
        HTTPException: Se houver erro na validação ou salvamento
    """
    try:
        logger.info(f"Endpoint /api/certificados chamado - CNPJ: {cnpj}")
        
        # Validação básica do arquivo
        if not certificado.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nome do arquivo não fornecido"
            )
        
        filename_lower = certificado.filename.lower()
        if not (filename_lower.endswith('.pfx') or filename_lower.endswith('.p12')):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Arquivo deve ser um certificado .pfx ou .p12. Recebido: {certificado.filename}"
            )
        
        # Validação básica do CNPJ
        cnpj_limpo = cnpj.strip().replace('.', '').replace('/', '').replace('-', '').replace(' ', '')
        if not cnpj_limpo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CNPJ não pode estar vazio"
            )
        
        if len(cnpj_limpo) != 14:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CNPJ inválido. Deve conter 14 dígitos. Recebido: {len(cnpj_limpo)} dígitos ({cnpj_limpo})"
            )
        
        # Validação da senha
        if not senha or not senha.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Senha não pode estar vazia"
            )
        
        conteudo = await certificado.read()
        
        if not conteudo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo vazio ou não foi possível ler o conteúdo"
            )
        
        logger.info(f"Arquivo lido com sucesso. Tamanho: {len(conteudo)} bytes")
        
        # Valida o PFX
        key, cert, additional_certs = validar_pfx(conteudo, senha)
        subject = cert.subject
        
        # Salva criptografado usando o service
        certificate_service = get_certificate_service()
        certificate_service.salvar_certificado(cnpj_limpo, conteudo, senha)
        
        # Extrai o Common Name do subject
        common_name = None
        try:
            for attr in subject:
                if attr.oid == x509.NameOID.COMMON_NAME:
                    common_name = attr.value
                    break
        except Exception as e:
            logger.warning(f"Não foi possível extrair Common Name: {e}")
        
        resposta = CertificadoUploadResponse(
            message="Certificado salvo com sucesso",
            cnpj=cnpj_limpo,
            subject_common_name=common_name,
            success=True
        )
        
        logger.info(f"Retornando resposta de sucesso: {resposta}")
        return resposta
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao processar certificado: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao processar certificado: {str(e)}"
        )


@router.post("/importar", response_model=CertificadoImportResponse, summary="Importar certificado e extrair informações")
async def importar_certificado(
    certificado: UploadFile = File(...),
    senha: str = Form(...)
) -> CertificadoImportResponse:
    """
    Endpoint para importar certificado digital e extrair informações automaticamente.
    
    Recebe apenas o arquivo e a senha, retorna CNPJ, nome da empresa e data de vencimento.
    
    Args:
        certificado: Arquivo .pfx ou .p12
        senha: Senha do certificado
        
    Returns:
        CertificadoImportResponse com informações extraídas
        
    Raises:
        HTTPException: Se houver erro na validação ou extração
    """
    try:
        # Validação do arquivo
        if not certificado.filename:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "message": "Nome do arquivo não fornecido"
                }
            )
        
        filename_lower = certificado.filename.lower()
        if not (filename_lower.endswith('.pfx') or filename_lower.endswith('.p12')):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "message": f"Arquivo deve ser um certificado .pfx ou .p12. Recebido: {certificado.filename}"
                }
            )
        
        # Validação da senha
        if not senha or not senha.strip():
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "message": "Senha não pode estar vazia"
                }
            )
        
        # Lê o conteúdo do arquivo
        conteudo = await certificado.read()
        
        if not conteudo:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "message": "Arquivo vazio ou não foi possível ler o conteúdo"
                }
            )
        
        # Extrai informações do certificado usando o service
        certificate_service = get_certificate_service()
        informacoes = certificate_service.validar_e_extrair_info(conteudo, senha, debug=False)
        
        # Valida se CNPJ foi encontrado
        if not informacoes.cnpj_limpo:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "message": "Não foi possível extrair o CNPJ do certificado. Verifique se é um certificado ICP-Brasil válido."
                }
            )
        
        # Retorna informações extraídas
        return CertificadoImportResponse(
            success=True,
            empresa=informacoes.empresa,
            cnpj=informacoes.cnpj,
            dataVencimento=informacoes.dataVencimento
        )
        
    except HTTPException as e:
        return JSONResponse(
            status_code=e.status_code,
            content={
                "success": False,
                "message": e.detail
            }
        )
    except Exception as e:
        logger.error(f"Erro ao processar certificado: {str(e)}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "message": f"Erro ao processar certificado: {str(e)}"
            }
        )


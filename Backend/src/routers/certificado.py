"""
Endpoints FastAPI para gerenciamento de certificados digitais.

Este módulo fornece endpoints REST para upload, importação e validação
de certificados digitais ICP-Brasil, além de CRUD para metadados.
"""

from datetime import date
from typing import List
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends, status, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..services.certificate_service import get_certificate_service
from ..utils.certificado_utils import validar_pfx, extrair_informacoes_certificado
from ..models.certificado import CertificadoUploadResponse, CertificadoImportResponse
from ..schemas.certificado import (
    CertificadoCreate,
    CertificadoUpdate,
    CertificadoResponse,
    CertificadoListResponse,
)
from ..db.session import get_db, init_db
from ..db.crud_certificado import (
    criar_certificado,
    obter_certificado_por_id,
    obter_certificado_por_cnpj,
    listar_certificados,
    atualizar_certificado,
    deletar_certificado,
    deletar_certificado_por_cnpj,
)
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
        
        # Extrai informações do certificado para salvar metadados
        informacoes = certificate_service.validar_e_extrair_info(conteudo, senha, debug=False)
        
        # Salva metadados no banco de dados (se disponível)
        try:
            from ..db.session import get_db
            from ..db.crud_certificado import criar_certificado, obter_certificado_por_cnpj
            
            # Obtém sessão do banco
            db_gen = get_db()
            db = next(db_gen)
            
            try:
                # Verifica se já existe
                certificado_existente = obter_certificado_por_cnpj(db, cnpj_limpo)
                
                if not certificado_existente and informacoes.dataVencimento:
                    try:
                        # Converte data de vencimento de string ISO para date
                        if isinstance(informacoes.dataVencimento, str):
                            data_vencimento = date.fromisoformat(informacoes.dataVencimento)
                        else:
                            # Se já for date, usa diretamente
                            data_vencimento = informacoes.dataVencimento
                        
                        # Cria registro no banco
                        criar_certificado(
                            db=db,
                            cnpj=cnpj_limpo,
                            empresa=informacoes.empresa,
                            data_vencimento=data_vencimento
                        )
                        logger.info(f"Metadados do certificado salvos no banco: CNPJ {cnpj_limpo}")
                    except ValueError as ve:
                        logger.warning(f"Erro ao converter data de vencimento: {ve}")
                    except Exception as e:
                        logger.warning(f"Erro ao criar metadados no banco: {e}")
                elif certificado_existente:
                    logger.info(f"Metadados do certificado já existem no banco: CNPJ {cnpj_limpo}")
            finally:
                db.close()
        except Exception as e:
            # Não falha o upload se houver erro ao salvar metadados
            logger.warning(f"Erro ao salvar metadados no banco (não crítico): {str(e)}")
        
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
        
        # Salva metadados no banco de dados (se disponível)
        try:
            from ..db.session import get_db
            from ..db.crud_certificado import criar_certificado, obter_certificado_por_cnpj
            
            # Obtém sessão do banco
            db_gen = get_db()
            db = next(db_gen)
            
            try:
                # Verifica se já existe
                certificado_existente = obter_certificado_por_cnpj(db, informacoes.cnpj_limpo)
                
                if not certificado_existente and informacoes.dataVencimento:
                    try:
                        # Converte data de vencimento de string ISO para date
                        if isinstance(informacoes.dataVencimento, str):
                            data_vencimento = date.fromisoformat(informacoes.dataVencimento)
                        else:
                            # Se já for date, usa diretamente
                            data_vencimento = informacoes.dataVencimento
                        
                        # Cria registro no banco
                        criar_certificado(
                            db=db,
                            cnpj=informacoes.cnpj_limpo,
                            empresa=informacoes.empresa,
                            data_vencimento=data_vencimento
                        )
                        logger.info(f"Metadados do certificado salvos no banco: CNPJ {informacoes.cnpj_limpo}")
                    except ValueError as ve:
                        logger.warning(f"Erro ao converter data de vencimento: {ve}")
                    except Exception as e:
                        logger.warning(f"Erro ao criar metadados no banco: {e}")
                elif certificado_existente:
                    logger.info(f"Metadados do certificado já existem no banco: CNPJ {informacoes.cnpj_limpo}")
            finally:
                db.close()
        except Exception as e:
            # Não falha a importação se houver erro ao salvar metadados
            logger.warning(f"Erro ao salvar metadados no banco (não crítico): {str(e)}")
        
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


# ============================================================================
# Rotas de CRUD para metadados de certificados (persistência)
# ============================================================================


@router.get(
    "/metadados",
    response_model=CertificadoListResponse,
    summary="Listar todos os certificados cadastrados"
)
def listar_certificados_metadados(
    skip: int = Query(0, ge=0, description="Número de registros para pular"),
    limit: int = Query(100, ge=1, le=1000, description="Número máximo de registros"),
    db: Session = Depends(get_db)
) -> CertificadoListResponse:
    """
    Lista todos os certificados cadastrados no banco de dados.
    
    Retorna apenas metadados (CNPJ, empresa, data de vencimento).
    Os arquivos .pfx continuam armazenados no sistema de arquivos.
    """
    try:
        certificados = listar_certificados(db, skip=skip, limit=limit)
        total = len(certificados)
        
        return CertificadoListResponse(
            certificados=[CertificadoResponse.model_validate(c) for c in certificados],
            total=total
        )
    except Exception as e:
        logger.error(f"Erro ao listar certificados: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao listar certificados: {str(e)}"
        )


@router.get(
    "/metadados/{certificado_id}",
    response_model=CertificadoResponse,
    summary="Buscar certificado por ID"
)
def buscar_certificado_por_id(
    certificado_id: int,
    db: Session = Depends(get_db)
) -> CertificadoResponse:
    """
    Busca um certificado pelo ID.
    
    Args:
        certificado_id: ID do certificado
        
    Returns:
        CertificadoResponse com metadados do certificado
        
    Raises:
        HTTPException: Se o certificado não for encontrado
    """
    certificado = obter_certificado_por_id(db, certificado_id)
    if not certificado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Certificado com ID {certificado_id} não encontrado"
        )
    
    return CertificadoResponse.model_validate(certificado)


@router.get(
    "/metadados/cnpj/{cnpj}",
    response_model=CertificadoResponse,
    summary="Buscar certificado por CNPJ"
)
def buscar_certificado_por_cnpj(
    cnpj: str,
    db: Session = Depends(get_db)
) -> CertificadoResponse:
    """
    Busca um certificado pelo CNPJ.
    
    Args:
        cnpj: CNPJ da empresa (com ou sem formatação)
        
    Returns:
        CertificadoResponse com metadados do certificado
        
    Raises:
        HTTPException: Se o certificado não for encontrado
    """
    certificado = obter_certificado_por_cnpj(db, cnpj)
    if not certificado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Certificado com CNPJ {cnpj} não encontrado"
        )
    
    return CertificadoResponse.model_validate(certificado)


@router.post(
    "/metadados",
    response_model=CertificadoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Criar registro de certificado"
)
def criar_certificado_metadados(
    certificado: CertificadoCreate,
    db: Session = Depends(get_db)
) -> CertificadoResponse:
    """
    Cria um novo registro de certificado no banco de dados.
    
    Este endpoint cria apenas os metadados. O arquivo .pfx deve ser
    enviado através do endpoint de upload.
    
    Args:
        certificado: Dados do certificado (CNPJ, empresa, data de vencimento)
        
    Returns:
        CertificadoResponse com o certificado criado
        
    Raises:
        HTTPException: Se o CNPJ já existir ou houver erro de validação
    """
    try:
        # Verifica se já existe certificado com este CNPJ
        existente = obter_certificado_por_cnpj(db, certificado.cnpj)
        if existente:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Certificado com CNPJ {certificado.cnpj} já existe"
            )
        
        certificado_criado = criar_certificado(
            db=db,
            cnpj=certificado.cnpj,
            empresa=certificado.empresa,
            data_vencimento=certificado.data_vencimento
        )
        
        return CertificadoResponse.from_orm(certificado_criado)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Erro ao criar certificado: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao criar certificado: {str(e)}"
        )


@router.put(
    "/metadados/{certificado_id}",
    response_model=CertificadoResponse,
    summary="Atualizar certificado"
)
def atualizar_certificado_metadados(
    certificado_id: int,
    certificado_update: CertificadoUpdate,
    db: Session = Depends(get_db)
) -> CertificadoResponse:
    """
    Atualiza os metadados de um certificado existente.
    
    Args:
        certificado_id: ID do certificado
        certificado_update: Dados para atualizar (empresa e/ou data de vencimento)
        
    Returns:
        CertificadoResponse com o certificado atualizado
        
    Raises:
        HTTPException: Se o certificado não for encontrado
    """
    certificado = atualizar_certificado(
        db=db,
        certificado_id=certificado_id,
        empresa=certificado_update.empresa,
        data_vencimento=certificado_update.data_vencimento
    )
    
    if not certificado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Certificado com ID {certificado_id} não encontrado"
        )
    
    return CertificadoResponse.model_validate(certificado)


@router.delete(
    "/metadados/{certificado_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Deletar certificado por ID"
)
def deletar_certificado_metadados(
    certificado_id: int,
    db: Session = Depends(get_db)
):
    """
    Deleta um certificado do banco de dados.
    
    Nota: Isso remove apenas os metadados do banco. O arquivo .pfx
    criptografado continua no sistema de arquivos.
    
    Args:
        certificado_id: ID do certificado
        
    Raises:
        HTTPException: Se o certificado não for encontrado
    """
    deletado = deletar_certificado(db, certificado_id)
    if not deletado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Certificado com ID {certificado_id} não encontrado"
        )


@router.delete(
    "/metadados/cnpj/{cnpj}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Deletar certificado por CNPJ"
)
def deletar_certificado_por_cnpj_metadados(
    cnpj: str,
    db: Session = Depends(get_db)
):
    """
    Deleta um certificado pelo CNPJ.
    
    Nota: Isso remove apenas os metadados do banco. O arquivo .pfx
    criptografado continua no sistema de arquivos.
    
    Args:
        cnpj: CNPJ da empresa (com ou sem formatação)
        
    Raises:
        HTTPException: Se o certificado não for encontrado
    """
    deletado = deletar_certificado_por_cnpj(db, cnpj)
    if not deletado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Certificado com CNPJ {cnpj} não encontrado"
        )


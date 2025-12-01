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
from ..models.certificado import (
    CertificadoUploadResponse, 
    CertificadoImportResponse,
    CertificadoValidacaoLoteResponse,
    CertificadoValidacaoLoteItem,
    CertificadoImportacaoLoteResponse,
    CertificadoImportacaoLoteItem
)
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


@router.post(
    "/validar-lote",
    response_model=CertificadoValidacaoLoteResponse,
    summary="Validar senha de múltiplos certificados em lote"
)
async def validar_certificados_lote(
    certificados: List[UploadFile] = File(...),
    senha: str = Form(...)
) -> CertificadoValidacaoLoteResponse:
    """
    Valida a senha de múltiplos certificados digitais em lote.
    
    Este endpoint testa uma senha única em todos os certificados fornecidos,
    retornando quais foram validados com sucesso e quais falharam.
    
    Args:
        certificados: Lista de arquivos .pfx ou .p12
        senha: Senha única para testar em todos os certificados
        
    Returns:
        CertificadoValidacaoLoteResponse com resultados da validação
    """
    resultados: List[CertificadoValidacaoLoteItem] = []
    total_sucesso = 0
    total_falha = 0
    
    # Validação da senha
    if not senha or not senha.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Senha não pode estar vazia"
        )
    
    certificate_service = get_certificate_service()
    
    # Processa cada certificado
    for certificado in certificados:
        nome_arquivo = certificado.filename or "arquivo_desconhecido"
        
        # Valida extensão do arquivo
        filename_lower = nome_arquivo.lower()
        if not (filename_lower.endswith('.pfx') or filename_lower.endswith('.p12')):
            resultados.append(
                CertificadoValidacaoLoteItem(
                    nome_arquivo=nome_arquivo,
                    sucesso=False,
                    mensagem_erro=f"Arquivo deve ser .pfx ou .p12. Recebido: {nome_arquivo}"
                )
            )
            total_falha += 1
            continue
        
        try:
            # Lê o conteúdo do arquivo
            conteudo = await certificado.read()
            
            if not conteudo:
                resultados.append(
                    CertificadoValidacaoLoteItem(
                        nome_arquivo=nome_arquivo,
                        sucesso=False,
                        mensagem_erro="Arquivo vazio ou não foi possível ler o conteúdo"
                    )
                )
                total_falha += 1
                continue
            
            # Tenta validar e extrair informações
            try:
                informacoes = certificate_service.validar_e_extrair_info(conteudo, senha, debug=False)
                
                # Se chegou aqui, a validação foi bem-sucedida
                resultados.append(
                    CertificadoValidacaoLoteItem(
                        nome_arquivo=nome_arquivo,
                        sucesso=True,
                        cnpj=informacoes.cnpj,
                        empresa=informacoes.empresa,
                        data_vencimento=informacoes.dataVencimento
                    )
                )
                total_sucesso += 1
                logger.info(f"Certificado {nome_arquivo} validado com sucesso. CNPJ: {informacoes.cnpj_limpo}")
                
            except HTTPException as e:
                # Erro de validação (senha incorreta, certificado inválido, etc.)
                resultados.append(
                    CertificadoValidacaoLoteItem(
                        nome_arquivo=nome_arquivo,
                        sucesso=False,
                        mensagem_erro=e.detail or "Erro ao validar certificado"
                    )
                )
                total_falha += 1
                logger.warning(f"Falha ao validar certificado {nome_arquivo}: {e.detail}")
                
        except Exception as e:
            # Erro inesperado
            error_msg = str(e)
            resultados.append(
                CertificadoValidacaoLoteItem(
                    nome_arquivo=nome_arquivo,
                    sucesso=False,
                    mensagem_erro=f"Erro inesperado: {error_msg}"
                )
            )
            total_falha += 1
            logger.error(f"Erro inesperado ao processar certificado {nome_arquivo}: {error_msg}", exc_info=True)
    
    return CertificadoValidacaoLoteResponse(
        total=len(certificados),
        sucesso=total_sucesso,
        falha=total_falha,
        resultados=resultados
    )


@router.post(
    "/importar-lote",
    response_model=CertificadoImportacaoLoteResponse,
    summary="Importar múltiplos certificados em lote com senha única"
)
async def importar_certificados_lote(
    certificados: List[UploadFile] = File(...),
    senha: str = Form(...)
) -> CertificadoImportacaoLoteResponse:
    """
    Importa múltiplos certificados digitais em lote usando uma senha única.
    
    Este endpoint valida a senha, extrai informações e salva cada certificado
    que for validado com sucesso. Retorna quais foram importados e quais falharam.
    
    Args:
        certificados: Lista de arquivos .pfx ou .p12
        senha: Senha única para usar em todos os certificados
        
    Returns:
        CertificadoImportacaoLoteResponse com resultados da importação
    """
    resultados: List[CertificadoImportacaoLoteItem] = []
    total_sucesso = 0
    total_falha = 0
    
    # Validação da senha
    if not senha or not senha.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Senha não pode estar vazia"
        )
    
    certificate_service = get_certificate_service()
    
    # Processa cada certificado
    for certificado in certificados:
        nome_arquivo = certificado.filename or "arquivo_desconhecido"
        
        # Valida extensão do arquivo
        filename_lower = nome_arquivo.lower()
        if not (filename_lower.endswith('.pfx') or filename_lower.endswith('.p12')):
            resultados.append(
                CertificadoImportacaoLoteItem(
                    nome_arquivo=nome_arquivo,
                    sucesso=False,
                    mensagem_erro=f"Arquivo deve ser .pfx ou .p12. Recebido: {nome_arquivo}"
                )
            )
            total_falha += 1
            continue
        
        try:
            # Lê o conteúdo do arquivo
            conteudo = await certificado.read()
            
            if not conteudo:
                resultados.append(
                    CertificadoImportacaoLoteItem(
                        nome_arquivo=nome_arquivo,
                        sucesso=False,
                        mensagem_erro="Arquivo vazio ou não foi possível ler o conteúdo"
                    )
                )
                total_falha += 1
                continue
            
            # Tenta validar e extrair informações
            try:
                informacoes = certificate_service.validar_e_extrair_info(conteudo, senha, debug=False)
                
                # Valida se CNPJ foi encontrado
                if not informacoes.cnpj_limpo:
                    resultados.append(
                        CertificadoImportacaoLoteItem(
                            nome_arquivo=nome_arquivo,
                            sucesso=False,
                            mensagem_erro="Não foi possível extrair o CNPJ do certificado. Verifique se é um certificado ICP-Brasil válido."
                        )
                    )
                    total_falha += 1
                    continue
                
                # Salva o certificado criptografado
                try:
                    certificate_service.salvar_certificado(informacoes.cnpj_limpo, conteudo, senha)
                    
                    # Salva metadados no banco de dados (se disponível)
                    try:
                        from ..db.session import get_db
                        from ..db.crud_certificado import criar_certificado, obter_certificado_por_cnpj
                        
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
                    
                    # Se chegou aqui, a importação foi bem-sucedida
                    resultados.append(
                        CertificadoImportacaoLoteItem(
                            nome_arquivo=nome_arquivo,
                            sucesso=True,
                            cnpj=informacoes.cnpj,
                            empresa=informacoes.empresa,
                            data_vencimento=informacoes.dataVencimento
                        )
                    )
                    total_sucesso += 1
                    logger.info(f"Certificado {nome_arquivo} importado com sucesso. CNPJ: {informacoes.cnpj_limpo}")
                    
                except Exception as save_error:
                    # Erro ao salvar certificado
                    resultados.append(
                        CertificadoImportacaoLoteItem(
                            nome_arquivo=nome_arquivo,
                            sucesso=False,
                            mensagem_erro=f"Erro ao salvar certificado: {str(save_error)}"
                        )
                    )
                    total_falha += 1
                    logger.error(f"Erro ao salvar certificado {nome_arquivo}: {str(save_error)}", exc_info=True)
                
            except HTTPException as e:
                # Erro de validação (senha incorreta, certificado inválido, etc.)
                resultados.append(
                    CertificadoImportacaoLoteItem(
                        nome_arquivo=nome_arquivo,
                        sucesso=False,
                        mensagem_erro=e.detail or "Erro ao validar certificado"
                    )
                )
                total_falha += 1
                logger.warning(f"Falha ao importar certificado {nome_arquivo}: {e.detail}")
                
        except Exception as e:
            # Erro inesperado
            error_msg = str(e)
            resultados.append(
                CertificadoImportacaoLoteItem(
                    nome_arquivo=nome_arquivo,
                    sucesso=False,
                    mensagem_erro=f"Erro inesperado: {error_msg}"
                )
            )
            total_falha += 1
            logger.error(f"Erro inesperado ao processar certificado {nome_arquivo}: {error_msg}", exc_info=True)
    
    return CertificadoImportacaoLoteResponse(
        total=len(certificados),
        sucesso=total_sucesso,
        falha=total_falha,
        resultados=resultados
    )


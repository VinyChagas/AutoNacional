"""
Rotas para gerenciamento de empresas.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..db.crud_empresas import (
    criar_empresa,
    obter_empresa_por_id,
    obter_empresa_por_cnpj,
    listar_empresas,
    listar_empresas_por_contabilidade,
    atualizar_empresa,
    deletar_empresa,
    verificar_cnpj_tem_certificado,
    limpar_contabilidades_orfaos,
    verificar_integridade_vinculos
)
from ..schemas.empresas import (
    EmpresaCreate,
    EmpresaUpdate,
    EmpresaResponse,
    EmpresaListResponse,
    LimpezaContabilidadesOrfaosResponse,
    VerificacaoIntegridadeResponse
)
from ..infrastructure.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/empresas", tags=["Empresas"])


@router.get("", response_model=List[EmpresaResponse], summary="Listar empresas")
def listar_empresas_endpoint(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    Lista todas as empresas cadastradas.
    
    Args:
        skip: Número de registros para pular (paginação)
        limit: Número máximo de registros para retornar
        db: Sessão do banco de dados
        
    Returns:
        Lista de empresas
    """
    try:
        empresas_orm = listar_empresas(db, skip=skip, limit=limit)
        # Converte ORM para Response com id como string
        empresas = [EmpresaResponse.from_orm_with_id_string(e) for e in empresas_orm]
        return empresas
    except Exception as e:
        logger.error(f"Erro ao listar empresas: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao listar empresas: {str(e)}"
        )


@router.get("/{empresa_id}", response_model=EmpresaResponse, summary="Obter empresa por ID")
def obter_empresa_por_id_endpoint(
    empresa_id: str,
    db: Session = Depends(get_db)
):
    """
    Busca uma empresa pelo ID.
    
    Args:
        empresa_id: ID da empresa (string do frontend, convertido para int)
        db: Sessão do banco de dados
        
    Returns:
        Empresa encontrada
        
    Raises:
        HTTPException: Se empresa não for encontrada
    """
    try:
        empresa_id_int = int(empresa_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"ID de empresa inválido: {empresa_id}"
        )
    empresa = obter_empresa_por_id(db, empresa_id_int)
    if not empresa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa com ID {empresa_id} não encontrada"
        )
    return EmpresaResponse.from_orm_with_id_string(empresa)


@router.get("/cnpj/{cnpj}", response_model=EmpresaResponse, summary="Obter empresa por CNPJ")
def obter_empresa_por_cnpj_endpoint(
    cnpj: str,
    db: Session = Depends(get_db)
):
    """
    Busca uma empresa pelo CNPJ.
    
    Args:
        cnpj: CNPJ da empresa (com ou sem formatação)
        db: Sessão do banco de dados
        
    Returns:
        Empresa encontrada
        
    Raises:
        HTTPException: Se empresa não for encontrada
    """
    empresa = obter_empresa_por_cnpj(db, cnpj)
    if not empresa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa com CNPJ {cnpj} não encontrada"
        )
    return EmpresaResponse.from_orm_with_id_string(empresa)


@router.post("", response_model=EmpresaResponse, status_code=status.HTTP_201_CREATED, summary="Criar empresa")
def criar_empresa_endpoint(
    empresa: EmpresaCreate,
    db: Session = Depends(get_db)
):
    """
    Cria uma nova empresa.
    
    Valida se o CNPJ já possui certificado digital cadastrado.
    Se possuir, retorna erro impedindo o cadastro.
    
    Args:
        empresa: Dados da empresa a ser criada
        db: Sessão do banco de dados
        
    Returns:
        Empresa criada
        
    Raises:
        HTTPException: Se CNPJ inválido, já existir ou já tiver certificado digital
    """
    try:
        # Verifica se CNPJ já tem certificado digital
        if verificar_cnpj_tem_certificado(db, empresa.cnpj):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"CNPJ {empresa.cnpj} já possui certificado digital cadastrado. "
                    f"Empresas com certificado digital não podem ser cadastradas via credenciais."
                )
            )
        
        # Cria empresa (verificar_certificado=False pois já verificamos acima)
        nova_empresa = criar_empresa(
            db=db,
            cnpj=empresa.cnpj,
            razao_social=empresa.razao_social,
            contabilidade_id=empresa.contabilidade_id,
            regime=empresa.regime,
            verificar_certificado=False  # Já verificamos acima
        )
        
        logger.info(f"Empresa criada com sucesso: ID {nova_empresa.id}, CNPJ {nova_empresa.cnpj}")
        return EmpresaResponse.from_orm_with_id_string(nova_empresa)
        
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Erro de validação ao criar empresa: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Erro ao criar empresa: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao criar empresa: {str(e)}"
        )


@router.put("/{empresa_id}", response_model=EmpresaResponse, summary="Atualizar empresa")
def atualizar_empresa_endpoint(
    empresa_id: str,
    empresa: EmpresaUpdate,
    db: Session = Depends(get_db)
):
    """
    Atualiza uma empresa existente.
    
    Args:
        empresa_id: ID da empresa (string do frontend, convertido para int)
        empresa: Dados a serem atualizados
        db: Sessão do banco de dados
        
    Returns:
        Empresa atualizada
        
    Raises:
        HTTPException: Se empresa não for encontrada
    """
    try:
        try:
            empresa_id_int = int(empresa_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID de empresa inválido: {empresa_id}"
            )
        empresa_atualizada = atualizar_empresa(
            db=db,
            empresa_id=empresa_id_int,
            razao_social=empresa.razao_social,
            contabilidade_id=empresa.contabilidade_id,
            regime=empresa.regime
        )
        
        if not empresa_atualizada:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Empresa com ID {empresa_id} não encontrada"
            )
        
        logger.info(f"Empresa atualizada com sucesso: ID {empresa_id}")
        return EmpresaResponse.from_orm_with_id_string(empresa_atualizada)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao atualizar empresa: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao atualizar empresa: {str(e)}"
        )


@router.delete("/{empresa_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Deletar empresa")
def deletar_empresa_endpoint(
    empresa_id: str,
    db: Session = Depends(get_db)
):
    """
    Deleta uma empresa.
    
    Args:
        empresa_id: ID da empresa (string do frontend, convertido para int)
        db: Sessão do banco de dados
        
    Raises:
        HTTPException: Se empresa não for encontrada
    """
    try:
        try:
            empresa_id_int = int(empresa_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID de empresa inválido: {empresa_id}"
            )
        sucesso = deletar_empresa(db, empresa_id_int)
        if not sucesso:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Empresa com ID {empresa_id} não encontrada"
            )
        
        logger.info(f"Empresa deletada com sucesso: ID {empresa_id}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao deletar empresa: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao deletar empresa: {str(e)}"
        )


@router.post(
    "/limpar-contabilidades-orfaos",
    response_model=LimpezaContabilidadesOrfaosResponse,
    summary="Limpar contabilidades órfãs"
)
def limpar_contabilidades_orfaos_endpoint(
    db: Session = Depends(get_db)
):
    """
    Remove vínculos de empresas com contabilidades que não existem mais.
    
    Esta operação:
    - Busca todas as empresas com contabilidade_id preenchido
    - Verifica se a contabilidade ainda existe no banco principal
    - Remove o vínculo (define contabilidade_id como None) se não existir
    - Retorna estatísticas da operação
    
    **Atenção**: Esta operação modifica dados no banco. Use com cuidado.
    
    Returns:
        Estatísticas da limpeza realizada
    """
    try:
        resultado = limpar_contabilidades_orfaos(db)
        logger.info(
            f"Limpeza de contabilidades órfãs concluída: "
            f"{resultado['empresas_atualizadas']} empresas atualizadas"
        )
        return LimpezaContabilidadesOrfaosResponse(**resultado)
    except Exception as e:
        logger.error(f"Erro ao limpar contabilidades órfãs: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao limpar contabilidades órfãs: {str(e)}"
        )


@router.get(
    "/verificar-integridade",
    response_model=VerificacaoIntegridadeResponse,
    summary="Verificar integridade de vínculos"
)
def verificar_integridade_vinculos_endpoint(
    db: Session = Depends(get_db)
):
    """
    Verifica a integridade dos vínculos entre empresas e contabilidades.
    
    Esta operação é somente leitura e não modifica dados. Ela:
    - Conta todas as empresas no banco
    - Verifica quais têm contabilidades vinculadas
    - Identifica empresas com contabilidades órfãs (que não existem mais)
    - Retorna estatísticas detalhadas
    
    Use este endpoint para verificar se há problemas de integridade antes
    de executar a limpeza.
    
    Returns:
        Estatísticas de integridade dos vínculos
    """
    try:
        resultado = verificar_integridade_vinculos(db)
        logger.info(
            f"Verificação de integridade concluída: "
            f"{resultado['contabilidades_orfaos']} contabilidades órfãs encontradas"
        )
        return VerificacaoIntegridadeResponse(**resultado)
    except Exception as e:
        logger.error(f"Erro ao verificar integridade de vínculos: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao verificar integridade: {str(e)}"
        )


@router.get(
    "/contabilidades-orfaos",
    response_model=List[dict],
    summary="Listar empresas com contabilidades órfãs"
)
def listar_empresas_com_contabilidades_orfaos_endpoint(
    db: Session = Depends(get_db)
):
    """
    Lista empresas que têm contabilidades órfãs (contabilidades que não existem mais).
    
    Esta operação é somente leitura e retorna apenas empresas com problemas
    de integridade. Use em conjunto com o endpoint de verificação de integridade.
    
    Returns:
        Lista de empresas com contabilidades órfãs
    """
    try:
        resultado = verificar_integridade_vinculos(db)
        return resultado['empresas_orfaos']
    except Exception as e:
        logger.error(f"Erro ao listar empresas com contabilidades órfãs: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao listar empresas: {str(e)}"
        )


@router.get(
    "/contabilidade/{contabilidade_id}",
    response_model=List[EmpresaResponse],
    summary="Listar empresas por contabilidade"
)
def listar_empresas_por_contabilidade_endpoint(
    contabilidade_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    Lista empresas vinculadas a uma contabilidade específica.
    
    Args:
        contabilidade_id: ID da contabilidade
        skip: Número de registros para pular (paginação)
        limit: Número máximo de registros para retornar
        db: Sessão do banco de dados
        
    Returns:
        Lista de empresas vinculadas à contabilidade
    """
    try:
        empresas_orm = listar_empresas_por_contabilidade(db, contabilidade_id, skip=skip, limit=limit)
        empresas = [EmpresaResponse.from_orm_with_id_string(e) for e in empresas_orm]
        return empresas
    except Exception as e:
        logger.error(f"Erro ao listar empresas por contabilidade: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao listar empresas: {str(e)}"
        )

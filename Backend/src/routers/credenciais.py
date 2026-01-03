"""
Rotas para gerenciamento de credenciais de login.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Body
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..db.session import get_db
from ..db.crud_credenciais import (
    criar_ou_atualizar_credencial,
    obter_credenciais_por_empresa,
    obter_credencial_por_id,
    atualizar_status_credencial,
    deletar_credencial,
    atualizar_credencial
)
from ..schemas.credenciais import (
    CredencialCreate,
    CredencialUpdate,
    CredencialResponse,
    CredencialListResponse
)
from ..db.models import TipoCredencialEnum
from ..infrastructure.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/credenciais", tags=["Credenciais"])


class SenhaAdminRequest(BaseModel):
    """Schema para requisição de senha admin."""
    senha_admin: str


@router.get("/empresa/{empresa_id}", response_model=CredencialListResponse, summary="Obter credenciais por empresa")
def obter_credenciais_por_empresa_endpoint(
    empresa_id: str,
    db: Session = Depends(get_db)
):
    """
    Busca todas as credenciais de uma empresa.
    
    Args:
        empresa_id: ID da empresa (string do frontend, convertido para int)
        db: Sessão do banco de dados
        
    Returns:
        Lista de credenciais da empresa
    """
    try:
        try:
            empresa_id_int = int(empresa_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID de empresa inválido: {empresa_id}"
            )
        credenciais_orm = obter_credenciais_por_empresa(db, empresa_id_int)
        # Converte ORM para Response
        credenciais = [CredencialResponse.from_orm_with_tipo(c) for c in credenciais_orm]
        return CredencialListResponse(
            credenciais=credenciais,
            total=len(credenciais)
        )
    except Exception as e:
        logger.error(f"Erro ao obter credenciais da empresa {empresa_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao obter credenciais: {str(e)}"
        )


@router.post("", response_model=CredencialResponse, status_code=status.HTTP_201_CREATED, summary="Criar ou atualizar credencial")
def criar_ou_atualizar_credencial_endpoint(
    credencial: CredencialCreate,
    db: Session = Depends(get_db)
):
    """
    Cria ou atualiza uma credencial de login.
    
    Se já existir uma credencial com mesmo empresa_id, tipo e usuario, atualiza.
    Caso contrário, cria uma nova.
    
    Args:
        credencial: Dados da credencial
        db: Sessão do banco de dados
        
    Returns:
        Credencial criada ou atualizada
        
    Raises:
        HTTPException: Se dados inválidos ou empresa não existir
    """
    try:
        # Converte tipo_login do frontend (cpf/cnpj) para TipoCredencialEnum
        tipo_login_lower = credencial.tipo_login.lower()
        if tipo_login_lower in ['cnpj', 'cnpj_senha']:
            tipo_enum_str = "CNPJ_SENHA"
        elif tipo_login_lower in ['cpf', 'cpf_senha']:
            tipo_enum_str = "CPF_SENHA"
        else:
            raise ValueError(f"Tipo de login inválido: {credencial.tipo_login}. Use 'cnpj' ou 'cpf'")
        
        credencial_criada = criar_ou_atualizar_credencial(
            db=db,
            empresa_id=credencial.empresa_id,
            tipo=tipo_enum_str,
            usuario=credencial.usuario,
            senha=credencial.senha
        )
        
        logger.info(f"Credencial criada/atualizada com sucesso: ID {credencial_criada.id}")
        return CredencialResponse.from_orm_with_tipo(credencial_criada)
        
    except ValueError as e:
        logger.warning(f"Erro de validação ao criar/atualizar credencial: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Erro ao criar/atualizar credencial: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao criar/atualizar credencial: {str(e)}"
        )


@router.put("/{credencial_id}/status", response_model=CredencialResponse, summary="Atualizar status da credencial")
def atualizar_status_credencial_endpoint(
    credencial_id: int,
    status_novo: str,
    sucesso: bool = True,
    db: Session = Depends(get_db)
):
    """
    Atualiza o status de uma credencial após teste.
    
    Args:
        credencial_id: ID da credencial
        status_novo: Novo status (OK, INVALIDA, BLOQUEADA)
        sucesso: Se True, marca como OK; se False, marca como INVALIDA
        db: Sessão do banco de dados
        
    Returns:
        Credencial atualizada
        
    Raises:
        HTTPException: Se credencial não for encontrada
    """
    try:
        credencial_atualizada = atualizar_status_credencial(
            db=db,
            credencial_id=credencial_id,
            status=status_novo,
            sucesso=sucesso
        )
        
        if not credencial_atualizada:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credencial com ID {credencial_id} não encontrada"
            )
        
        logger.info(f"Status da credencial atualizado: ID {credencial_id}, Status {status_novo}")
        return CredencialResponse.from_orm_with_tipo(credencial_atualizada)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao atualizar status da credencial: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao atualizar status: {str(e)}"
        )


@router.put("/{credencial_id}", response_model=CredencialResponse, summary="Atualizar credencial")
def atualizar_credencial_endpoint(
    credencial_id: int,
    credencial: CredencialUpdate,
    db: Session = Depends(get_db)
):
    """
    Atualiza uma credencial existente.
    
    Args:
        credencial_id: ID da credencial
        credencial: Dados a serem atualizados
        db: Sessão do banco de dados
        
    Returns:
        Credencial atualizada
        
    Raises:
        HTTPException: Se credencial não for encontrada
    """
    try:
        credencial_atualizada = atualizar_credencial(
            db=db,
            credencial_id=credencial_id,
            senha=credencial.senha
        )
        
        if not credencial_atualizada:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credencial com ID {credencial_id} não encontrada"
            )
        
        logger.info(f"Credencial atualizada com sucesso: ID {credencial_id}")
        return CredencialResponse.from_orm_with_tipo(credencial_atualizada)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao atualizar credencial: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao atualizar credencial: {str(e)}"
        )


@router.delete("/{credencial_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Deletar credencial")
def deletar_credencial_endpoint(
    credencial_id: int,
    db: Session = Depends(get_db)
):
    """
    Deleta uma credencial.
    
    Args:
        credencial_id: ID da credencial
        db: Sessão do banco de dados
        
    Raises:
        HTTPException: Se credencial não for encontrada
    """
    try:
        sucesso = deletar_credencial(db, credencial_id)
        if not sucesso:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credencial com ID {credencial_id} não encontrada"
            )
        
        logger.info(f"Credencial deletada com sucesso: ID {credencial_id}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao deletar credencial: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao deletar credencial: {str(e)}"
        )


@router.post("/{credencial_id}/obter-senha", summary="Obter senha descriptografada (requer senha admin)")
def obter_senha_credencial_endpoint(
    credencial_id: int,
    request: SenhaAdminRequest = Body(...),
    db: Session = Depends(get_db)
):
    """
    Retorna a senha descriptografada de uma credencial após validação de senha admin.
    
    Args:
        credencial_id: ID da credencial
        request: Requisição com senha_admin
        db: Sessão do banco de dados
        
    Returns:
        Senha descriptografada
        
    Raises:
        HTTPException: Se credencial não for encontrada ou senha admin incorreta
    """
    try:
        # Valida senha admin
        if request.senha_admin != 'Admin123@':
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Senha de administrador incorreta"
            )
        
        credencial = obter_credencial_por_id(db, credencial_id)
        if not credencial:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credencial com ID {credencial_id} não encontrada"
            )
        
        # Descriptografa a senha
        from ..db.crud_credenciais import decrypt_password
        senha_descriptografada = decrypt_password(credencial.senha_criptografada)
        
        logger.info(f"Senha obtida para credencial ID {credencial_id} (admin autenticado)")
        
        return {
            "senha": senha_descriptografada
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao obter senha da credencial: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao obter senha: {str(e)}"
        )


@router.post("/{credencial_id}/obter-senha", summary="Obter senha descriptografada (requer senha admin)")
def obter_senha_credencial_endpoint(
    credencial_id: int,
    request: SenhaAdminRequest = Body(...),
    db: Session = Depends(get_db)
):
    """
    Retorna a senha descriptografada de uma credencial após validação de senha admin.
    
    Args:
        credencial_id: ID da credencial
        request: Requisição com senha_admin
        db: Sessão do banco de dados
        
    Returns:
        Senha descriptografada
        
    Raises:
        HTTPException: Se credencial não for encontrada ou senha admin incorreta
    """
    try:
        # Valida senha admin
        if request.senha_admin != 'Admin123@':
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Senha de administrador incorreta"
            )
        
        credencial = obter_credencial_por_id(db, credencial_id)
        if not credencial:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credencial com ID {credencial_id} não encontrada"
            )
        
        # Descriptografa a senha
        from ..db.crud_credenciais import decrypt_password
        senha_descriptografada = decrypt_password(credencial.senha_criptografada)
        
        logger.info(f"Senha obtida para credencial ID {credencial_id} (admin autenticado)")
        
        return {
            "senha": senha_descriptografada
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao obter senha da credencial: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao obter senha: {str(e)}"
        )


@router.post("/empresa/{empresa_id}/validar", summary="Validar credenciais")
def validar_credenciais_endpoint(
    empresa_id: str,
    cnpj: str = None,
    db: Session = Depends(get_db)
):
    """
    Valida credenciais de uma empresa executando automação de login.
    
    TODO: Implementar automação de validação de credenciais
    
    Args:
        empresa_id: ID da empresa (string do frontend, convertido para int)
        cnpj: CNPJ da empresa (para validação, opcional)
        db: Sessão do banco de dados
        
    Returns:
        Resultado da validação
        
    Raises:
        HTTPException: Se empresa não for encontrada ou credenciais inválidas
    """
    try:
        try:
            empresa_id_int = int(empresa_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID de empresa inválido: {empresa_id}"
            )
        # Verifica se empresa existe
        from ..db.crud_empresas import obter_empresa_por_id
        empresa = obter_empresa_por_id(db, empresa_id_int)
        if not empresa:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Empresa com ID {empresa_id} não encontrada"
            )
        
        # Busca credenciais da empresa
        credenciais = obter_credenciais_por_empresa(db, empresa_id_int)
        if not credenciais:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Nenhuma credencial encontrada para empresa ID {empresa_id}"
            )
        
        # TODO: Implementar automação de validação de credenciais
        # Por enquanto, retorna sucesso simulado
        logger.info(f"Validação de credenciais solicitada para empresa ID {empresa_id_int}")
        
        return {
            "success": True,
            "message": "Validação de credenciais ainda não implementada. Esta funcionalidade será disponibilizada em breve."
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao validar credenciais: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao validar credenciais: {str(e)}"
        )

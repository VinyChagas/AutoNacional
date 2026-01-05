"""
Rotas para gerenciamento de credenciais de login.
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Body, Query, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
import openpyxl
from io import BytesIO

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
from ..schemas.empresas import EmpresaCreate
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
async def validar_credenciais_endpoint(
    empresa_id: str,
    cnpj: str = Query(None, description="CNPJ da empresa (opcional)"),
    headless: bool = Query(False, description="Executar navegador em modo headless"),
    db: Session = Depends(get_db)
):
    """
    Valida credenciais de uma empresa executando automação de login com Playwright.
    
    Usa o módulo playwright_nfse_credenciais.py para realizar login no portal NFSe
    e verificar se as credenciais são válidas.
    
    Args:
        empresa_id: ID da empresa (string do frontend, convertido para int)
        cnpj: CNPJ da empresa (para validação, opcional)
        headless: Se True, executa navegador em modo headless
        db: Sessão do banco de dados
        
    Returns:
        Resultado da validação com sucesso, mensagem e logs
        
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
        
        # Usa o CNPJ da empresa para validação
        cnpj_empresa = empresa.cnpj
        if not cnpj_empresa:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Empresa ID {empresa_id} não possui CNPJ cadastrado"
            )
        
        # Importa e executa validação usando playwright_nfse_credenciais
        import sys
        import os
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        scripts_path = os.path.join(backend_dir, "scripts", "automation")
        if scripts_path not in sys.path:
            sys.path.insert(0, scripts_path)
        
        try:
            from playwright_nfse_credenciais import abrir_dashboard_nfse_com_credenciais, NFSeAutenticacaoError
            
            logger.info(f"Iniciando validação de credenciais para empresa ID {empresa_id_int} (CNPJ: {cnpj_empresa})")
            
            # Executa automação de login
            resultado = await abrir_dashboard_nfse_com_credenciais(
                cnpj=cnpj_empresa,
                headless=headless,
                timeout=30000
            )
            
            # Limpa recursos do Playwright após validação
            try:
                if resultado.get("page"):
                    await resultado["page"].close()
                if resultado.get("context"):
                    await resultado["context"].close()
                if resultado.get("browser"):
                    await resultado["browser"].close()
                if resultado.get("playwright"):
                    await resultado["playwright"].stop()
            except Exception as cleanup_error:
                logger.warning(f"Erro ao limpar recursos do Playwright: {cleanup_error}")
            
            # Atualiza status da credencial no banco
            if resultado.get("sucesso"):
                credencial = credenciais[0]  # Usa a primeira credencial
                atualizar_status_credencial(
                    db=db,
                    credencial_id=credencial.id,
                    status="OK",
                    sucesso=True
                )
                logger.info(f"Credenciais validadas com sucesso para empresa ID {empresa_id_int}")
            else:
                credencial = credenciais[0]
                atualizar_status_credencial(
                    db=db,
                    credencial_id=credencial.id,
                    status="INVALIDA",
                    sucesso=False
                )
                logger.warning(f"Validação de credenciais falhou para empresa ID {empresa_id_int}")
            
            return {
                "success": resultado.get("sucesso", False),
                "message": resultado.get("mensagem", "Validação concluída"),
                "url_atual": resultado.get("url_atual", ""),
                "titulo": resultado.get("titulo", ""),
                "logs": resultado.get("logs", [])
            }
            
        except NFSeAutenticacaoError as e:
            # Atualiza status como inválida
            credencial = credenciais[0]
            atualizar_status_credencial(
                db=db,
                credencial_id=credencial.id,
                status="INVALIDA",
                sucesso=False
            )
            logger.error(f"Erro de autenticação ao validar credenciais: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Credenciais inválidas: {str(e)}"
            )
        except ImportError as e:
            logger.error(f"Erro ao importar playwright_nfse_credenciais: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Erro ao importar módulo de automação: {str(e)}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao validar credenciais: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao validar credenciais: {str(e)}"
        )


class ValidacaoLoteRequest(BaseModel):
    """Schema para requisição de validação em lote."""
    empresa_ids: List[str]
    headless: bool = False


class ResultadoValidacao(BaseModel):
    """Schema para resultado de validação individual."""
    empresa_id: str
    cnpj: str
    razao_social: str
    sucesso: bool
    mensagem: str
    erro: str = None


class ValidacaoLoteResponse(BaseModel):
    """Schema para resposta de validação em lote."""
    total: int
    sucesso: int
    falhas: int
    resultados: List[Dict[str, Any]]


@router.post("/validar-lote", response_model=ValidacaoLoteResponse, summary="Validar múltiplas credenciais em lote")
async def validar_credenciais_lote_endpoint(
    request: ValidacaoLoteRequest = Body(...),
    db: Session = Depends(get_db)
):
    """
    Valida credenciais de múltiplas empresas em lote usando automação Playwright.
    
    Executa validação com controle de concorrência baseado nas configurações do sistema.
    Respeita o limite de navegadores simultâneos configurado em default_concurrent_browsers.
    Cada validação atualiza o status da credencial no banco de dados.
    
    Args:
        request: Requisição com lista de empresa_ids e flag headless
        db: Sessão do banco de dados
        
    Returns:
        ValidacaoLoteResponse com resultados de todas as validações
        
    Raises:
        HTTPException: Se houver erro ao processar validações
    """
    try:
        import sys
        import os
        import asyncio
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        scripts_path = os.path.join(backend_dir, "scripts", "automation")
        if scripts_path not in sys.path:
            sys.path.insert(0, scripts_path)
        
        from playwright_nfse_credenciais import abrir_dashboard_nfse_com_credenciais, NFSeAutenticacaoError
        from ..db.crud_empresas import obter_empresa_por_id
        from ..db.crud_settings import obter_configuracoes
        
        # Obtém limite de concorrência das configurações
        configuracoes = obter_configuracoes(db)
        limite_concorrencia = 3  # Padrão
        if configuracoes:
            limite_concorrencia = configuracoes.default_concurrent_browsers or 3
            # Respeita max_concurrent_browsers como limite máximo absoluto
            if configuracoes.max_concurrent_browsers and limite_concorrencia > configuracoes.max_concurrent_browsers:
                limite_concorrencia = configuracoes.max_concurrent_browsers
        
        logger.info(f"Iniciando validação em lote de {len(request.empresa_ids)} empresas (headless={request.headless}, limite_concorrencia={limite_concorrencia})")
        
        # Cria semáforo para controlar concorrência
        semaphore = asyncio.Semaphore(limite_concorrencia)
        resultados = []
        sucesso_count = 0
        falhas_count = 0
        
        async def validar_empresa(empresa_id_str: str):
            """Função assíncrona para validar uma empresa com controle de concorrência."""
            async with semaphore:  # Controla concorrência
                nonlocal sucesso_count, falhas_count
                
                try:
                    empresa_id_int = int(empresa_id_str)
                except ValueError:
                    resultados.append({
                        "empresa_id": empresa_id_str,
                        "cnpj": "",
                        "razao_social": "",
                        "sucesso": False,
                        "mensagem": "ID de empresa inválido",
                        "erro": f"ID inválido: {empresa_id_str}"
                    })
                    falhas_count += 1
                    return
                
                empresa = None
                credenciais = None
                
                try:
                    # Busca empresa
                    empresa = obter_empresa_por_id(db, empresa_id_int)
                    if not empresa:
                        resultados.append({
                            "empresa_id": empresa_id_str,
                            "cnpj": "",
                            "razao_social": "",
                            "sucesso": False,
                            "mensagem": "Empresa não encontrada",
                            "erro": f"Empresa ID {empresa_id_str} não encontrada"
                        })
                        falhas_count += 1
                        return
                    
                    # Busca credenciais
                    credenciais = obter_credenciais_por_empresa(db, empresa_id_int)
                    if not credenciais:
                        resultados.append({
                            "empresa_id": empresa_id_str,
                            "cnpj": empresa.cnpj or "",
                            "razao_social": empresa.razao_social or "",
                            "sucesso": False,
                            "mensagem": "Nenhuma credencial encontrada",
                            "erro": "Nenhuma credencial cadastrada"
                        })
                        falhas_count += 1
                        return
                    
                    cnpj_empresa = empresa.cnpj
                    if not cnpj_empresa:
                        resultados.append({
                            "empresa_id": empresa_id_str,
                            "cnpj": "",
                            "razao_social": empresa.razao_social or "",
                            "sucesso": False,
                            "mensagem": "CNPJ não cadastrado",
                            "erro": "Empresa não possui CNPJ cadastrado"
                        })
                        falhas_count += 1
                        return
                    
                    # Executa validação
                    logger.info(f"Validando credenciais para empresa ID {empresa_id_int} (CNPJ: {cnpj_empresa})")
                    resultado = await abrir_dashboard_nfse_com_credenciais(
                        cnpj=cnpj_empresa,
                        headless=request.headless,
                        timeout=30000
                    )
                    
                    # Limpa recursos do Playwright
                    try:
                        if resultado.get("page"):
                            await resultado["page"].close()
                        if resultado.get("context"):
                            await resultado["context"].close()
                        if resultado.get("browser"):
                            await resultado["browser"].close()
                        if resultado.get("playwright"):
                            await resultado["playwright"].stop()
                    except Exception as cleanup_error:
                        logger.warning(f"Erro ao limpar recursos: {cleanup_error}")
                    
                    # Atualiza status no banco
                    credencial = credenciais[0]
                    if resultado.get("sucesso"):
                        atualizar_status_credencial(
                            db=db,
                            credencial_id=credencial.id,
                            status="OK",
                            sucesso=True
                        )
                        sucesso_count += 1
                        mensagem = "Credenciais válidas"
                    else:
                        atualizar_status_credencial(
                            db=db,
                            credencial_id=credencial.id,
                            status="INVALIDA",
                            sucesso=False
                        )
                        falhas_count += 1
                        mensagem = resultado.get("mensagem", "Validação falhou")
                    
                    resultados.append({
                        "empresa_id": empresa_id_str,
                        "cnpj": cnpj_empresa,
                        "razao_social": empresa.razao_social or "",
                        "sucesso": resultado.get("sucesso", False),
                        "mensagem": mensagem,
                        "erro": None if resultado.get("sucesso") else resultado.get("mensagem", "Erro desconhecido")
                    })
                    
                except NFSeAutenticacaoError as e:
                    # Atualiza status como inválida
                    if empresa and credenciais:
                        credencial = credenciais[0]
                        atualizar_status_credencial(
                            db=db,
                            credencial_id=credencial.id,
                            status="INVALIDA",
                            sucesso=False
                        )
                    
                    resultados.append({
                        "empresa_id": empresa_id_str,
                        "cnpj": empresa.cnpj if empresa else "",
                        "razao_social": empresa.razao_social if empresa else "",
                        "sucesso": False,
                        "mensagem": "Credenciais inválidas",
                        "erro": str(e)
                    })
                    falhas_count += 1
                    
                except Exception as e:
                    logger.error(f"Erro ao validar empresa ID {empresa_id_str}: {e}", exc_info=True)
                    resultados.append({
                        "empresa_id": empresa_id_str,
                        "cnpj": empresa.cnpj if empresa else "",
                        "razao_social": empresa.razao_social if empresa else "",
                        "sucesso": False,
                        "mensagem": "Erro ao validar",
                        "erro": str(e)
                    })
                    falhas_count += 1
        
        # Executa todas as validações com controle de concorrência
        tasks = [validar_empresa(empresa_id_str) for empresa_id_str in request.empresa_ids]
        await asyncio.gather(*tasks)
        
        logger.info(f"Validação em lote concluída: {sucesso_count} sucesso(s), {falhas_count} falha(s)")
        
        return ValidacaoLoteResponse(
            total=len(request.empresa_ids),
            sucesso=sucesso_count,
            falhas=falhas_count,
            resultados=resultados
        )
        
    except ImportError as e:
        logger.error(f"Erro ao importar playwright_nfse_credenciais: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao importar módulo de automação: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Erro ao validar credenciais em lote: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao validar credenciais em lote: {str(e)}"
        )


class LinhaPlanilha(BaseModel):
    """Schema para uma linha da planilha."""
    linha_numero: int
    razao_social: Optional[str] = None
    tipo_login: Optional[str] = None
    cnpj_ou_cpf: Optional[str] = None
    senha: Optional[str] = None
    regime_tributario: Optional[str] = None
    erros: List[str] = []


class ValidacaoPlanilhaResponse(BaseModel):
    """Schema para resposta de validação de planilha."""
    total_linhas: int
    linhas_validas: int
    linhas_com_erro: int
    linhas: List[Dict[str, Any]]


class ImportacaoPlanilhaRequest(BaseModel):
    """Schema para requisição de importação de planilha."""
    linhas_validas: List[Dict[str, Any]]
    contabilidade_id: Optional[int] = None


class ResultadoImportacao(BaseModel):
    """Schema para resultado de importação individual."""
    linha_numero: int
    razao_social: str
    sucesso: bool
    empresa_id: Optional[str] = None
    credencial_id: Optional[int] = None
    erro: Optional[str] = None


class ImportacaoPlanilhaResponse(BaseModel):
    """Schema para resposta de importação de planilha."""
    total_processadas: int
    sucesso: int
    falhas: int
    resultados: List[Dict[str, Any]]


def processar_planilha_excel(arquivo: BytesIO) -> List[LinhaPlanilha]:
    """
    Processa arquivo Excel e retorna lista de linhas.
    
    Ignora as duas primeiras linhas (cabeçalhos).
    Colunas esperadas: A=Razão Social, B=Tipo de Login, C=CNPJ ou CPF, D=Senha, E=Regime Tributário
    """
    workbook = openpyxl.load_workbook(arquivo, data_only=True)
    sheet = workbook.active
    
    linhas = []
    
    # Começa da linha 3 (ignora linhas 1 e 2)
    for row_num in range(3, sheet.max_row + 1):
        row = sheet[row_num]
        
        razao_social = str(row[0].value).strip() if row[0].value is not None else ""
        tipo_login = str(row[1].value).strip() if row[1].value is not None else ""
        cnpj_ou_cpf = str(row[2].value).strip() if row[2].value is not None else ""
        senha = str(row[3].value).strip() if row[3].value is not None else ""
        regime_tributario = str(row[4].value).strip() if row[4].value is not None else ""
        
        # Ignora linhas completamente vazias
        if not any([razao_social, tipo_login, cnpj_ou_cpf, senha, regime_tributario]):
            continue
        
        linha = LinhaPlanilha(
            linha_numero=row_num,
            razao_social=razao_social if razao_social else None,
            tipo_login=tipo_login.lower() if tipo_login else None,
            cnpj_ou_cpf=cnpj_ou_cpf.replace(".", "").replace("/", "").replace("-", "").strip() if cnpj_ou_cpf else None,
            senha=senha if senha else None,
            regime_tributario=regime_tributario if regime_tributario else None
        )
        
        linhas.append(linha)
    
    return linhas


def validar_linha_planilha(linha: LinhaPlanilha) -> List[str]:
    """
    Valida uma linha da planilha e retorna lista de erros.
    """
    erros = []
    
    if not linha.razao_social or linha.razao_social == "None":
        erros.append("Razão Social não preenchida")
    
    if not linha.tipo_login or linha.tipo_login == "None":
        erros.append("Tipo de Login não preenchido")
    else:
        tipo_login_normalizado = linha.tipo_login.lower().strip()
        if tipo_login_normalizado not in ['cpf', 'cnpj']:
            erros.append(f"Tipo de Login inválido: '{linha.tipo_login}'. Deve ser 'CPF' ou 'CNPJ'")
        else:
            # Normaliza o tipo de login
            linha.tipo_login = tipo_login_normalizado
    
    if not linha.cnpj_ou_cpf or linha.cnpj_ou_cpf == "None":
        erros.append("CNPJ ou CPF não preenchido")
    else:
        cnpj_cpf_limpo = linha.cnpj_ou_cpf.replace(".", "").replace("/", "").replace("-", "").strip()
        if linha.tipo_login == 'cpf' and len(cnpj_cpf_limpo) != 11:
            erros.append(f"CPF deve conter 11 dígitos (encontrado: {len(cnpj_cpf_limpo)})")
        elif linha.tipo_login == 'cnpj' and len(cnpj_cpf_limpo) != 14:
            erros.append(f"CNPJ deve conter 14 dígitos (encontrado: {len(cnpj_cpf_limpo)})")
    
    if not linha.senha or linha.senha == "None":
        erros.append("Senha não preenchida")
    
    if not linha.regime_tributario or linha.regime_tributario == "None":
        erros.append("Regime Tributário não preenchido")
    
    return erros


@router.post("/importar-planilha/validar", response_model=ValidacaoPlanilhaResponse, summary="Validar planilha de importação")
async def validar_planilha_importacao(
    arquivo: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Valida uma planilha Excel para importação de empresas e credenciais.
    
    Formato esperado:
    - Linhas 1 e 2: Cabeçalhos (ignoradas)
    - A partir da linha 3: Dados
    - Colunas: A=Razão Social, B=Tipo de Login, C=CNPJ ou CPF, D=Senha, E=Regime Tributário
    
    Retorna lista de linhas com erros encontrados.
    """
    try:
        # Lê o arquivo
        conteudo = await arquivo.read()
        arquivo_bytes = BytesIO(conteudo)
        
        # Processa planilha
        linhas = processar_planilha_excel(arquivo_bytes)
        
        if not linhas:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Planilha não contém dados válidos (após ignorar cabeçalhos)"
            )
        
        # Valida cada linha
        linhas_validadas = []
        linhas_validas_count = 0
        linhas_com_erro_count = 0
        
        for linha in linhas:
            erros = validar_linha_planilha(linha)
            linha.erros = erros
            
            # Para linhas válidas, retorna senha original (necessária para importação)
            # Para linhas com erro, mascara a senha por segurança
            senha_retorno = linha.senha if len(erros) == 0 else ("***" if linha.senha else None)
            
            linha_dict = {
                "linha_numero": linha.linha_numero,
                "razao_social": linha.razao_social,
                "tipo_login": linha.tipo_login,
                "cnpj_ou_cpf": linha.cnpj_ou_cpf,
                "senha": senha_retorno,
                "regime_tributario": linha.regime_tributario,
                "erros": erros,
                "valida": len(erros) == 0
            }
            
            linhas_validadas.append(linha_dict)
            
            if len(erros) == 0:
                linhas_validas_count += 1
            else:
                linhas_com_erro_count += 1
        
        logger.info(f"Validação de planilha concluída: {linhas_validas_count} válidas, {linhas_com_erro_count} com erro")
        
        return ValidacaoPlanilhaResponse(
            total_linhas=len(linhas_validadas),
            linhas_validas=linhas_validas_count,
            linhas_com_erro=linhas_com_erro_count,
            linhas=linhas_validadas
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao validar planilha: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao validar planilha: {str(e)}"
        )


@router.post("/importar-planilha", response_model=ImportacaoPlanilhaResponse, summary="Importar planilha de empresas e credenciais")
async def importar_planilha(
    request: ImportacaoPlanilhaRequest = Body(...),
    db: Session = Depends(get_db)
):
    """
    Importa empresas e credenciais a partir de linhas validadas da planilha.
    
    Cria empresas e credenciais apenas para linhas válidas.
    Se contabilidade_id for fornecido, vincula todas as empresas a essa contabilidade.
    """
    try:
        from ..db.crud_empresas import criar_empresa, verificar_cnpj_tem_certificado
        
        resultados = []
        sucesso_count = 0
        falhas_count = 0
        
        logger.info(f"Iniciando importação de {len(request.linhas_validas)} linhas válidas")
        
        for linha_data in request.linhas_validas:
            linha_numero = linha_data.get("linha_numero")
            razao_social = linha_data.get("razao_social")
            tipo_login = linha_data.get("tipo_login")
            cnpj_ou_cpf = linha_data.get("cnpj_ou_cpf")
            senha = linha_data.get("senha")
            regime_tributario = linha_data.get("regime_tributario")
            
            try:
                # Valida novamente (segurança)
                linha_temp = LinhaPlanilha(
                    linha_numero=linha_numero,
                    razao_social=razao_social,
                    tipo_login=tipo_login,
                    cnpj_ou_cpf=cnpj_ou_cpf,
                    senha=senha,
                    regime_tributario=regime_tributario
                )
                erros = validar_linha_planilha(linha_temp)
                
                if erros:
                    resultados.append({
                        "linha_numero": linha_numero,
                        "razao_social": razao_social,
                        "sucesso": False,
                        "empresa_id": None,
                        "credencial_id": None,
                        "erro": "; ".join(erros)
                    })
                    falhas_count += 1
                    continue
                
                # Normaliza CNPJ/CPF
                cnpj_cpf_limpo = cnpj_ou_cpf.replace(".", "").replace("/", "").replace("-", "").strip()
                
                # Se for CPF, converte para CNPJ (pad com zeros à esquerda)
                if tipo_login == 'cpf':
                    cnpj_para_empresa = cnpj_cpf_limpo.zfill(14)
                else:
                    cnpj_para_empresa = cnpj_cpf_limpo
                
                # Verifica se CNPJ já tem certificado digital
                if verificar_cnpj_tem_certificado(db, cnpj_para_empresa):
                    resultados.append({
                        "linha_numero": linha_numero,
                        "razao_social": razao_social,
                        "sucesso": False,
                        "empresa_id": None,
                        "credencial_id": None,
                        "erro": f"CNPJ {cnpj_para_empresa} já possui certificado digital cadastrado"
                    })
                    falhas_count += 1
                    continue
                
                # Verifica se empresa já existe e tem credenciais - se sim, deleta as credenciais antigas
                from ..db.crud_empresas import obter_empresa_por_cnpj
                from ..db.crud_credenciais import deletar_credenciais_por_empresa
                empresa_existente = obter_empresa_por_cnpj(db, cnpj_para_empresa)
                
                if empresa_existente:
                    # Verifica se tem credenciais e deleta se necessário
                    credenciais_existentes = obter_credenciais_por_empresa(db, empresa_existente.id)
                    if credenciais_existentes:
                        logger.info(f"Empresa CNPJ {cnpj_para_empresa} já existe com {len(credenciais_existentes)} credencial(is). Deletando credenciais antigas para permitir nova importação.")
                        deletar_credenciais_por_empresa(db, empresa_existente.id)
                        # Commit para garantir que a exclusão seja persistida antes de criar nova credencial
                        db.commit()
                        logger.info(f"Credenciais antigas deletadas e commitadas para empresa CNPJ {cnpj_para_empresa}")
                
                # Cria ou atualiza empresa
                empresa_data = EmpresaCreate(
                    cnpj=cnpj_para_empresa,
                    razao_social=razao_social,
                    regime=regime_tributario,
                    contabilidade_id=request.contabilidade_id
                )
                
                nova_empresa = criar_empresa(
                    db=db,
                    cnpj=empresa_data.cnpj,
                    razao_social=empresa_data.razao_social,
                    contabilidade_id=empresa_data.contabilidade_id,
                    regime=empresa_data.regime,
                    verificar_certificado=False,  # Já verificamos acima
                    permitir_atualizar_com_credenciais=True  # Permite atualizar mesmo se ainda houver credenciais (já deletamos acima)
                )
                
                # Cria credencial
                credencial_data = CredencialCreate(
                    empresa_id=str(nova_empresa.id),
                    usuario=cnpj_cpf_limpo,
                    senha=senha,
                    tipo_login=tipo_login,
                    portal="nfse_nacional"
                )
                
                credencial_criada = criar_ou_atualizar_credencial(
                    db=db,
                    empresa_id=credencial_data.empresa_id,
                    tipo="CPF_SENHA" if tipo_login == 'cpf' else "CNPJ_SENHA",
                    usuario=credencial_data.usuario,
                    senha=credencial_data.senha
                )
                
                resultados.append({
                    "linha_numero": linha_numero,
                    "razao_social": razao_social,
                    "sucesso": True,
                    "empresa_id": str(nova_empresa.id),
                    "credencial_id": credencial_criada.id,
                    "erro": None
                })
                sucesso_count += 1
                
                logger.info(f"Linha {linha_numero} importada com sucesso: Empresa ID {nova_empresa.id}")
                
            except ValueError as e:
                resultados.append({
                    "linha_numero": linha_numero,
                    "razao_social": razao_social,
                    "sucesso": False,
                    "empresa_id": None,
                    "credencial_id": None,
                    "erro": str(e)
                })
                falhas_count += 1
                logger.warning(f"Erro ao importar linha {linha_numero}: {e}")
                
            except Exception as e:
                resultados.append({
                    "linha_numero": linha_numero,
                    "razao_social": razao_social,
                    "sucesso": False,
                    "empresa_id": None,
                    "credencial_id": None,
                    "erro": f"Erro inesperado: {str(e)}"
                })
                falhas_count += 1
                logger.error(f"Erro inesperado ao importar linha {linha_numero}: {e}", exc_info=True)
        
        logger.info(f"Importação concluída: {sucesso_count} sucesso(s), {falhas_count} falha(s)")
        
        return ImportacaoPlanilhaResponse(
            total_processadas=len(request.linhas_validas),
            sucesso=sucesso_count,
            falhas=falhas_count,
            resultados=resultados
        )
        
    except Exception as e:
        logger.error(f"Erro ao importar planilha: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao importar planilha: {str(e)}"
        )

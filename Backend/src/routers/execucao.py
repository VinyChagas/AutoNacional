"""
Endpoints FastAPI para execução orquestrada de automações NFSe.

Este módulo fornece endpoints REST para executar o fluxo completo de automação
do portal NFSe Nacional para uma empresa específica, coordenando todos os scripts
necessários através do service de execução.
"""

from fastapi import APIRouter, HTTPException, status, Query
from typing import Optional

from ..repositories.empresas_repo import get_empresa_by_id, get_empresa_by_cnpj
from ..models.execucao import ExecucaoStatusResponse
from ..infrastructure.logger import get_logger

logger = get_logger(__name__)

# Import lazy do execution_service para evitar erros de importação circular
def _get_execution_service():
    """Importa o execution_service apenas quando necessário."""
    try:
        from ..services.execution_service import get_execution_service
        return get_execution_service()
    except Exception as e:
        logger.error(f"Erro ao importar execution_service: {str(e)}", exc_info=True)
        raise

router = APIRouter(prefix="/api/execucao", tags=["Execução"])


@router.get("/{empresa_id}/status", response_model=ExecucaoStatusResponse, summary="Obter status de uma execução")
def obter_status_execucao(empresa_id: str) -> ExecucaoStatusResponse:
    """
    Obtém o status atual de uma execução em andamento ou concluída.
    
    Aceita tanto empresa_id quanto CNPJ como identificador.
    Se receber CNPJ, busca a empresa no banco e usa o ID real.
    
    Args:
        empresa_id: ID da empresa ou CNPJ (14 dígitos)
        
    Returns:
        ExecucaoStatusResponse com status atual da execução
        
    Raises:
        HTTPException: Se a execução não for encontrada
    """
    try:
        execution_service = _get_execution_service()
        
        # Limpa o CNPJ se houver formatação
        cnpj_limpo = empresa_id.replace(".", "").replace("/", "").replace("-", "").strip()
        
        logger.info(f"Buscando status: empresa_id={empresa_id}, cnpj_limpo={cnpj_limpo}")
        
        # Tenta buscar status diretamente com o ID fornecido primeiro
        status_execucao = execution_service.obter_status(empresa_id)
        logger.debug(f"Tentativa 1 (ID direto): {status_execucao is not None}")
        
        # Se não encontrou, verifica se é um CNPJ e busca a empresa no banco
        if not status_execucao and len(cnpj_limpo) == 14 and cnpj_limpo.isdigit():
            try:
                empresa = get_empresa_by_cnpj(cnpj_limpo)
                if empresa:
                    empresa_id_real = empresa.get("id")
                    logger.info(f"Empresa encontrada no banco: empresa_id_real={empresa_id_real}")
                    if empresa_id_real:
                        # Tenta buscar status com o ID real do banco
                        status_execucao = execution_service.obter_status(str(empresa_id_real))
                        logger.debug(f"Tentativa 2 (ID real do banco): {status_execucao is not None}")
            except Exception as e:
                # Log do erro mas continua tentando outras opções
                logger.warning(f"Erro ao buscar empresa por CNPJ: {e}")
        
        if not status_execucao:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Execução para empresa/CNPJ {empresa_id} não encontrada. Verifique se a execução foi iniciada."
            )
        
        return ExecucaoStatusResponse(**status_execucao)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao obter status: {str(e)}", exc_info=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao obter status: {str(e)}"
        )


@router.post("/{empresa_id}", summary="Iniciar execução para uma empresa")
def iniciar_execucao(
    empresa_id: str,
    competencia: str = Query(..., description="Competência no formato MMAAAA (ex: 112025)"),
    tipo: str = Query("ambas", description="Tipo de notas: 'emitidas', 'recebidas' ou 'ambas'"),
    headless: bool = Query(False, description="Executar navegador em modo headless")
):
    """
    Inicia uma execução orquestrada do fluxo completo de automação NFSe para uma empresa.
    
    Este endpoint aceita empresa_id ou CNPJ como identificador:
    - Se empresa_id for um UUID, busca por ID
    - Se empresa_id for um CNPJ (14 dígitos), busca por CNPJ
    
    Este endpoint:
    1. Busca os dados da empresa (incluindo CNPJ) no banco de dados
    2. Adiciona a execução à fila do service de execução
    3. Retorna o status inicial da execução
    
    O service processará a execução sequencialmente, garantindo que apenas
    uma execução ocorra por vez para evitar conflitos de certificados.
    
    Fluxo de execução:
    1. Autenticação via certificado digital (playwright_nfse.py)
    2. Processamento de notas emitidas (emitidas_automation.py)
    3. Processamento de notas recebidas (emitidas_automation.py)
    4. Salvamento automático (salvamento.py - integrado)
    
    Args:
        empresa_id: ID da empresa no banco de dados ou CNPJ (14 dígitos)
        competencia: Competência no formato MMAAAA (ex: "112025" para nov/2025)
        tipo: Tipo de notas a processar ("emitidas", "recebidas" ou "ambas")
        headless: Se True, executa navegador em modo headless
        
    Returns:
        ExecucaoStatusResponse com status inicial da execução
        
    Raises:
        HTTPException: Se a empresa não for encontrada ou houver erro ao iniciar execução
    """
    try:
        # Tenta buscar por ID primeiro
        try:
            empresa = get_empresa_by_id(empresa_id)
        except ValueError as e:
            # Erro de configuração do banco de dados
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Erro de configuração do banco de dados: {str(e)}"
            )
        
        # Se não encontrou por ID, tenta buscar por CNPJ
        if not empresa:
            try:
                empresa = get_empresa_by_cnpj(empresa_id)
            except ValueError as e:
                # Erro de configuração do banco de dados
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Erro de configuração do banco de dados: {str(e)}"
                )
        
        if not empresa:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Empresa com ID/CNPJ {empresa_id} não encontrada"
            )
        
        # Valida competência (formato MMAAAA)
        if len(competencia) != 6 or not competencia.isdigit():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Competência inválida. Use o formato MMAAAA (ex: 112025 para nov/2025)"
            )
        
        # Valida tipo
        if tipo not in ["emitidas", "recebidas", "ambas"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tipo inválido. Use 'emitidas', 'recebidas' ou 'ambas'"
            )
        
        # Remove formatação do CNPJ se houver
        cnpj_empresa = empresa.get("cnpj")
        if not cnpj_empresa:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Empresa {empresa_id} não possui CNPJ cadastrado"
            )
        
        cnpj_limpo = str(cnpj_empresa).replace(".", "").replace("/", "").replace("-", "").strip()
        
        if len(cnpj_limpo) != 14:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CNPJ inválido na empresa: {empresa.get('cnpj', 'N/A')}"
            )
        
        # Valida que empresa tem ID
        empresa_id_real = empresa.get("id")
        if not empresa_id_real:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Empresa encontrada mas não possui ID válido"
            )
        
        # Obtém service e adiciona execução à fila
        execution_service = _get_execution_service()
        
        logger.info(f"Iniciando execução: empresa_id_real={empresa_id_real}, cnpj={cnpj_limpo}")
        
        execucao_id = execution_service.adicionar_execucao(
            empresa_id=str(empresa_id_real),
            cnpj=cnpj_limpo,
            competencia=competencia,
            tipo=tipo,
            headless=headless
        )
        
        logger.info(f"Execução adicionada à fila: execucao_id={execucao_id}")
        
        # Retorna status inicial usando o ID real da empresa
        try:
            status_execucao = execution_service.obter_status(str(empresa_id_real))
            logger.info(f"Status inicial obtido: {status_execucao.get('status') if status_execucao else 'None'}")
            if not status_execucao:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Erro ao obter status da execução"
                )
            
            # Valida que todos os campos obrigatórios estão presentes
            if not status_execucao.get("empresa_id"):
                status_execucao["empresa_id"] = str(empresa_id_real)
            if not status_execucao.get("cnpj"):
                status_execucao["cnpj"] = cnpj_limpo
            if not status_execucao.get("status"):
                status_execucao["status"] = "pendente"
            if not status_execucao.get("etapa_atual"):
                status_execucao["etapa_atual"] = "inicio"
            if status_execucao.get("progresso") is None:
                status_execucao["progresso"] = 0
            if not status_execucao.get("logs"):
                status_execucao["logs"] = []
            if not status_execucao.get("mensagem"):
                status_execucao["mensagem"] = "Aguardando execução..."
            
            return ExecucaoStatusResponse(**status_execucao)
        except Exception as e:
            logger.error(f"Erro ao criar ExecucaoStatusResponse: {str(e)}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Erro ao criar resposta: {str(e)}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        logger.error(f"Erro ao iniciar execução: {str(e)}", exc_info=True)
        logger.error(f"Traceback completo:\n{error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao iniciar execução: {str(e)}"
        )

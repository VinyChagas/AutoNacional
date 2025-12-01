"""
Endpoints FastAPI para execução orquestrada de automações NFSe.

Este módulo fornece endpoints REST para executar o fluxo completo de automação
do portal NFSe Nacional para uma empresa específica, coordenando todos os scripts
necessários através do service de execução.
"""

from fastapi import APIRouter, HTTPException, status, Query, Body, Request
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
import json

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


class EmpresaExecucaoRequest(BaseModel):
    """Modelo para requisição de execução de uma empresa."""
    empresa_id: str
    cnpj: str


class MultiplasExecucoesRequest(BaseModel):
    """Modelo para requisição de múltiplas execuções."""
    empresas: List[EmpresaExecucaoRequest]
    competencia: str
    tipo: str = "ambas"
    headless: bool = False


# IMPORTANTE: Endpoints específicos devem vir ANTES de endpoints com parâmetros dinâmicos
# para evitar conflitos de roteamento (ex: /multiplas deve vir antes de /{empresa_id})

@router.post("/multiplas/debug", summary="Debug - Adicionar múltiplas empresas (aceita qualquer formato)")
async def adicionar_multiplas_execucoes_debug(
    request: Request
):
    """Endpoint de debug para ver o que está sendo recebido."""
    try:
        body = await request.json()
        logger.info(f"Body recebido (debug): {json.dumps(body, indent=2)}")
        logger.info(f"Tipo do body: {type(body)}")
        logger.info(f"Chaves do body: {body.keys() if isinstance(body, dict) else 'Não é dict'}")
        
        # Tenta criar o modelo
        try:
            request_model = MultiplasExecucoesRequest(**body)
            logger.info(f"Modelo criado com sucesso: {request_model}")
            return {"status": "ok", "body": body, "model": request_model.model_dump()}
        except Exception as e:
            logger.error(f"Erro ao criar modelo: {e}")
            logger.error(f"Tipo do erro: {type(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                "status": "erro",
                "body": body,
                "erro": str(e),
                "tipo_erro": str(type(e))
            }
    except Exception as e:
        logger.error(f"Erro geral no debug: {e}")
        import traceback
        return {"status": "erro_geral", "erro": str(e), "traceback": traceback.format_exc()}


@router.post("/multiplas", summary="Adicionar múltiplas empresas à fila de execução")
async def adicionar_multiplas_execucoes(
    request: MultiplasExecucoesRequest = Body(..., embed=False)
):
    """
    Adiciona múltiplas empresas à fila de execução simultaneamente.
    
    Este endpoint permite adicionar várias empresas à fila de uma vez,
    permitindo que o sistema processe múltiplas execuções em paralelo
    conforme o limite de concorrência configurado.
    
    Args:
        request: Objeto com lista de empresas e parâmetros de execução
        
    Returns:
        Lista de status iniciais das execuções adicionadas
        
    Raises:
        HTTPException: Se houver erro ao adicionar execuções
    """
    try:
        execution_service = _get_execution_service()
        
        logger.info(f"Recebida requisição para adicionar {len(request.empresas)} empresas à fila")
        logger.debug(f"Competência: {request.competencia}, Tipo: {request.tipo}, Headless: {request.headless}")
        logger.debug(f"Primeira empresa exemplo: empresa_id={request.empresas[0].empresa_id if request.empresas else 'N/A'}, cnpj={request.empresas[0].cnpj if request.empresas else 'N/A'}")
        
        # Valida se há empresas na lista
        if not request.empresas or len(request.empresas) == 0:
            logger.error("Lista de empresas vazia")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Lista de empresas não pode estar vazia"
            )
        
        # Valida competência
        if len(request.competencia) != 6 or not request.competencia.isdigit():
            logger.error(f"Competência inválida recebida: {request.competencia}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Competência inválida. Use o formato MMAAAA (ex: 112025 para nov/2025)"
            )
        
        # Valida tipo
        if request.tipo not in ["emitidas", "recebidas", "ambas"]:
            logger.error(f"Tipo inválido recebido: {request.tipo}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tipo inválido. Use 'emitidas', 'recebidas' ou 'ambas'"
            )
        
        resultados = []
        erros = []
        
        # Adiciona cada empresa à fila
        for empresa_req in request.empresas:
            try:
                # Limpa CNPJ
                cnpj_limpo = str(empresa_req.cnpj).replace(".", "").replace("/", "").replace("-", "").strip()
                
                if len(cnpj_limpo) != 14:
                    erro_msg = f"CNPJ inválido: {empresa_req.cnpj} (limpo: {cnpj_limpo}, tamanho: {len(cnpj_limpo)})"
                    logger.warning(erro_msg)
                    erros.append({
                        "empresa_id": empresa_req.empresa_id,
                        "cnpj": empresa_req.cnpj,
                        "erro": erro_msg
                    })
                    continue
                
                # Tenta buscar empresa no banco pelo CNPJ para obter o ID real
                empresa_id_real = empresa_req.empresa_id
                try:
                    empresa = get_empresa_by_cnpj(cnpj_limpo)
                    if empresa and empresa.get("id"):
                        empresa_id_real = str(empresa.get("id"))
                        logger.debug(f"Empresa encontrada no banco: CNPJ {cnpj_limpo} -> ID {empresa_id_real}")
                    else:
                        # Se não encontrou no banco, usa CNPJ como ID (o endpoint individual aceita CNPJ também)
                        logger.debug(f"Empresa não encontrada no banco para CNPJ {cnpj_limpo}, usando CNPJ como ID")
                        empresa_id_real = cnpj_limpo
                except Exception as e:
                    logger.warning(f"Erro ao buscar empresa por CNPJ {cnpj_limpo}: {e}. Usando empresa_id fornecido.")
                    # Continua com o empresa_id fornecido
                
                logger.info(f"Adicionando execução: empresa_id={empresa_id_real}, cnpj={cnpj_limpo}")
                
                # Adiciona à fila
                execucao_id = await execution_service.adicionar_execucao(
                    empresa_id=empresa_id_real,
                    cnpj=cnpj_limpo,
                    competencia=request.competencia,
                    tipo=request.tipo,
                    headless=request.headless
                )
                
                # Obtém status inicial
                status_execucao = execution_service.obter_status(execucao_id)
                if status_execucao:
                    resultados.append(status_execucao)
                else:
                    # Cria status inicial se não encontrado
                    resultados.append({
                        "empresa_id": execucao_id,
                        "cnpj": cnpj_limpo,
                        "status": "pendente",
                        "etapa_atual": "inicio",
                        "progresso": 0,
                        "logs": [],
                        "mensagem": "Aguardando execução..."
                    })
                    
            except Exception as e:
                logger.error(f"Erro ao adicionar execução para empresa {empresa_req.empresa_id}: {e}", exc_info=True)
                erros.append({
                    "empresa_id": empresa_req.empresa_id,
                    "cnpj": empresa_req.cnpj,
                    "erro": str(e)
                })
        
        # Retorna resultados e erros (se houver)
        response = {
            "sucesso": len(resultados),
            "erros": len(erros),
            "execucoes": [ExecucaoStatusResponse(**r) for r in resultados],
            "detalhes_erros": erros
        }
        
        if erros:
            logger.warning(f"Algumas execuções falharam: {len(erros)} de {len(request.empresas)}")
        
        logger.info(f"Múltiplas execuções adicionadas: {len(resultados)} sucesso, {len(erros)} erros")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao adicionar múltiplas execuções: {str(e)}", exc_info=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao adicionar múltiplas execuções: {str(e)}"
        )


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
async def iniciar_execucao(
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
        
        # Obtém service e adiciona execução à fila (AGORA É ASYNC - usa await)
        execution_service = _get_execution_service()
        
        logger.info(f"Iniciando execução: empresa_id_real={empresa_id_real}, cnpj={cnpj_limpo}")
        
        try:
            execucao_id = await execution_service.adicionar_execucao(
                empresa_id=str(empresa_id_real),
                cnpj=cnpj_limpo,
                competencia=competencia,
                tipo=tipo,
                headless=headless
            )
            logger.info(f"Execução adicionada à fila: execucao_id={execucao_id}")
        except ValueError as ve:
            # Erro de validação - retorna 400
            logger.warning(f"Erro de validação ao adicionar execução: {ve}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Erro de validação: {str(ve)}"
            )
        except Exception as e:
            # Outros erros - loga e retorna 500
            logger.error(f"Erro ao adicionar execução à fila: {str(e)}", exc_info=True)
            import traceback
            error_trace = traceback.format_exc()
            logger.error(f"Traceback completo:\n{error_trace}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Erro ao iniciar execução: {str(e)}"
            )
        
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

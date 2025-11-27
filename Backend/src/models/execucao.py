"""
Modelos relacionados à execução de automações.
"""

from enum import Enum
from typing import Optional, List, Any
from datetime import datetime
from pydantic import BaseModel


class StatusExecucao(str, Enum):
    """Status possíveis de uma execução."""
    PENDENTE = "pendente"
    EM_EXECUCAO = "em_execucao"
    CONCLUIDO = "concluido"
    FALHOU = "falhou"
    CANCELADO = "cancelado"


class EtapaExecucao(str, Enum):
    """Etapas do fluxo de execução."""
    INICIO = "inicio"
    AUTENTICACAO = "autenticacao"
    PROCESSAMENTO_EMITIDAS = "processamento_emitidas"
    PROCESSAMENTO_RECEBIDAS = "processamento_recebidas"
    FINALIZACAO = "finalizacao"


class ExecucaoInfo(BaseModel):
    """Informações sobre uma execução."""
    empresa_id: str
    cnpj: str
    competencia: str
    tipo: str = "ambas"  # "emitidas", "recebidas" ou "ambas"
    status: StatusExecucao = StatusExecucao.PENDENTE
    etapa_atual: EtapaExecucao = EtapaExecucao.INICIO
    progresso: int = 0
    logs: List[str] = []
    mensagem: str = "Aguardando execução..."
    data_inicio: Optional[datetime] = None
    data_fim: Optional[datetime] = None
    erro: Optional[str] = None
    url_atual: Optional[str] = None
    titulo: Optional[str] = None
    headless: bool = False  # Se True, executa navegador em modo headless
    
    # Campos adicionais para recursos do Playwright (não serializados)
    page: Optional[Any] = None
    context: Optional[Any] = None
    browser: Optional[Any] = None
    playwright: Optional[Any] = None
    
    class Config:
        """Configuração do modelo Pydantic."""
        arbitrary_types_allowed = True  # Permite tipos arbitrários para page, context, etc.


class ExecucaoStatusResponse(BaseModel):
    """Resposta com status de uma execução para API."""
    empresa_id: str
    cnpj: str
    status: str
    etapa_atual: str
    progresso: int
    logs: List[str]
    mensagem: str
    data_inicio: Optional[str] = None
    data_fim: Optional[str] = None
    erro: Optional[str] = None
    url_atual: Optional[str] = None
    titulo: Optional[str] = None


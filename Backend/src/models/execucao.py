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


class ResultadoFinal(str, Enum):
    """Resultado final de uma execução."""
    SEM_MOVIMENTO = "SEM_MOVIMENTO"
    NOTAS_EMITIDAS = "NOTAS_EMITIDAS"  # Tem emitidas mas não recebidas
    NOTAS_RECEBIDAS = "NOTAS_RECEBIDAS"  # Tem recebidas mas não emitidas
    NFS_ENCONTRADAS = "NFS_ENCONTRADAS"  # Tem ambas


class ExecucaoInfo(BaseModel):
    """
    Informações sobre uma execução.
    
    Esta classe mantém o estado da execução em memória para acesso rápido
    via API. O estado também é persistido no banco de dados através do campo
    execucao_db_id, que referencia o registro na tabela Execucao.
    """
    empresa_id: str
    cnpj: str
    periodo_inicio: str  # Formato DD/MM/YYYY (ex: 01/12/2025) - data início do filtro
    periodo_fim: str  # Formato DD/MM/YYYY (ex: 31/12/2025) - data fim do filtro
    tipo: str = "ambas"  # "emitidas", "recebidas" ou "ambas"
    status: StatusExecucao = StatusExecucao.PENDENTE
    etapa_atual: EtapaExecucao = EtapaExecucao.INICIO
    progresso: int = 0
    logs: List[str] = []
    mensagem: str = "Aguardando execução..."
    data_inicio: Optional[datetime] = None  # Data/hora de início da execução
    data_fim: Optional[datetime] = None  # Data/hora de fim da execução
    erro: Optional[str] = None
    url_atual: Optional[str] = None
    titulo: Optional[str] = None
    headless: bool = False  # Se True, executa navegador em modo headless
    tipo_autenticacao: str = "certificado"  # "certificado" ou "credenciais"
    
    # Campos de resultado
    qtd_notas_emitidas: int = 0
    qtd_notas_recebidas: int = 0
    resultado_final: Optional[ResultadoFinal] = None
    
    # ID do registro no banco de dados (None até ser criado)
    # Este campo permite sincronizar o estado em memória com o banco
    execucao_db_id: Optional[int] = None
    
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
    qtd_notas_emitidas: Optional[int] = 0
    qtd_notas_recebidas: Optional[int] = 0
    resultado_final: Optional[str] = None


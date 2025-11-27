"""
Service para orquestração de execuções de automação NFSe.

Este service gerencia a fila de execuções e coordena os scripts de automação:
- Autenticação via playwright_nfse.py
- Processamento de notas via emitidas_automation.py
- Salvamento automático via salvamento.py
"""

import os
import sys
import threading
from typing import Dict, Optional
from datetime import datetime
from queue import Queue, Empty

# Adiciona src e scripts/automation ao path para imports funcionarem ANTES de importar outros módulos
backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src_path = os.path.join(backend_dir, "src")
scripts_automation_path = os.path.join(backend_dir, "scripts", "automation")

if src_path not in sys.path:
    sys.path.insert(0, src_path)
if scripts_automation_path not in sys.path:
    sys.path.insert(0, scripts_automation_path)

# Agora importa os módulos que dependem do path estar configurado
from ..infrastructure.logger import get_logger
from ..infrastructure.config import QUEUE_TIMEOUT, PLAYWRIGHT_TIMEOUT, PLAYWRIGHT_HEADLESS
from ..models.execucao import StatusExecucao, EtapaExecucao, ExecucaoInfo, ExecucaoStatusResponse

logger = get_logger(__name__)

# Log para debug
logger.debug(f"Backend dir: {backend_dir}")
logger.debug(f"Scripts automation path: {scripts_automation_path}")
logger.debug(f"Path existe: {os.path.exists(scripts_automation_path)}")
logger.debug(f"sys.path atualizado. scripts/automation no path: {scripts_automation_path in sys.path}")


class ExecutionService:
    """
    Service que gerencia a fila de execuções e coordena os scripts.
    
    Garante execução sequencial (uma empresa por vez) para evitar conflitos
    de certificados e sessões de navegador.
    """
    
    def __init__(self):
        """Inicializa o service de execução."""
        self.fila_execucoes: Queue = Queue()
        self.execucoes_ativas: Dict[str, ExecucaoInfo] = {}
        self.thread_executora: Optional[threading.Thread] = None
        self.rodando = False
        self.lock = threading.Lock()
    
    def adicionar_execucao(
        self,
        empresa_id: str,
        cnpj: str,
        competencia: str,
        tipo: str = "ambas",
        headless: bool = None
    ) -> str:
        """
        Adiciona uma execução à fila.
        
        Args:
            empresa_id: ID da empresa no banco de dados
            cnpj: CNPJ da empresa (14 dígitos)
            competencia: Competência no formato MMAAAA (ex: "112025")
            tipo: Tipo de notas ("emitidas", "recebidas" ou "ambas")
            headless: Se True, executa navegador em modo headless. Se None, usa config padrão.
            
        Returns:
            ID da execução (mesmo que empresa_id para rastreamento)
            
        Raises:
            ValueError: Se os parâmetros forem inválidos
        """
        # Validações
        if not empresa_id:
            raise ValueError("empresa_id não pode ser None ou vazio")
        if not cnpj:
            raise ValueError("cnpj não pode ser None ou vazio")
        if not competencia:
            raise ValueError("competencia não pode ser None ou vazio")
        
        empresa_id = str(empresa_id)
        cnpj = str(cnpj).strip()
        competencia = str(competencia).strip()
        
        # Usa headless da config se não fornecido
        if headless is None:
            headless = PLAYWRIGHT_HEADLESS
        
        with self.lock:
            # Cria informação da execução
            execucao = ExecucaoInfo(
                empresa_id=empresa_id,
                cnpj=cnpj,
                competencia=competencia,
                tipo=tipo,
                headless=headless
            )
            
            # Adiciona à fila
            self.fila_execucoes.put(execucao)
            self.execucoes_ativas[empresa_id] = execucao
            
            logger.info(f"Execução adicionada à fila: Empresa {empresa_id} (CNPJ: {cnpj})")
            
            # Inicia thread executora se não estiver rodando
            if not self.rodando:
                self.rodando = True
                self.thread_executora = threading.Thread(
                    target=self._processar_fila,
                    daemon=True
                )
                self.thread_executora.start()
                logger.info("Thread executora iniciada")
            
            return empresa_id
    
    def obter_status(self, empresa_id: str) -> Optional[Dict]:
        """
        Obtém o status atual de uma execução.
        
        Args:
            empresa_id: ID da empresa
            
        Returns:
            Dicionário com status da execução ou None se não encontrada
        """
        with self.lock:
            execucao = self.execucoes_ativas.get(empresa_id)
            if not execucao:
                return None
            
            return {
                "empresa_id": str(execucao.empresa_id) if execucao.empresa_id else "",
                "cnpj": str(execucao.cnpj) if execucao.cnpj else "",
                "status": execucao.status.value if execucao.status else "pendente",
                "etapa_atual": execucao.etapa_atual.value if execucao.etapa_atual else "inicio",
                "progresso": execucao.progresso if execucao.progresso is not None else 0,
                "logs": execucao.logs if execucao.logs else [],
                "mensagem": str(execucao.mensagem) if execucao.mensagem else "Aguardando execução...",
                "data_inicio": execucao.data_inicio.isoformat() if execucao.data_inicio else None,
                "data_fim": execucao.data_fim.isoformat() if execucao.data_fim else None,
                "erro": str(execucao.erro) if execucao.erro else None,
                "url_atual": str(execucao.url_atual) if execucao.url_atual else None,
                "titulo": str(execucao.titulo) if execucao.titulo else None,
            }
    
    def _processar_fila(self):
        """Processa a fila de execuções sequencialmente."""
        logger.info("Iniciando processamento da fila de execuções")
        
        while True:
            try:
                # Pega próxima execução (bloqueia até ter uma)
                logger.info(f"Aguardando próxima execução na fila... (fila tem {self.fila_execucoes.qsize()} itens)")
                execucao = self.fila_execucoes.get(timeout=QUEUE_TIMEOUT)
                logger.info(f"Execução obtida da fila: Empresa {execucao.empresa_id}")
                
                # Processa a execução
                logger.info(f"Iniciando processamento da execução para empresa {execucao.empresa_id}")
                self._executar_fluxo_completo(execucao)
                logger.info(f"Execução concluída para empresa {execucao.empresa_id}")
                
                # Marca como concluída na fila
                self.fila_execucoes.task_done()
                
            except Empty:
                # Timeout - verifica se deve continuar
                logger.info(f"Timeout ao aguardar execução ({QUEUE_TIMEOUT}s)")
                with self.lock:
                    if self.fila_execucoes.empty():
                        logger.info("Fila vazia. Thread executora pausada.")
                        self.rodando = False
                        break
                    else:
                        logger.info(f"Fila ainda tem itens ({self.fila_execucoes.qsize()}), continuando...")
            except Exception as e:
                logger.error(f"Erro no processamento da fila: {str(e)}", exc_info=True)
                # Continua processando outras execuções mesmo com erro
    
    def _executar_fluxo_completo(self, execucao: ExecucaoInfo):
        """
        Executa o fluxo completo de automação para uma empresa.
        
        Etapas:
        1. Autenticação (playwright_nfse.py)
        2. Processamento de notas emitidas (emitidas_automation.py)
        3. Processamento de notas recebidas (emitidas_automation.py)
        4. Finalização e cleanup
        """
        execucao.data_inicio = datetime.now()
        execucao.status = StatusExecucao.EM_EXECUCAO
        
        try:
            # ETAPA 1: Autenticação
            execucao.etapa_atual = EtapaExecucao.AUTENTICACAO
            execucao.progresso = 10
            execucao.mensagem = "Iniciando autenticação..."
            
            # Valida CNPJ antes de tentar autenticar
            if not execucao.cnpj:
                raise ValueError(f"CNPJ não pode ser None para empresa {execucao.empresa_id}")
            
            cnpj_str = str(execucao.cnpj).strip()
            if not cnpj_str or len(cnpj_str) != 14:
                raise ValueError(f"CNPJ inválido: {execucao.cnpj} (empresa {execucao.empresa_id})")
            
            self._adicionar_log(execucao, f"Etapa 1: Autenticação para CNPJ {cnpj_str}")
            
            # Importa funções do playwright apenas quando necessário
            try:
                from playwright_nfse import abrir_dashboard_nfse, NFSeAutenticacaoError
                self._adicionar_log(execucao, "Funções do Playwright importadas")
            except Exception as e:
                error_msg = f"Erro ao importar Playwright: {str(e)}"
                self._adicionar_log(execucao, f"❌ {error_msg}")
                raise ImportError(error_msg)
            
            self._adicionar_log(execucao, "Chamando abrir_dashboard_nfse...")
            
            headless = execucao.headless if execucao.headless is not None else PLAYWRIGHT_HEADLESS
            
            try:
                resultado_auth = abrir_dashboard_nfse(
                    cnpj=cnpj_str,
                    headless=headless,
                    timeout=PLAYWRIGHT_TIMEOUT
                )
                self._adicionar_log(execucao, "abrir_dashboard_nfse concluído")
            except Exception as e:
                error_msg = f"Erro ao executar abrir_dashboard_nfse: {str(e)}"
                self._adicionar_log(execucao, f"❌ {error_msg}")
                logger.error(f"Erro detalhado: {error_msg}", exc_info=True)
                raise
            
            if not resultado_auth.get("sucesso"):
                raise NFSeAutenticacaoError(
                    f"Falha na autenticação: {resultado_auth.get('mensagem', 'Erro desconhecido')}"
                )
            
            # Armazena recursos do Playwright para cleanup posterior
            execucao.page = resultado_auth.get("page")  # type: ignore
            execucao.context = resultado_auth.get("context")  # type: ignore
            execucao.browser = resultado_auth.get("browser")  # type: ignore
            execucao.playwright = resultado_auth.get("playwright")  # type: ignore
            execucao.url_atual = resultado_auth.get("url_atual")
            execucao.titulo = resultado_auth.get("titulo")
            
            # Adiciona logs da autenticação
            for log_msg in resultado_auth.get("logs", []):
                self._adicionar_log(execucao, log_msg)
            
            execucao.progresso = 30
            execucao.mensagem = "Autenticação concluída com sucesso"
            self._adicionar_log(execucao, "✅ Autenticação concluída")
            
            # Verifica se temos página válida
            if not execucao.page:
                raise Exception("Página do navegador não foi criada corretamente")
            
            # ETAPA 2: Processamento de Notas Emitidas
            if execucao.tipo in ["emitidas", "ambas"]:
                execucao.etapa_atual = EtapaExecucao.PROCESSAMENTO_EMITIDAS
                execucao.progresso = 40
                execucao.mensagem = "Processando notas emitidas..."
                self._adicionar_log(execucao, "Etapa 2: Processando notas emitidas")
                
                # Importa funções de automação apenas quando necessário
                from emitidas_automation import executar_fluxo_emitidas
                
                try:
                    executar_fluxo_emitidas(
                        page=execucao.page,
                        competencia=execucao.competencia,
                        context=execucao.context
                    )
                    execucao.progresso = execucao.tipo == "ambas" and 70 or 90
                    execucao.mensagem = "Notas emitidas processadas com sucesso"
                    self._adicionar_log(execucao, "✅ Notas emitidas processadas")
                except Exception as e:
                    error_msg = f"Erro ao processar notas emitidas: {str(e)}"
                    self._adicionar_log(execucao, f"❌ {error_msg}")
                    logger.error(error_msg, exc_info=True)
                    # Continua mesmo com erro em uma etapa
            
            # ETAPA 3: Processamento de Notas Recebidas
            if execucao.tipo in ["recebidas", "ambas"]:
                execucao.etapa_atual = EtapaExecucao.PROCESSAMENTO_RECEBIDAS
                execucao.progresso = execucao.tipo == "ambas" and 70 or 40
                execucao.mensagem = "Processando notas recebidas..."
                self._adicionar_log(execucao, "Etapa 3: Processando notas recebidas")
                
                # Importa funções de automação apenas quando necessário
                from emitidas_automation import executar_fluxo_recebidas
                
                try:
                    executar_fluxo_recebidas(
                        page=execucao.page,
                        competencia=execucao.competencia,
                        context=execucao.context
                    )
                    execucao.progresso = 90
                    execucao.mensagem = "Notas recebidas processadas com sucesso"
                    self._adicionar_log(execucao, "✅ Notas recebidas processadas")
                except Exception as e:
                    error_msg = f"Erro ao processar notas recebidas: {str(e)}"
                    self._adicionar_log(execucao, f"❌ {error_msg}")
                    logger.error(error_msg, exc_info=True)
                    # Continua mesmo com erro em uma etapa
            
            # ETAPA 4: Finalização
            execucao.etapa_atual = EtapaExecucao.FINALIZACAO
            execucao.progresso = 100
            execucao.status = StatusExecucao.CONCLUIDO
            execucao.mensagem = "Execução concluída com sucesso"
            execucao.data_fim = datetime.now()
            self._adicionar_log(execucao, "🎉 Execução concluída com sucesso")
            
        except Exception as e:
            # Verifica se é erro de autenticação específico
            if "NFSeAutenticacaoError" in str(type(e)) or "autenticação" in str(e).lower():
                execucao.status = StatusExecucao.FALHOU
                execucao.erro = f"Erro de autenticação: {str(e)}"
            else:
                execucao.status = StatusExecucao.FALHOU
                execucao.erro = f"Erro na etapa {execucao.etapa_atual.value}: {str(e)}"
            
            execucao.mensagem = execucao.erro
            execucao.data_fim = datetime.now()
            self._adicionar_log(execucao, f"❌ ERRO: {execucao.erro}")
            logger.error(f"Erro na execução para empresa {execucao.empresa_id}: {str(e)}", exc_info=True)
            
        finally:
            # Cleanup: fecha recursos do Playwright
            self._limpar_recursos(execucao)
    
    def _adicionar_log(self, execucao: ExecucaoInfo, mensagem: str):
        """Adiciona uma mensagem de log à execução."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_msg = f"[{timestamp}] {mensagem}"
        execucao.logs.append(log_msg)
        logger.info(f"Empresa {execucao.empresa_id}: {mensagem}")
    
    def _limpar_recursos(self, execucao: ExecucaoInfo):
        """Limpa recursos do Playwright após execução."""
        try:
            headless = execucao.headless if execucao.headless is not None else PLAYWRIGHT_HEADLESS
            
            if headless:
                # Em modo headless, fecha tudo
                if execucao.page:
                    try:
                        execucao.page.close()
                    except:
                        pass
                
                if execucao.context:
                    try:
                        execucao.context.close()
                    except:
                        pass
                
                if execucao.browser:
                    try:
                        execucao.browser.close()
                    except:
                        pass
                
                if execucao.playwright:
                    try:
                        execucao.playwright.stop()
                    except:
                        pass
                
                self._adicionar_log(execucao, "🧹 Recursos liberados (modo headless)")
            else:
                # Em modo visível, mantém navegador aberto
                self._adicionar_log(execucao, "🌐 Navegador mantido aberto para visualização")
                
        except Exception as e:
            logger.error(f"Erro ao limpar recursos: {str(e)}", exc_info=True)


# Instância singleton do service
_execution_service: Optional[ExecutionService] = None


def get_execution_service() -> ExecutionService:
    """
    Obtém a instância singleton do ExecutionService.
    
    Returns:
        Instância do ExecutionService
    """
    global _execution_service
    if _execution_service is None:
        _execution_service = ExecutionService()
    return _execution_service


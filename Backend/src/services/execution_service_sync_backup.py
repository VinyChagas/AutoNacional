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
import asyncio
from typing import Dict, Optional
from datetime import datetime
from queue import Queue, Empty
from concurrent.futures import ThreadPoolExecutor
import functools

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
from ..db.session import SessionLocal
from ..db.models import Execucao

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
        # Executor separado para código síncrono do Playwright
        # Isso garante que não há interferência do loop asyncio
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="playwright-exec")
    
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
            
            # Cria registro no banco de dados para persistir o estado
            # Isso permite rastrear execuções mesmo após reinicialização do processo
            try:
                execucao_db_id = self._criar_execucao_db(empresa_id, StatusExecucao.PENDENTE)
                execucao.execucao_db_id = execucao_db_id
                logger.info(f"Registro de execução criado no banco: ID {execucao_db_id}")
            except Exception as e:
                # Se falhar ao criar no banco, continua com execução em memória
                # Isso garante que o sistema continue funcionando mesmo com problemas no banco
                logger.warning(f"Erro ao criar registro de execução no banco: {e}. Continuando apenas em memória.")
            
            # Adiciona à fila
            self.fila_execucoes.put(execucao)
            self.execucoes_ativas[empresa_id] = execucao
            
            logger.info(f"Execução adicionada à fila: Empresa {empresa_id} (CNPJ: {cnpj})")
            
            # Inicia thread executora se não estiver rodando
            if not self.rodando:
                self.rodando = True
                # Cria uma nova thread sem contexto asyncio
                # Isso garante que o Playwright Sync API não detecte o loop asyncio do FastAPI
                self.thread_executora = threading.Thread(
                    target=self._processar_fila_isolada,
                    daemon=True,
                    name="PlaywrightExecutor"
                )
                # Garante que a thread não herda contexto asyncio
                self.thread_executora.start()
                logger.info("Thread executora iniciada (contexto isolado)")
            
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
    
    def _processar_fila_isolada(self):
        """
        Processa a fila de execuções sequencialmente em um contexto isolado.
        
        Esta função garante que o código seja executado em um contexto completamente
        isolado do loop asyncio do FastAPI, permitindo o uso do Playwright Sync API.
        """
        # Força a remoção de qualquer contexto asyncio da thread atual
        # Isso é crítico para o Playwright Sync API funcionar
        try:
            # Tenta remover o loop atual
            try:
                loop = asyncio.get_event_loop()
                if loop and loop.is_running():
                    logger.warning("Loop asyncio rodando detectado. Tentando isolar contexto.")
            except RuntimeError:
                pass
            
            # Remove completamente o loop da thread atual
            asyncio.set_event_loop(None)
        except Exception as e:
            logger.debug(f"Erro ao remover loop asyncio (pode ser normal): {e}")
        
        logger.info("Iniciando processamento da fila de execuções em contexto isolado")
        
        while True:
            try:
                # Pega próxima execução (bloqueia até ter uma)
                logger.info(f"Aguardando próxima execução na fila... (fila tem {self.fila_execucoes.qsize()} itens)")
                execucao = self.fila_execucoes.get(timeout=QUEUE_TIMEOUT)
                logger.info(f"Execução obtida da fila: Empresa {execucao.empresa_id}")
                
                # Processa a execução diretamente (já estamos em thread isolada)
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
        
        # Atualiza status no banco de dados para EM_EXECUCAO
        # Sincronização: estado em memória -> banco de dados
        self._atualizar_execucao_db(execucao, StatusExecucao.EM_EXECUCAO, execucao.data_inicio)
        
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
            # IMPORTANTE: Garante que não há contexto asyncio ativo antes de importar
            try:
                # Tenta remover qualquer loop asyncio da thread atual
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        # Se há um loop rodando, isso é um problema
                        # Mas não podemos fazer nada aqui, apenas logar
                        logger.warning("Loop asyncio detectado antes de importar Playwright")
                except RuntimeError:
                    # Não há loop, tudo bem
                    pass
                
                # Tenta importar o Playwright
                from playwright_nfse import abrir_dashboard_nfse, NFSeAutenticacaoError
                self._adicionar_log(execucao, "Funções do Playwright importadas")
            except Exception as e:
                error_msg = f"Erro ao importar Playwright: {str(e)}"
                self._adicionar_log(execucao, f"❌ {error_msg}")
                # Se o erro for relacionado a asyncio, tenta uma solução alternativa
                if "asyncio" in str(e).lower() or "async" in str(e).lower():
                    error_msg += " (Conflito com loop asyncio detectado. A thread executora deve estar isolada.)"
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
            
            # ETAPA 2 e 3: Processamento de Notas (Emitidas e Recebidas)
            # Usa a nova função processar_notas que processa ambas automaticamente
            execucao.etapa_atual = EtapaExecucao.PROCESSAMENTO_EMITIDAS if execucao.tipo in ["emitidas", "ambas"] else EtapaExecucao.PROCESSAMENTO_RECEBIDAS
            execucao.progresso = 40
            execucao.mensagem = f"Processando notas ({execucao.tipo})..."
            self._adicionar_log(execucao, f"Etapa 2-3: Processando notas ({execucao.tipo})")
            
            # Converte competência de MMAAAA para MM/AAAA
            competencia_formatada = None
            try:
                if len(execucao.competencia) == 6 and execucao.competencia.isdigit():
                    # Formato MMAAAA -> MM/AAAA
                    mes = execucao.competencia[:2]
                    ano = execucao.competencia[2:]
                    competencia_formatada = f"{mes}/{ano}"
                    self._adicionar_log(execucao, f"Competência convertida: {execucao.competencia} -> {competencia_formatada}")
                else:
                    # Se já estiver no formato MM/AAAA, usa diretamente
                    competencia_formatada = execucao.competencia
                    self._adicionar_log(execucao, f"Competência já no formato correto: {competencia_formatada}")
            except Exception as e:
                error_msg = f"Erro ao converter competência: {str(e)}"
                self._adicionar_log(execucao, f"❌ {error_msg}")
                raise ValueError(error_msg)
            
            # Configura caminho base de downloads antes de processar notas
            try:
                from ..db.session import get_db
                from ..db.crud_settings import obter_configuracoes
                from processar_notas_competencia_sync import set_downloads_base_path
                
                # Obtém configurações do banco de dados
                db = next(get_db())
                configuracoes = obter_configuracoes(db)
                
                if configuracoes and configuracoes.downloads_base_path:
                    # Configura o caminho base usando o valor da tela de configurações
                    set_downloads_base_path(configuracoes.downloads_base_path)
                    self._adicionar_log(execucao, f"📁 Caminho de downloads configurado: {configuracoes.downloads_base_path}")
                else:
                    self._adicionar_log(execucao, "📁 Usando pasta Downloads padrão do sistema")
                
                db.close()
            except Exception as e:
                # Se não conseguir obter configurações, usa padrão (não é erro crítico)
                logger.warning(f"Não foi possível obter configurações de downloads: {e}. Usando padrão.")
                self._adicionar_log(execucao, "📁 Usando pasta Downloads padrão do sistema (configuração não encontrada)")
            
            # Importa função de processamento de notas
            try:
                from processar_notas_competencia_sync import processar_notas
                self._adicionar_log(execucao, "Função processar_notas importada")
            except Exception as e:
                error_msg = f"Erro ao importar processar_notas: {str(e)}"
                self._adicionar_log(execucao, f"❌ {error_msg}")
                raise ImportError(error_msg)
            
            # Obtém nome da empresa do certificado para usar na estrutura de pastas
            nome_empresa = None
            try:
                from ..db.session import get_db
                from ..db.crud_certificado import obter_certificado_por_cnpj
                from ..services.certificate_service import get_certificate_service
                
                db = next(get_db())
                certificado = obter_certificado_por_cnpj(db, cnpj_str)
                
                # Tenta obter nome da empresa do banco
                if certificado and certificado.empresa and certificado.empresa.strip():
                    nome_empresa = certificado.empresa.strip()
                    self._adicionar_log(execucao, f"📋 Nome da empresa obtido do banco: {nome_empresa}")
                else:
                    # Se não tem no banco, tenta extrair diretamente do certificado
                    logger.info(f"Nome da empresa não encontrado no banco. Tentando extrair do certificado...")
                    try:
                        cert_service = get_certificate_service()
                        conteudo_pfx, senha = cert_service.carregar_certificado(cnpj_str)
                        info_certificado = cert_service.validar_e_extrair_info(conteudo_pfx, senha)
                        
                        if info_certificado.empresa and info_certificado.empresa.strip():
                            nome_empresa = info_certificado.empresa.strip()
                            self._adicionar_log(execucao, f"📋 Nome da empresa extraído do certificado: {nome_empresa}")
                            
                            # Atualiza no banco para próxima vez
                            if certificado:
                                certificado.empresa = nome_empresa
                                db.commit()
                                logger.info(f"Nome da empresa atualizado no banco: {nome_empresa}")
                        else:
                            raise Exception("Nome da empresa não encontrado no certificado")
                    except Exception as e2:
                        logger.warning(f"Não foi possível extrair nome da empresa do certificado: {e2}")
                        # Último recurso: usa CNPJ formatado
                        nome_empresa = cnpj_str
                        self._adicionar_log(execucao, f"⚠️ Usando CNPJ como identificador (nome não encontrado): {cnpj_str}")
                
                db.close()
            except Exception as e:
                # Se não conseguir obter nome, usa CNPJ
                nome_empresa = cnpj_str
                logger.warning(f"Não foi possível obter nome da empresa: {e}. Usando CNPJ.")
                self._adicionar_log(execucao, f"⚠️ Usando CNPJ como identificador (erro ao obter nome): {cnpj_str}")
            
            # Garante que nome_empresa não seja None ou vazio
            if not nome_empresa or not nome_empresa.strip():
                nome_empresa = cnpj_str
                logger.warning(f"Nome da empresa está vazio. Usando CNPJ: {cnpj_str}")
                self._adicionar_log(execucao, f"⚠️ Nome da empresa vazio. Usando CNPJ: {cnpj_str}")
            
            # Log final do nome que será usado
            logger.info(f"🏢 Nome da empresa que será usado para pastas: {nome_empresa}")
            self._adicionar_log(execucao, f"🏢 Nome da empresa para estrutura de pastas: {nome_empresa}")
            
            try:
                # Processa notas emitidas e recebidas conforme o tipo
                if execucao.tipo == "ambas":
                    # A função processar_notas já processa ambas automaticamente
                    processar_notas(
                        page=execucao.page,
                        competencia_alvo=competencia_formatada,
                        nome_empresa=nome_empresa
                    )
                    execucao.progresso = 90
                    execucao.mensagem = "Notas emitidas e recebidas processadas com sucesso"
                    self._adicionar_log(execucao, "✅ Notas emitidas e recebidas processadas")
                elif execucao.tipo == "emitidas":
                    # Processa apenas emitidas
                    from processar_notas_competencia_sync import processar_tabela_emitidas
                    # Acessa menu de emitidas
                    menu_emitidas = execucao.page.locator("li:nth-of-type(3) img").first
                    menu_emitidas.wait_for(state="visible", timeout=10000)
                    menu_emitidas.click()
                    execucao.page.wait_for_url("**/Notas/Emitidas", timeout=15000)
                    execucao.page.wait_for_load_state("networkidle", timeout=15000)
                    execucao.page.wait_for_selector("table tbody tr", timeout=10000)
                    # Processa tabela
                    processar_tabela_emitidas(execucao.page, competencia_formatada, nome_empresa)
                    execucao.progresso = 90
                    execucao.mensagem = "Notas emitidas processadas com sucesso"
                    self._adicionar_log(execucao, "✅ Notas emitidas processadas")
                elif execucao.tipo == "recebidas":
                    # Processa apenas recebidas
                    from processar_notas_competencia_sync import processar_tabela_recebidas
                    # Acessa menu de recebidas
                    menu_recebidas = execucao.page.locator("li:nth-of-type(4) img").first
                    menu_recebidas.wait_for(state="visible", timeout=10000)
                    menu_recebidas.click()
                    execucao.page.wait_for_url("**/Notas/Recebidas", timeout=15000)
                    execucao.page.wait_for_load_state("networkidle", timeout=15000)
                    execucao.page.wait_for_selector("table tbody tr", timeout=10000)
                    # Processa tabela
                    processar_tabela_recebidas(execucao.page, competencia_formatada, nome_empresa)
                    execucao.progresso = 90
                    execucao.mensagem = "Notas recebidas processadas com sucesso"
                    self._adicionar_log(execucao, "✅ Notas recebidas processadas")
                    
            except Exception as e:
                error_msg = f"Erro ao processar notas: {str(e)}"
                self._adicionar_log(execucao, f"❌ {error_msg}")
                logger.error(error_msg, exc_info=True)
                raise
            
            # ETAPA 4: Finalização
            execucao.etapa_atual = EtapaExecucao.FINALIZACAO
            execucao.progresso = 100
            execucao.status = StatusExecucao.CONCLUIDO
            execucao.mensagem = "Execução concluída com sucesso"
            execucao.data_fim = datetime.now()
            self._adicionar_log(execucao, "🎉 Execução concluída com sucesso")
            
            # Atualiza status no banco de dados para CONCLUIDO
            # Sincronização: estado em memória -> banco de dados
            self._atualizar_execucao_db(execucao, StatusExecucao.CONCLUIDO, execucao.data_inicio, execucao.data_fim)
            
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
            
            # Atualiza status no banco de dados para FALHOU com mensagem de erro
            # Sincronização: estado em memória -> banco de dados
            # Salva mensagem de erro resumida (primeiros 500 caracteres para evitar textos muito longos)
            mensagem_erro_resumida = execucao.erro[:500] if execucao.erro else None
            self._atualizar_execucao_db(
                execucao, 
                StatusExecucao.FALHOU, 
                execucao.data_inicio, 
                execucao.data_fim,
                mensagem_erro_resumida
            )
            
        finally:
            # Cleanup: fecha recursos do Playwright
            self._limpar_recursos(execucao)
    
    def _adicionar_log(self, execucao: ExecucaoInfo, mensagem: str):
        """
        Adiciona uma mensagem de log à execução.
        
        Os logs são mantidos em memória para acesso rápido via API.
        Se a mensagem indicar um erro crítico, também atualiza mensagem_erro no banco.
        """
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_msg = f"[{timestamp}] {mensagem}"
        execucao.logs.append(log_msg)
        logger.info(f"Empresa {execucao.empresa_id}: {mensagem}")
        
        # Se for um erro crítico e a execução ainda não foi finalizada,
        # atualiza mensagem_erro no banco para facilitar debugging
        if "❌" in mensagem or "ERRO" in mensagem.upper():
            if execucao.execucao_db_id and execucao.status not in [StatusExecucao.CONCLUIDO, StatusExecucao.FALHOU]:
                try:
                    # Atualiza apenas a mensagem de erro, mantendo o status atual
                    self._atualizar_mensagem_erro_db(execucao, mensagem[:500])
                except Exception as e:
                    # Não interrompe o fluxo se falhar ao atualizar o banco
                    logger.debug(f"Erro ao atualizar mensagem_erro no banco: {e}")
    
    def _criar_execucao_db(self, empresa_id: str, status: StatusExecucao) -> int:
        """
        Cria um novo registro de execução no banco de dados.
        
        Esta função persiste o estado inicial da execução, permitindo rastreamento
        mesmo após reinicialização do processo.
        
        Args:
            empresa_id: ID da empresa sendo executada
            status: Status inicial da execução (geralmente PENDENTE)
            
        Returns:
            ID do registro criado no banco de dados
            
        Raises:
            Exception: Se houver erro ao criar o registro
        """
        db = SessionLocal()
        try:
            execucao_db = Execucao(
                empresa_id=empresa_id,
                status=status.value,
                data_inicio=None,  # Será preenchido quando a execução realmente iniciar
                criado_em=datetime.utcnow(),
                atualizado_em=datetime.utcnow()
            )
            db.add(execucao_db)
            db.commit()
            db.refresh(execucao_db)
            logger.debug(f"Execução criada no banco: ID {execucao_db.id}, empresa_id {empresa_id}")
            return execucao_db.id
        except Exception as e:
            db.rollback()
            logger.error(f"Erro ao criar execução no banco: {e}", exc_info=True)
            raise
        finally:
            db.close()
    
    def _atualizar_execucao_db(
        self, 
        execucao: ExecucaoInfo, 
        status: StatusExecucao,
        data_inicio: Optional[datetime] = None,
        data_fim: Optional[datetime] = None,
        mensagem_erro: Optional[str] = None
    ):
        """
        Atualiza o registro de execução no banco de dados.
        
        Esta função sincroniza o estado em memória (ExecucaoInfo) com o banco
        de dados (Execucao), garantindo persistência de mudanças críticas.
        
        Sincronização: estado em memória -> banco de dados
        
        Args:
            execucao: Objeto ExecucaoInfo com o estado atual
            status: Novo status da execução
            data_inicio: Data/hora de início (opcional, usa do objeto se None)
            data_fim: Data/hora de término (opcional, usa do objeto se None)
            mensagem_erro: Mensagem de erro resumida (opcional)
        """
        # Se não há ID do banco, não há o que atualizar
        if not execucao.execucao_db_id:
            logger.debug(f"Execução {execucao.empresa_id} não tem execucao_db_id, pulando atualização no banco")
            return
        
        db = SessionLocal()
        try:
            execucao_db = db.query(Execucao).filter(Execucao.id == execucao.execucao_db_id).first()
            
            if not execucao_db:
                logger.warning(f"Execução ID {execucao.execucao_db_id} não encontrada no banco")
                return
            
            # Atualiza campos
            execucao_db.status = status.value
            execucao_db.atualizado_em = datetime.utcnow()
            
            # Atualiza data_inicio se fornecida ou se ainda não estiver preenchida
            if data_inicio:
                execucao_db.data_inicio = data_inicio
            elif execucao.data_inicio and not execucao_db.data_inicio:
                execucao_db.data_inicio = execucao.data_inicio
            
            # Atualiza data_fim se fornecida ou se ainda não estiver preenchida
            if data_fim:
                execucao_db.data_fim = data_fim
            elif execucao.data_fim and not execucao_db.data_fim:
                execucao_db.data_fim = execucao.data_fim
            
            # Atualiza mensagem_erro se fornecida ou se houver erro no objeto
            if mensagem_erro is not None:
                execucao_db.mensagem_erro = mensagem_erro
            elif execucao.erro and not execucao_db.mensagem_erro:
                # Limita tamanho da mensagem de erro para evitar textos muito longos
                execucao_db.mensagem_erro = execucao.erro[:500]
            
            db.commit()
            logger.debug(f"Execução atualizada no banco: ID {execucao.execucao_db_id}, status {status.value}")
            
        except Exception as e:
            db.rollback()
            # Não interrompe o fluxo se falhar ao atualizar o banco
            # A execução continua normalmente, apenas sem persistência
            logger.warning(f"Erro ao atualizar execução no banco (ID {execucao.execucao_db_id}): {e}")
        finally:
            db.close()
    
    def _atualizar_mensagem_erro_db(self, execucao: ExecucaoInfo, mensagem_erro: str):
        """
        Atualiza apenas a mensagem de erro no banco de dados.
        
        Usado para atualizar mensagens de erro durante a execução sem alterar o status.
        
        Args:
            execucao: Objeto ExecucaoInfo com o estado atual
            mensagem_erro: Mensagem de erro resumida
        """
        if not execucao.execucao_db_id:
            return
        
        db = SessionLocal()
        try:
            execucao_db = db.query(Execucao).filter(Execucao.id == execucao.execucao_db_id).first()
            if execucao_db:
                execucao_db.mensagem_erro = mensagem_erro[:500]  # Limita tamanho
                execucao_db.atualizado_em = datetime.utcnow()
                db.commit()
        except Exception as e:
            db.rollback()
            logger.debug(f"Erro ao atualizar mensagem_erro no banco: {e}")
        finally:
            db.close()
    
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


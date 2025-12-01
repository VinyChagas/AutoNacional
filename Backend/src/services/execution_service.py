"""
Service para orquestração de execuções de automação NFSe - Versão Async.

REFATORADO PARA ASYNC: Este service agora usa asyncio e async_playwright
para integração correta com FastAPI, permitindo execução concorrente controlada.

Este service gerencia a fila de execuções e coordena os scripts de automação:
- Autenticação via playwright_nfse.py (async)
- Processamento de notas via processar_notas_competencia.py (async)
- Salvamento automático via salvamento.py
"""

import os
import sys
import asyncio
from typing import Dict, Optional, List
from datetime import datetime
from asyncio import Queue

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
    Service que gerencia a fila de execuções e coordena os scripts usando asyncio.
    
    REFATORADO PARA ASYNC: Agora usa async_playwright e asyncio para permitir
    execução concorrente controlada de múltiplos navegadores simultaneamente.
    
    A concorrência é controlada via asyncio.Semaphore, permitindo limitar
    a quantidade de navegadores simultâneos baseado na configuração do banco.
    """
    
    def __init__(self):
        """Inicializa o service de execução."""
        # IMPORTANTE: asyncio.Queue() e asyncio.Lock() não podem ser criados no __init__
        # porque precisam estar dentro de um evento loop. Serão criados na primeira chamada async.
        self.fila_execucoes: Optional[Queue] = None
        self.execucoes_ativas: Dict[str, ExecucaoInfo] = {}
        self.task_processadora: Optional[asyncio.Task] = None
        self.rodando = False
        self.lock: Optional[asyncio.Lock] = None
        # Semaphore para controlar concorrência de navegadores
        # O limite será configurado dinamicamente baseado no banco de dados
        self.semaphore: Optional[asyncio.Semaphore] = None
    
    async def _inicializar_recursos_async(self):
        """
        Inicializa recursos assíncronos que precisam estar dentro de um evento loop.
        
        Esta função deve ser chamada antes de usar qualquer recurso async.
        """
        if self.fila_execucoes is None:
            self.fila_execucoes = Queue()
        if self.lock is None:
            self.lock = asyncio.Lock()
    
    async def _obter_limite_concorrencia(self) -> int:
        """
        Obtém o limite de concorrência do banco de dados.
        
        Returns:
            Limite de navegadores simultâneos (padrão: 3)
        """
        try:
            from ..db.session import get_db
            from ..db.crud_settings import obter_configuracoes
            
            db = next(get_db())
            try:
                configuracoes = obter_configuracoes(db)
                if configuracoes and configuracoes.default_concurrent_browsers:
                    limite = configuracoes.default_concurrent_browsers
                    logger.info(f"Limite de concorrência obtido do banco: {limite}")
                    return limite
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Erro ao obter limite de concorrência do banco: {e}. Usando padrão.")
        
        # Padrão: 3 navegadores simultâneos
        return 3
    
    async def adicionar_execucao(
        self,
        empresa_id: str,
        cnpj: str,
        competencia: str,
        tipo: str = "ambas",
        headless: bool = None
    ) -> str:
        """
        Adiciona uma execução à fila assíncrona.
        
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
        try:
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
            
            # Inicializa recursos async se necessário
            await self._inicializar_recursos_async()
            
            # Garante que lock está inicializado
            if self.lock is None:
                await self._inicializar_recursos_async()
            
            async with self.lock:
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
                
                # Adiciona à fila assíncrona (garante que está inicializada)
                if self.fila_execucoes is None:
                    await self._inicializar_recursos_async()
                await self.fila_execucoes.put(execucao)
                self.execucoes_ativas[empresa_id] = execucao
            
            logger.info(f"Execução adicionada à fila: Empresa {empresa_id} (CNPJ: {cnpj})")
            
            # Inicia task processadora se não estiver rodando
            if not self.rodando:
                self.rodando = True
                # Inicializa semaphore se ainda não foi inicializado
                if self.semaphore is None:
                    limite = await self._obter_limite_concorrencia()
                    self.semaphore = asyncio.Semaphore(limite)
                    logger.info(f"Semaphore inicializado com limite de {limite} navegadores simultâneos")
                
                # Cria task assíncrona para processar a fila
                # IMPORTANTE: Estamos dentro de um endpoint async do FastAPI, então há um loop rodando
                try:
                    loop = asyncio.get_running_loop()
                    self.task_processadora = loop.create_task(self._processar_fila())
                    logger.info("Task processadora iniciada (async)")
                except RuntimeError as e:
                    # Se não houver loop rodando, isso é um problema
                    logger.error(f"Erro ao criar task processadora: {e}", exc_info=True)
                    # Tenta usar ensure_future como fallback
                    try:
                        self.task_processadora = asyncio.ensure_future(self._processar_fila())
                        logger.info("Task processadora criada via ensure_future")
                    except Exception as e2:
                        logger.error(f"Erro ao criar task via ensure_future: {e2}", exc_info=True)
                        # Se tudo falhar, marca como não rodando mas NÃO levanta exceção
                        # A execução já foi adicionada à fila, então pode ser processada depois
                        self.rodando = False
                        logger.warning("Task processadora não pôde ser criada, mas execução foi adicionada à fila")
            
            return empresa_id
        except ValueError:
            # Re-raise ValueError sem modificar (validações)
            raise
        except Exception as e:
            # Loga qualquer outro erro e re-raise para que o FastAPI trate
            logger.error(f"Erro ao adicionar execução: {str(e)}", exc_info=True)
            import traceback
            logger.error(f"Traceback completo:\n{traceback.format_exc()}")
            raise
    
    def obter_status(self, empresa_id: str) -> Optional[Dict]:
        """
        Obtém o status atual de uma execução.
        
        Esta função é síncrona para compatibilidade com FastAPI endpoints
        que não precisam ser async (apenas leitura).
        
        Args:
            empresa_id: ID da empresa
            
        Returns:
            Dicionário com status da execução ou None se não encontrada
        """
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
    
    async def _processar_fila(self):
        """
        Processa a fila de execuções usando asyncio.
        
        REFATORADO PARA ASYNC: Esta função agora roda em uma task asyncio,
        permitindo execução concorrente controlada via Semaphore.
        """
        # Garante que recursos async estão inicializados
        await self._inicializar_recursos_async()
        
        logger.info("Iniciando processamento da fila de execuções (async)")
        
        while True:
            try:
                # Pega próxima execução (bloqueia até ter uma)
                fila_size = self.fila_execucoes.qsize() if self.fila_execucoes else 0
                logger.info(f"Aguardando próxima execução na fila... (fila tem {fila_size} itens)")
                try:
                    # Garante que fila está inicializada
                    if self.fila_execucoes is None:
                        await self._inicializar_recursos_async()
                    execucao = await asyncio.wait_for(
                        self.fila_execucoes.get(),
                        timeout=QUEUE_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    # Timeout - verifica se deve continuar
                    logger.info(f"Timeout ao aguardar execução ({QUEUE_TIMEOUT}s)")
                    await self._inicializar_recursos_async()
                    # Garante que lock está inicializado
                    if self.lock is None:
                        await self._inicializar_recursos_async()
                    async with self.lock:
                        if self.fila_execucoes and self.fila_execucoes.empty():
                            logger.info("Fila vazia. Task processadora pausada.")
                            self.rodando = False
                            break
                        else:
                            fila_size = self.fila_execucoes.qsize() if self.fila_execucoes else 0
                            logger.info(f"Fila ainda tem itens ({fila_size}), continuando...")
                            continue
                
                logger.info(f"Execução obtida da fila: Empresa {execucao.empresa_id}")
                
                # Processa a execução usando Semaphore para controlar concorrência
                # Isso permite múltiplas execuções simultâneas, limitadas pelo Semaphore
                # Usa get_running_loop() para garantir que estamos no loop correto
                try:
                    loop = asyncio.get_running_loop()
                    # Cria task sem aguardar (fire-and-forget) para permitir concorrência
                    task = loop.create_task(self._executar_com_semaphore(execucao))
                    # Adiciona callback para logar erros não tratados na task
                    def log_task_error(task):
                        try:
                            task.result()  # Isso vai levantar exceção se houver erro
                        except Exception as e:
                            logger.error(f"Erro não tratado na task de execução para empresa {execucao.empresa_id}: {e}", exc_info=True)
                    task.add_done_callback(log_task_error)
                    logger.debug(f"Task criada para execução da empresa {execucao.empresa_id}")
                except RuntimeError as e:
                    logger.error(f"Erro ao criar task para execução: {e}", exc_info=True)
                    # Se não conseguir criar task, tenta executar diretamente (sequencial)
                    logger.warning("Executando sem task (sequencial) devido a erro no loop")
                    try:
                        await self._executar_com_semaphore(execucao)
                    except Exception as exec_error:
                        logger.error(f"Erro ao executar diretamente: {exec_error}", exc_info=True)
                        # Continua para próxima execução mesmo com erro
                except Exception as e:
                    logger.error(f"Erro inesperado ao criar task: {e}", exc_info=True)
                    # Continua para próxima execução mesmo com erro
                
            except Exception as e:
                logger.error(f"Erro no processamento da fila: {str(e)}", exc_info=True)
                # Continua processando outras execuções mesmo com erro
    
    async def _executar_com_semaphore(self, execucao: ExecucaoInfo):
        """
        Executa uma execução usando Semaphore para controlar concorrência.
        
        Esta função garante que apenas um número limitado de navegadores
        sejam executados simultaneamente, baseado na configuração do banco.
        
        Args:
            execucao: Informações da execução a ser processada
        """
        if self.semaphore is None:
            # Se semaphore não foi inicializado, inicializa agora
            limite = await self._obter_limite_concorrencia()
            self.semaphore = asyncio.Semaphore(limite)
        
        async with self.semaphore:
            # Log com identificação única para rastreamento de concorrência
            execucao_id = f"{execucao.empresa_id}-{id(execucao)}"
            logger.info(f"[{execucao_id}] Iniciando execução com controle de concorrência: Empresa {execucao.empresa_id}")
            logger.info(f"[{execucao_id}] Semaphore adquirido. Navegadores ativos limitados pelo Semaphore.")
            
            try:
                await self._executar_fluxo_completo(execucao)
                logger.info(f"[{execucao_id}] Execução concluída com sucesso para empresa {execucao.empresa_id}")
            except Exception as e:
                logger.error(f"[{execucao_id}] Erro na execução para empresa {execucao.empresa_id}: {str(e)}", exc_info=True)
            finally:
                logger.info(f"[{execucao_id}] Liberando Semaphore e marcando execução como concluída")
                # Marca como concluída na fila (se fila estiver inicializada)
                if self.fila_execucoes is not None:
                    self.fila_execucoes.task_done()
                logger.info(f"[{execucao_id}] Semaphore liberado. Outra execução pode iniciar agora.")
    
    async def _executar_fluxo_completo(self, execucao: ExecucaoInfo):
        """
        Executa o fluxo completo de automação para uma empresa (async).
        
        REFATORADO PARA ASYNC: Todos os métodos do Playwright agora usam await.
        
        Etapas:
        1. Autenticação (playwright_nfse.py - async)
        2. Processamento de notas emitidas (processar_notas_competencia.py - async)
        3. Processamento de notas recebidas (processar_notas_competencia.py - async)
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
            
            # Importa funções do playwright async
            try:
                from playwright_nfse import abrir_dashboard_nfse, NFSeAutenticacaoError
                self._adicionar_log(execucao, "Funções do Playwright Async importadas")
            except Exception as e:
                error_msg = f"Erro ao importar Playwright: {str(e)}"
                self._adicionar_log(execucao, f"❌ {error_msg}")
                raise ImportError(error_msg)
            
            self._adicionar_log(execucao, "Chamando abrir_dashboard_nfse (async)...")
            
            headless = execucao.headless if execucao.headless is not None else PLAYWRIGHT_HEADLESS
            
            try:
                # AGORA USA AWAIT - função é async
                resultado_auth = await abrir_dashboard_nfse(
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
            # Usa a versão async do processar_notas
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
                from processar_notas_competencia import set_downloads_base_path
                
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
            
            # Importa função de processamento de notas (VERSÃO ASYNC)
            try:
                from processar_notas_competencia import processar_notas
                self._adicionar_log(execucao, "Função processar_notas (async) importada")
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
                # AGORA USA AWAIT - função é async
                if execucao.tipo == "ambas":
                    # A função processar_notas já processa ambas automaticamente
                    await processar_notas(
                        page=execucao.page,
                        competencia_alvo=competencia_formatada,
                        nome_empresa=nome_empresa
                    )
                    execucao.progresso = 90
                    execucao.mensagem = "Notas emitidas e recebidas processadas com sucesso"
                    self._adicionar_log(execucao, "✅ Notas emitidas e recebidas processadas")
                    
                    # Fecha o navegador após processar notas recebidas (quando tipo é "ambas")
                    self._adicionar_log(execucao, "🔒 Fechando navegador após processamento de notas recebidas")
                    await self._limpar_recursos(execucao)
                    # Marca que recursos já foram fechados para evitar fechamento duplo no finally
                    execucao.page = None
                    execucao.context = None
                    execucao.browser = None
                    execucao.playwright = None
                elif execucao.tipo == "emitidas":
                    # Processa apenas emitidas
                    from processar_notas_competencia import processar_tabela_emitidas
                    # Acessa menu de emitidas
                    menu_emitidas = execucao.page.locator("li:nth-of-type(3) img").first
                    await menu_emitidas.wait_for(state="visible", timeout=10000)
                    await menu_emitidas.click()
                    await execucao.page.wait_for_url("**/Notas/Emitidas", timeout=15000)
                    await execucao.page.wait_for_load_state("networkidle", timeout=15000)
                    await execucao.page.wait_for_selector("table tbody tr", timeout=10000)
                    # Processa tabela (async)
                    await processar_tabela_emitidas(execucao.page, competencia_formatada, nome_empresa)
                    execucao.progresso = 90
                    execucao.mensagem = "Notas emitidas processadas com sucesso"
                    self._adicionar_log(execucao, "✅ Notas emitidas processadas")
                elif execucao.tipo == "recebidas":
                    # Processa apenas recebidas
                    from processar_notas_competencia import processar_tabela_recebidas
                    # Acessa menu de recebidas
                    menu_recebidas = execucao.page.locator("li:nth-of-type(4) img").first
                    await menu_recebidas.wait_for(state="visible", timeout=10000)
                    await menu_recebidas.click()
                    await execucao.page.wait_for_url("**/Notas/Recebidas", timeout=15000)
                    await execucao.page.wait_for_load_state("networkidle", timeout=15000)
                    await execucao.page.wait_for_selector("table tbody tr", timeout=10000)
                    # Processa tabela (async)
                    await processar_tabela_recebidas(execucao.page, competencia_formatada, nome_empresa)
                    execucao.progresso = 90
                    execucao.mensagem = "Notas recebidas processadas com sucesso"
                    self._adicionar_log(execucao, "✅ Notas recebidas processadas")
                    
                    # Fecha o navegador após processar notas recebidas
                    self._adicionar_log(execucao, "🔒 Fechando navegador após processamento de notas recebidas")
                    await self._limpar_recursos(execucao)
                    # Marca que recursos já foram fechados para evitar fechamento duplo no finally
                    execucao.page = None
                    execucao.context = None
                    execucao.browser = None
                    execucao.playwright = None
                    
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
            # Cleanup: fecha recursos do Playwright (async)
            # IMPORTANTE: Só fecha recursos se ainda não foram fechados após processar recebidas
            # (quando tipo é "recebidas" ou "ambas", os recursos já foram fechados acima)
            if execucao.page is not None or execucao.context is not None or execucao.browser is not None:
                # Se ainda houver recursos abertos, fecha
                await self._limpar_recursos(execucao)
    
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
    
    async def _limpar_recursos(self, execucao: ExecucaoInfo):
        """
        Limpa recursos do Playwright após execução (async).
        
        IMPORTANTE: Fecha recursos na ordem correta (page -> context -> browser -> playwright)
        e trata erros individualmente para garantir que todos os recursos sejam fechados
        mesmo se algum falhar.
        """
        try:
            headless = execucao.headless if execucao.headless is not None else PLAYWRIGHT_HEADLESS
            
            if headless:
                # Em modo headless, fecha tudo na ordem correta
                # Ordem: page -> context -> browser -> playwright
                
                # 1. Fecha página
                if execucao.page:
                    try:
                        await execucao.page.close()
                        logger.debug(f"Página fechada para empresa {execucao.empresa_id}")
                    except Exception as e:
                        # Página pode já estar fechada ou desconectada
                        logger.debug(f"Erro ao fechar página (pode já estar fechada): {e}")
                
                # 2. Fecha contexto
                if execucao.context:
                    try:
                        await execucao.context.close()
                        logger.debug(f"Contexto fechado para empresa {execucao.empresa_id}")
                    except Exception as e:
                        # Contexto pode já estar fechado ou desconectado
                        logger.debug(f"Erro ao fechar contexto (pode já estar fechado): {e}")
                
                # 3. Fecha browser
                if execucao.browser:
                    try:
                        await execucao.browser.close()
                        logger.debug(f"Browser fechado para empresa {execucao.empresa_id}")
                    except Exception as e:
                        # Browser pode já estar fechado ou desconectado
                        logger.debug(f"Erro ao fechar browser (pode já estar fechado): {e}")
                
                # 4. Para playwright
                if execucao.playwright:
                    try:
                        await execucao.playwright.stop()
                        logger.debug(f"Playwright parado para empresa {execucao.empresa_id}")
                    except Exception as e:
                        logger.debug(f"Erro ao parar playwright (pode já estar parado): {e}")
                
                # Limpa referências para evitar uso acidental
                execucao.page = None
                execucao.context = None
                execucao.browser = None
                execucao.playwright = None
                
                self._adicionar_log(execucao, "🧹 Recursos liberados (modo headless)")
            else:
                # Em modo visível, mantém navegador aberto
                self._adicionar_log(execucao, "🌐 Navegador mantido aberto para visualização")
                
        except Exception as e:
            logger.error(f"Erro ao limpar recursos para empresa {execucao.empresa_id}: {str(e)}", exc_info=True)
            # Tenta limpar referências mesmo em caso de erro
            try:
                execucao.page = None
                execucao.context = None
                execucao.browser = None
                execucao.playwright = None
            except:
                pass
    
    def _criar_execucao_db(self, empresa_id: str, status: StatusExecucao) -> int:
        """
        Cria um novo registro de execução no banco de dados.
        
        Esta função é síncrona porque opera diretamente com SQLAlchemy.
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
        
        Esta função é síncrona porque opera diretamente com SQLAlchemy.
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
            logger.warning(f"Erro ao atualizar execução no banco (ID {execucao.execucao_db_id}): {e}")
        finally:
            db.close()
    
    def _atualizar_mensagem_erro_db(self, execucao: ExecucaoInfo, mensagem_erro: str):
        """
        Atualiza apenas a mensagem de erro no banco de dados.
        
        Esta função é síncrona porque opera diretamente com SQLAlchemy.
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
    
    async def executar_multiplas_empresas(
        self,
        lista_execucoes: List[Dict],
        limite_concorrencia: Optional[int] = None
    ):
        """
        Executa múltiplas empresas em paralelo usando asyncio.Semaphore.
        
        Esta função permite executar várias automações simultaneamente,
        com controle de concorrência via Semaphore.
        
        Args:
            lista_execucoes: Lista de dicionários com informações de execução:
                {
                    "empresa_id": str,
                    "cnpj": str,
                    "competencia": str,
                    "tipo": str,
                    "headless": bool
                }
            limite_concorrencia: Limite de navegadores simultâneos (None = usa do banco)
        """
        if limite_concorrencia is None:
            limite_concorrencia = await self._obter_limite_concorrencia()
        
        sem = asyncio.Semaphore(limite_concorrencia)
        
        async def worker(exec_info: Dict):
            """Worker que executa uma automação com controle de concorrência."""
            async with sem:
                empresa_id = exec_info.get("empresa_id")
                cnpj = exec_info.get("cnpj")
                competencia = exec_info.get("competencia")
                tipo = exec_info.get("tipo", "ambas")
                headless = exec_info.get("headless", None)
                
                logger.info(f"Iniciando execução concorrente: Empresa {empresa_id}")
                
                # Adiciona à fila (que já tem controle de concorrência interno)
                await self.adicionar_execucao(
                    empresa_id=empresa_id,
                    cnpj=cnpj,
                    competencia=competencia,
                    tipo=tipo,
                    headless=headless
                )
        
        # Cria tasks para todas as execuções
        tasks = [asyncio.create_task(worker(info)) for info in lista_execucoes]
        
        # Aguarda todas as execuções completarem
        await asyncio.gather(*tasks)
        
        logger.info(f"Todas as {len(lista_execucoes)} execuções foram adicionadas à fila")


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


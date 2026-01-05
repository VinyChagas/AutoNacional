"""
Automação do portal NFSe Nacional usando Playwright com credenciais (CNPJ/CPF + senha).

Este módulo implementa autenticação via credenciais (CNPJ/CPF e senha) diretamente
no navegador Chromium controlado pelo Playwright.

Características:
- Usa Playwright Async API para integração correta com FastAPI e asyncio
- Busca credenciais do banco de dados
- Preenche formulário de login automaticamente
- Totalmente assíncrono para permitir execução concorrente
"""

import os
import sys
import asyncio
import platform
import logging
from typing import Tuple, Optional

# Configuração de logging (antes de qualquer uso de logger)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# IMPORTANTE: Configura o event loop policy no Windows ANTES de importar playwright
if platform.system() == "Windows":
    try:
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            logger.debug("✅ ProactorEventLoop policy configurada no módulo playwright_nfse_credenciais")
        except (AttributeError, RuntimeError) as e:
            logger.debug(f"⚠️  Não foi possível configurar ProactorEventLoop policy: {e}")
    except Exception as e:
        logger.debug(f"⚠️  Erro ao configurar event loop policy: {e}")

from playwright.async_api import (
    async_playwright,
    Browser,
    BrowserContext,
    Page,
    Playwright,
)

# Permite importar services independentemente de onde o script for executado
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_src_path = os.path.join(_backend_dir, "src")

# Adiciona backend_dir ao sys.path PRIMEIRO
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)
# Depois adiciona src_path
if _src_path not in sys.path:
    sys.path.insert(0, _src_path)

# Importações para buscar credenciais do banco
_credenciais_imported = False
_credenciais_error = None
try:
    from src.db.session import SessionLocal
    from src.db.crud_credenciais import obter_credenciais_por_empresa, decrypt_password
    from src.db.crud_empresas import obter_empresa_por_cnpj
    _credenciais_imported = True
    logger.debug("✅ Funções de credenciais importadas")
except ImportError as e:
    _credenciais_error = str(e)
    logger.warning(f"⚠️  Não foi possível importar funções de credenciais: {e}")

# URL base do portal NFSe Nacional
BASE_URL = "https://www.nfse.gov.br/EmissorNacional/"


class NFSeAutenticacaoError(Exception):
    """Erro genérico para falhas durante autenticação no portal NFSe."""
    pass


async def criar_contexto_sem_certificado(
    headless: bool = True,
    ignore_https_errors: bool = True,
    viewport: Optional[dict] = None
) -> Tuple[Playwright, Browser, BrowserContext]:
    """
    Cria um contexto do navegador Chromium sem certificado cliente.
    
    Usado para login com credenciais (CNPJ/CPF + senha).
    
    Args:
        headless: Se True, executa o navegador em modo headless
        ignore_https_errors: Se True, ignora erros de certificado SSL
        viewport: Dicionário com width e height do viewport (ex: {"width": 1920, "height": 1080})
                  Se None, usa Full HD (1920x1080) como padrão
                  
    Returns:
        Tupla (playwright, browser, context) configurados sem certificado
    """
    logger.info("🚀 Criando contexto do navegador sem certificado (para login com credenciais)")
    
    try:
        logger.info("🚀 Iniciando Playwright Async API...")
        playwright = await async_playwright().start()
        
        # Lança o Chromium
        logger.info("🌐 Lançando Chromium...")
        browser = await playwright.chromium.launch(
            headless=headless,
            args=[
                "--disable-features=DownloadBubble,DownloadBubbleV2",
                "--disable-features=SafeBrowsing",
                "--safebrowsing-disable-auto-update",
                "--safebrowsing-disable-download-protection",
                "--disable-web-security",
                "--allow-running-insecure-content",
                "--disable-notifications",
                "--disable-infobars",
            ]
        )
        
        # Define viewport: usa o fornecido ou Full HD como padrão
        viewport_config = viewport if viewport else {"width": 1920, "height": 1080}
        logger.info(f"📐 Viewport configurado: {viewport_config['width']}x{viewport_config['height']}")
        
        # Cria contexto sem certificado cliente
        context = await browser.new_context(
            ignore_https_errors=ignore_https_errors,
            viewport=viewport_config,
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            accept_downloads=True,
        )
        
        logger.info("✅ Contexto do navegador criado sem certificado cliente")
        return playwright, browser, context
        
    except Exception as e:
        error_msg = f"Erro ao criar contexto do navegador: {str(e)}"
        logger.error(f"❌ {error_msg}")
        raise NFSeAutenticacaoError(error_msg)


def _buscar_credenciais_por_cnpj(cnpj: str) -> Tuple[str, str]:
    """
    Busca credenciais de login (usuário e senha) por CNPJ.
    
    Args:
        cnpj: CNPJ da empresa (sem formatação, apenas números)
        
    Returns:
        Tupla (usuario, senha) descriptografada
        
    Raises:
        NFSeAutenticacaoError: Se credenciais não forem encontradas
    """
    if not _credenciais_imported:
        raise NFSeAutenticacaoError("Funções de credenciais não disponíveis. Verifique as importações.")
    
    cnpj_limpo = cnpj.replace(".", "").replace("/", "").replace("-", "").strip()
    
    if len(cnpj_limpo) != 14:
        raise NFSeAutenticacaoError(f"CNPJ inválido: {cnpj}. Deve conter 14 dígitos.")
    
    db = SessionLocal()
    try:
        # Busca empresa por CNPJ
        empresa = obter_empresa_por_cnpj(db, cnpj_limpo)
        if not empresa:
            raise NFSeAutenticacaoError(f"Empresa não encontrada para CNPJ: {cnpj_limpo}")
        
        # Busca credenciais da empresa
        credenciais = obter_credenciais_por_empresa(db, empresa.id)
        if not credenciais or len(credenciais) == 0:
            raise NFSeAutenticacaoError(f"Nenhuma credencial encontrada para empresa CNPJ: {cnpj_limpo}")
        
        # Usa a primeira credencial encontrada (pode ter múltiplas, mas geralmente é uma)
        credencial = credenciais[0]
        
        # Descriptografa a senha
        senha_descriptografada = decrypt_password(credencial.senha_criptografada)
        
        logger.info(f"✅ Credenciais encontradas para CNPJ {cnpj_limpo}: Tipo {credencial.tipo.value}, Usuário {credencial.usuario}")
        
        return credencial.usuario, senha_descriptografada
        
    except NFSeAutenticacaoError:
        raise
    except Exception as e:
        error_msg = f"Erro ao buscar credenciais para CNPJ {cnpj_limpo}: {str(e)}"
        logger.error(f"❌ {error_msg}")
        raise NFSeAutenticacaoError(error_msg)
    finally:
        db.close()


async def abrir_dashboard_nfse_com_credenciais(
    cnpj: str,
    headless: bool = False,
    timeout: int = 30000,
    viewport: Optional[dict] = None
) -> dict:
    """
    Abre o dashboard do portal NFSe Nacional autenticado com credenciais (CNPJ/CPF + senha).
    
    Esta função:
    1. Busca credenciais do banco de dados usando o CNPJ
    2. Cria um contexto do navegador sem certificado cliente
    3. Acessa a URL base do portal NFSe Nacional
    4. Preenche o formulário de login com CNPJ/CPF e senha
    5. Clica no botão de entrar
    6. Verifica se houve erro ou sucesso no login
    7. Retorna informações sobre o resultado da autenticação
    
    Args:
        cnpj: CNPJ da empresa (sem formatação, apenas números)
        headless: Se True, executa o navegador em modo headless (padrão: False - navegador visível)
        timeout: Timeout em milissegundos para operações do Playwright
        viewport: Dicionário com width e height do viewport (ex: {"width": 1920, "height": 1080})
                  Se None, usa Full HD (1920x1080) como padrão
                  
    Returns:
        Dicionário com informações sobre o resultado:
        {
            "sucesso": bool,
            "url_atual": str,
            "titulo": str,
            "mensagem": str,
            "logs": list[str],
            "page": Page,
            "context": BrowserContext,
            "browser": Browser,
            "playwright": Playwright
        }
        
    Raises:
        NFSeAutenticacaoError: Se a autenticação falhar ou credenciais não forem encontradas
    """
    logs = []
    playwright_instance = None
    browser = None
    context = None
    page = None
    
    def log(msg: str):
        """Helper para logging com coleta de mensagens"""
        logger.info(msg)
        logs.append(msg)
        print(msg)
    
    try:
        log(f"🚀 Iniciando automação NFSe com credenciais para CNPJ: {cnpj}")
        
        # Busca credenciais do banco
        log("📥 Buscando credenciais no banco de dados...")
        usuario, senha = _buscar_credenciais_por_cnpj(cnpj)
        log(f"✅ Credenciais encontradas: Usuário {usuario}")
        
        # Cria contexto sem certificado
        log("📋 Criando contexto do navegador sem certificado...")
        playwright_instance, browser, context = await criar_contexto_sem_certificado(
            headless=headless,
            ignore_https_errors=True,
            viewport=viewport
        )
        log("✅ Contexto criado com sucesso")
        
        # Cria uma nova página
        log("📄 Criando nova página...")
        page = await context.new_page()
        
        # Configura viewport quando não estiver em headless
        if not headless and viewport:
            try:
                await page.set_viewport_size(viewport)
                log(f"✅ Janela configurada para {viewport['width']}x{viewport['height']}")
            except Exception as e:
                log(f"⚠️  Não foi possível configurar viewport: {e}")
        
        log("✅ Página criada")
        
        # Acessa a URL base do portal
        log(f"🌐 Acessando portal NFSe Nacional: {BASE_URL}")
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=timeout)
        log(f"✅ Página carregada: {page.url}")
        
        # Aguarda elementos carregarem
        await page.wait_for_timeout(1000)
        
        # Preenche campo de CNPJ/CPF
        log("📝 Preenchendo campo de CNPJ/CPF...")
        campo_inscricao = page.locator('xpath=//*[@id="Inscricao"]')
        await campo_inscricao.fill(usuario)
        log(f"✅ Campo de inscrição preenchido com: {usuario}")
        
        # Preenche campo de senha
        log("🔐 Preenchendo campo de senha...")
        campo_senha = page.locator('xpath=//*[@id="Senha"]')
        await campo_senha.fill(senha)
        log("✅ Campo de senha preenchido")
        
        # Clica no botão de entrar
        log("🔘 Clicando no botão de entrar...")
        botao_entrar = page.locator('xpath=/html/body/section/div/div/div[2]/div[2]/div[1]/div/form/div[3]/button')
        await botao_entrar.click()
        log("✅ Botão de entrar clicado")
        
        # Espera 2 segundos para verificar resultado
        log("⏳ Aguardando 2 segundos para verificar resultado do login...")
        await page.wait_for_timeout(2000)
        
        # Verifica se houve erro no login
        log("🔍 Verificando se houve erro no login...")
        elemento_erro = page.locator('xpath=/html/body/section/div/div/div[2]/div[1]/div/div')
        # Aguarda um pouco para o elemento de erro aparecer (se houver)
        await page.wait_for_timeout(500)
        
        # Verifica se o elemento existe e está visível
        count = await elemento_erro.count()
        if count > 0:
            try:
                texto_erro = await elemento_erro.text_content(timeout=1000)
                
                if texto_erro and texto_erro.strip():
                    error_msg = f"Erro no login: {texto_erro.strip()}"
                    log(f"❌ {error_msg}")
                    # Limpa recursos antes de levantar exceção
                    try:
                        if page:
                            await page.close()
                        if context:
                            await context.close()
                        if browser:
                            await browser.close()
                        if playwright_instance:
                            await playwright_instance.stop()
                    except:
                        pass
                    raise NFSeAutenticacaoError(error_msg)
            except NFSeAutenticacaoError:
                # Re-propaga erros de autenticação imediatamente
                raise
            except Exception as e:
                # Se houve erro ao obter texto, mas elemento existe, pode ser erro de login
                log(f"⚠️  Erro ao obter texto do elemento de erro: {str(e)}")
        
        # Verifica URL e título após login
        current_url = page.url
        page_title = await page.title()
        
        log(f"📍 URL atual: {current_url}")
        log(f"📝 Título da página: {page_title}")
        
        # Verifica se há elementos que indicam dashboard/página autenticada
        dashboard_selectors = [
            'text=Dashboard',
            'text=Painel',
            '[href*="Dashboard"]',
            '.dashboard',
            '#dashboard',
        ]
        
        # Tenta encontrar seletor de dashboard
        dashboard_element = None
        for selector in dashboard_selectors:
            try:
                dashboard_element = await page.query_selector(selector)
                if dashboard_element:
                    log(f"✅ Encontrado elemento de dashboard: {selector}")
                    break
            except:
                continue
        
        # Determina se o login foi bem-sucedido
        sucesso = (
            "Dashboard" in current_url or
            "Login" not in current_url or
            dashboard_element is not None
        )
        
        if sucesso:
            log("🎉 Autenticação bem-sucedida!")
            mensagem = "Dashboard acessado com sucesso usando credenciais"
        else:
            log("⚠️  Possível falha na autenticação")
            mensagem = "Não foi possível confirmar acesso ao dashboard"
        
        # IMPORTANTE: Não fecha recursos aqui! Eles serão fechados pelo ExecutionService
        # quando a execução terminar. Isso permite que múltiplas execuções concorrentes
        # funcionem corretamente sem interferir umas nas outras.
        return {
            "sucesso": sucesso,
            "url_atual": current_url,
            "titulo": page_title,
            "mensagem": mensagem,
            "logs": logs,
            "page": page,
            "context": context,
            "browser": browser,
            "playwright": playwright_instance
        }
        
    except NFSeAutenticacaoError:
        # Re-propaga erros de autenticação
        raise
    except Exception as e:
        import traceback
        
        error_type = type(e).__name__
        error_str = str(e) if str(e) else repr(e)
        error_traceback = traceback.format_exc()
        
        error_msg = f"Erro durante automação NFSe com credenciais: [{error_type}] {error_str or 'Sem mensagem de erro'}"
        logger.error(f"❌ {error_msg}")
        logger.error(f"❌ Traceback completo:\n{error_traceback}")
        logs.append(f"❌ ERRO: {error_msg}")
        
        # Em caso de erro, limpa recursos antes de levantar exceção
        try:
            if page:
                try:
                    await page.close()
                except:
                    pass
            
            if context:
                try:
                    await context.close()
                except:
                    pass
            
            if browser:
                try:
                    await browser.close()
                except:
                    pass
            
            if playwright_instance:
                try:
                    await playwright_instance.stop()
                except:
                    pass
            
            log("🧹 Recursos liberados após erro")
        except Exception as cleanup_error:
            logger.warning(f"Erro ao limpar recursos após erro: {cleanup_error}")
        
        raise NFSeAutenticacaoError(error_msg)


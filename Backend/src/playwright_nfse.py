"""
Automação do portal NFSe Nacional usando Playwright com certificado A1.

Este módulo implementa autenticação via certificado digital A1 (.pfx) diretamente
no navegador Chromium controlado pelo Playwright, sem exibir popups de seleção
de certificado.

Características:
- Usa Playwright para controle completo do navegador
- Autenticação via certificado cliente (client_certificates)
- Certificado A1 carregado e usado diretamente no contexto do navegador
- Autenticação automática sem popups de seleção
"""

import os
import sys
import logging
from typing import Tuple

from playwright.sync_api import (
    sync_playwright,
    Browser,
    BrowserContext,
    Page,
    Playwright,
)

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Permite importar cert_storage independentemente de onde o script for executado
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

try:
    from cert_storage import carregar_certificado  # noqa: E402
except ImportError:
    # Fallback caso cert_storage esteja em outro local
    sys.path.insert(0, os.path.join(backend_dir, 'Backend'))
    from cert_storage import carregar_certificado  # noqa: E402

# URL base do portal NFSe Nacional
BASE_URL = "https://www.nfse.gov.br/EmissorNacional/"


class NFSeAutenticacaoError(Exception):
    """Erro genérico para falhas durante autenticação no portal NFSe."""
    pass


def criar_contexto_com_certificado(
    cnpj: str,
    headless: bool = True,
    ignore_https_errors: bool = True
) -> Tuple[Playwright, Browser, BrowserContext]:
    """
    Cria um contexto do navegador Chromium configurado para usar certificado A1.
    
    Esta função:
    1. Carrega o certificado A1 (.pfx) e senha usando cert_storage
    2. Inicia o Playwright e configura o Chromium para usar o certificado
    3. Usa a funcionalidade nativa do Playwright (client_certificates) para
       autenticação via certificado cliente sem popups de seleção
    4. Retorna o playwright, browser e context configurados
    
    Args:
        cnpj: CNPJ da empresa (sem formatação, apenas números)
        headless: Se True, executa o navegador em modo headless
        ignore_https_errors: Se True, ignora erros de certificado SSL
        
    Returns:
        Tupla (playwright, browser, context) configurados com certificado
        
    Raises:
        NFSeAutenticacaoError: Se o certificado não for encontrado ou inválido
    """
    logger.info(f"🔐 Iniciando criação de contexto com certificado A1 para CNPJ: {cnpj}")
    
    try:
        # Carrega o certificado e senha descriptografados
        logger.info("📥 Carregando certificado do armazenamento...")
        conteudo_pfx, senha = carregar_certificado(cnpj)
        logger.info("✅ Certificado carregado com sucesso")
        
    except FileNotFoundError as e:
        error_msg = f"Certificado não encontrado para CNPJ {cnpj}: {str(e)}"
        logger.error(f"❌ {error_msg}")
        raise NFSeAutenticacaoError(error_msg)
    except Exception as e:
        error_msg = f"Erro ao carregar certificado para CNPJ {cnpj}: {str(e)}"
        logger.error(f"❌ {error_msg}")
        raise NFSeAutenticacaoError(error_msg)
    
    try:
        # Inicia o Playwright
        logger.info("🚀 Iniciando Playwright...")
        playwright = sync_playwright().start()
        
        # Lança o Chromium
        logger.info("🌐 Lançando Chromium...")
        browser = playwright.chromium.launch(
            headless=headless,
        )
        
        # Cria um contexto com certificado cliente configurado
        # O Playwright Python (versão 1.46+) suporta certificados cliente
        # através do parâmetro client_certificates no new_context()
        # Isso permite autenticação via certificado A1 sem popups de seleção
        
        logger.info("🔐 Configurando certificado cliente no contexto do navegador...")
        context = browser.new_context(
            ignore_https_errors=ignore_https_errors,
            viewport={"width": 1920, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            # Configuração de certificado cliente (suportado desde Playwright 1.46+)
            # O certificado será usado automaticamente para requisições HTTPS
            # ao domínio especificado, sem exibir popup de seleção
            client_certificates=[{
                "origin": "https://www.nfse.gov.br",  # Domínio do portal NFSe
                "pfx": conteudo_pfx,  # Conteúdo do certificado em bytes
                "passphrase": senha  # Senha do certificado
            }]
        )
        
        logger.info("✅ Contexto do navegador criado com certificado cliente configurado")
        logger.info("   O certificado será usado automaticamente para autenticação")
        logger.info("   sem exibir popups de seleção")
        
        return playwright, browser, context
        
    except Exception as e:
        error_msg = f"Erro ao criar contexto com certificado: {str(e)}"
        logger.error(f"❌ {error_msg}")
        raise NFSeAutenticacaoError(error_msg)


def abrir_dashboard_nfse(
    cnpj: str,
    headless: bool = False,
    timeout: int = 30000
) -> dict:
    """
    Abre o dashboard do portal NFSe Nacional autenticado com certificado A1.
    
    Esta função:
    1. Cria um contexto do navegador com certificado A1
    2. Acessa a URL base do portal NFSe Nacional
    3. Navega até o dashboard autenticado
    4. Espera por elementos que confirmem o login bem-sucedido
    5. Retorna informações sobre o resultado da autenticação
    
    Args:
        cnpj: CNPJ da empresa (sem formatação, apenas números)
        headless: Se True, executa o navegador em modo headless (padrão: False - navegador visível)
        timeout: Timeout em milissegundos para operações do Playwright
        
    Returns:
        Dicionário com informações sobre o resultado:
        {
            "sucesso": bool,
            "url_atual": str,
            "titulo": str,
            "mensagem": str,
            "logs": list[str]
        }
        
    Raises:
        NFSeAutenticacaoError: Se a autenticação falhar
    """
    logs = []
    playwright = None
    browser = None
    context = None
    page = None
    
    def log(msg: str):
        """Helper para logging com coleta de mensagens"""
        logger.info(msg)
        logs.append(msg)
        print(msg)
    
    try:
        log(f"🚀 Iniciando automação NFSe para CNPJ: {cnpj}")
        
        # Cria contexto com certificado
        log("📋 Criando contexto do navegador com certificado A1...")
        playwright, browser, context = criar_contexto_com_certificado(
            cnpj=cnpj,
            headless=headless,
            ignore_https_errors=True
        )
        log("✅ Contexto criado com sucesso")
        
        # Cria uma nova página
        log("📄 Criando nova página...")
        page = context.new_page()
        log("✅ Página criada")
        
        # Acessa a URL base do portal
        log(f"🌐 Acessando portal NFSe Nacional: {BASE_URL}")
        page.goto(BASE_URL, wait_until="networkidle", timeout=timeout)
        log(f"✅ Página carregada: {page.url}")
        
        # Aguarda um pouco para a página processar
        page.wait_for_timeout(2000)
        
        # Tenta detectar se estamos na página de login ou já autenticados
        current_url = page.url
        page_title = page.title()
        
        log(f"📍 URL atual: {current_url}")
        log(f"📝 Título da página: {page_title}")
        
        # Verifica se há elementos que indicam página de login
        login_selectors = [
            'button:has-text("Certificado")',
            'a:has-text("Certificado")',
            'input[type="button"][value*="ertificado"]',
            '#btnCertificado',
            '.btn-certificado',
        ]
        
        # Verifica se há elementos que indicam dashboard/página autenticada
        dashboard_selectors = [
            'text=Dashboard',
            'text=Painel',
            '[href*="Dashboard"]',
            '.dashboard',
            '#dashboard',
        ]
        
        # Tenta encontrar seletor de login
        login_element = None
        for selector in login_selectors:
            try:
                login_element = page.query_selector(selector)
                if login_element:
                    log(f"🔍 Encontrado elemento de login: {selector}")
                    break
            except:
                continue
        
        # Tenta encontrar seletor de dashboard
        dashboard_element = None
        for selector in dashboard_selectors:
            try:
                dashboard_element = page.query_selector(selector)
                if dashboard_element:
                    log(f"✅ Encontrado elemento de dashboard: {selector}")
                    break
            except:
                continue
        
        # Se encontrou elemento de login, tenta clicar
        if login_element and not dashboard_element:
            log("🔐 Elemento de login encontrado - tentando autenticar...")
            try:
                # Clica no botão de certificado
                login_element.click(timeout=5000)
                log("✅ Clique no botão de certificado realizado")
                
                # Aguarda redirecionamento ou mudança na página
                page.wait_for_timeout(3000)
                
                # Aguarda por elementos do dashboard ou mudança de URL
                try:
                    page.wait_for_selector(
                        'text=Dashboard',
                        timeout=timeout,
                        state="visible"
                    )
                    log("✅ Dashboard detectado após autenticação!")
                except:
                    # Tenta outros seletores
                    try:
                        page.wait_for_load_state("networkidle", timeout=timeout)
                        log("✅ Página carregada completamente")
                    except:
                        pass
                
            except Exception as e:
                log(f"⚠️  Erro ao clicar no botão de certificado: {str(e)}")
                # Continua mesmo assim, pode ter autenticado automaticamente
        elif dashboard_element:
            log("✅ Já autenticado - dashboard detectado diretamente!")
        else:
            log("⚠️  Não foi possível detectar elementos de login ou dashboard")
            log("   Continuando com a URL atual...")
        
        # Verifica URL final
        final_url = page.url
        final_title = page.title()
        
        log(f"📍 URL final: {final_url}")
        log(f"📝 Título final: {final_title}")
        
        # Determina se o login foi bem-sucedido
        sucesso = (
            "Dashboard" in final_url or
            "Login" not in final_url or
            dashboard_element is not None
        )
        
        if sucesso:
            log("🎉 Autenticação bem-sucedida!")
            mensagem = "Dashboard acessado com sucesso"
        else:
            log("⚠️  Possível falha na autenticação")
            mensagem = "Não foi possível confirmar acesso ao dashboard"
        
        return {
            "sucesso": sucesso,
            "url_atual": final_url,
            "titulo": final_title,
            "mensagem": mensagem,
            "logs": logs
        }
        
    except Exception as e:
        error_msg = f"Erro durante automação NFSe: {str(e)}"
        logger.error(f"❌ {error_msg}")
        logs.append(f"❌ ERRO: {error_msg}")
        
        raise NFSeAutenticacaoError(error_msg)
        
    finally:
        # Se estiver em modo headless, fecha tudo automaticamente
        # Se não estiver em headless, mantém o navegador aberto para o usuário ver
        if headless:
            # Limpa recursos apenas em modo headless
            if page:
                try:
                    page.close()
                except:
                    pass
            
            if context:
                try:
                    context.close()
                except:
                    pass
            
            if browser:
                try:
                    browser.close()
                except:
                    pass
            
            if playwright:
                try:
                    playwright.stop()
                except:
                    pass
            
            log("🧹 Recursos liberados (modo headless)")
        else:
            # Em modo visível, mantém o navegador aberto
            log("🌐 Navegador mantido aberto para visualização")
            log("   O navegador será fechado quando o script terminar")


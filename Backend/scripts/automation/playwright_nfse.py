"""
Automação do portal NFSe Nacional usando Playwright com certificado A1.

Este módulo implementa autenticação via certificado digital A1 (.pfx) diretamente
no navegador Chromium controlado pelo Playwright, sem exibir popups de seleção
de certificado.

Características:
- Usa Playwright Async API para integração correta com FastAPI e asyncio
- Autenticação via certificado cliente (client_certificates)
- Certificado A1 carregado e usado diretamente no contexto do navegador
- Autenticação automática sem popups de seleção
- Totalmente assíncrono para permitir execução concorrente
"""

import os
import sys
import platform
import asyncio
import logging
from typing import Tuple, Optional

# Configuração de logging (antes de qualquer uso de logger)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# IMPORTANTE: Configura o event loop policy no Windows ANTES de importar playwright
# Isso garante que o ProactorEventLoop seja usado, permitindo subprocessos no Windows
# Nota: Esta configuração precisa ser feita ANTES de qualquer event loop ser criado.
# O servidor deve ser iniciado via run_server.py para garantir que a política seja
# configurada antes do uvicorn iniciar seu event loop.
if platform.system() == "Windows":
    try:
        # Tenta configurar a política de event loop para ProactorEventLoop
        # Isso só funciona se nenhum event loop foi criado ainda
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            logger.debug("✅ ProactorEventLoop policy configurada no módulo playwright_nfse")
        except (AttributeError, RuntimeError) as e:
            # Se falhar, pode ser que um loop já exista ou a política já esteja configurada
            logger.debug(f"⚠️  Não foi possível configurar ProactorEventLoop policy: {e}")
            logger.debug("   Isso é normal se o servidor foi iniciado via run_server.py")
    except Exception as e:
        logger.debug(f"⚠️  Erro ao configurar event loop policy: {e}")

from playwright.async_api import (
    async_playwright,
    Browser,
    BrowserContext,
    Page,
    Playwright,
)

# Importações para conversão de certificados TLS legados
try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.serialization import pkcs12
    CRYPTOGRAPHY_AVAILABLE = True
except ImportError:
    CRYPTOGRAPHY_AVAILABLE = False
    logger.warning("⚠️  Biblioteca cryptography não disponível. Conversão de certificados TLS legados desabilitada.")

# Permite importar services independentemente de onde o script for executado
# IMPORTANTE: Este código deve executar ANTES de qualquer import que dependa dele
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_src_path = os.path.join(_backend_dir, "src")

# Adiciona backend_dir ao sys.path PRIMEIRO (para que src seja reconhecido como pacote)
# Isso permite fazer "from src.services.certificate_service import ..."
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)
# Depois adiciona src_path (para imports diretos de services quando src está no path)
if _src_path not in sys.path:
    sys.path.insert(0, _src_path)

# Importa certificate_service - tenta múltiplas formas
_certificate_service_imported = False
_certificate_service_error = None
_get_certificate_service_func = None

try:
    # Tentativa 1: Import usando src.services (quando backend_dir está no path)
    from src.services.certificate_service import get_certificate_service  # noqa: E402
    _get_certificate_service_func = get_certificate_service
    _certificate_service_imported = True
    logger.debug("✅ CertificateService importado via src.services")
except ImportError as e1:
    _certificate_service_error = f"src.services: {e1}"
    try:
        # Tentativa 2: Import direto de services (quando src está no path)
        from services.certificate_service import get_certificate_service  # noqa: E402
        _get_certificate_service_func = get_certificate_service
        _certificate_service_imported = True
        logger.debug("✅ CertificateService importado via services")
    except ImportError as e2:
        # Se ambas falharem, o erro será levantado quando tentar usar
        _certificate_service_error = f"src.services: {e1}; services: {e2}"

if not _certificate_service_imported:
    # Se não conseguiu importar, levanta erro com detalhes
    error_msg = (
        f"Não foi possível importar certificate_service.\n"
        f"  Erros: {_certificate_service_error}\n"
        f"  Backend dir: {_backend_dir}\n"
        f"  Src path: {_src_path}\n"
        f"  Src existe: {os.path.exists(_src_path)}\n"
        f"  Backend no path: {_backend_dir in sys.path}\n"
        f"  Src no path: {_src_path in sys.path}\n"
        f"  Sys.path (primeiros 3): {sys.path[:3]}"
    )
    logger.error(error_msg)
    raise ImportError(error_msg)

# Expõe a função para uso no módulo
get_certificate_service = _get_certificate_service_func

# URL base do portal NFSe Nacional
BASE_URL = "https://www.nfse.gov.br/EmissorNacional/"


def _converter_certificado_tls_moderno(conteudo_pfx: bytes, senha: str) -> Optional[bytes]:
    """
    Tenta converter um certificado PFX legado para um formato moderno compatível com OpenSSL.
    
    Esta função tenta re-exportar o certificado usando algoritmos de criptografia modernos,
    o que pode resolver problemas com certificados que usam algoritmos TLS depreciados.
    
    Args:
        conteudo_pfx: Conteúdo do arquivo PFX em bytes
        senha: Senha do certificado
        
    Returns:
        Bytes do certificado convertido, ou None se a conversão falhar
    """
    if not CRYPTOGRAPHY_AVAILABLE:
        return None
    
    try:
        senha_bytes = senha.encode('utf-8') if senha else None
        
        # Carrega o certificado original
        key, cert, additional_certs = pkcs12.load_key_and_certificates(
            conteudo_pfx, 
            senha_bytes
        )
        
        # Re-exporta usando algoritmos modernos
        # BestAvailableEncryption usa PBES2 (mais moderno) ao invés de PBES1 (legado)
        pfx_modernizado = pkcs12.serialize_key_and_certificates(
            name=b"certificado",
            key=key,
            cert=cert,
            cas=additional_certs or [],
            encryption_algorithm=serialization.BestAvailableEncryption(senha_bytes)
        )
        
        logger.info("✅ Certificado convertido para formato TLS moderno")
        return pfx_modernizado
        
    except Exception as e:
        logger.debug(f"⚠️  Não foi possível converter certificado: {e}")
        return None


def _is_tls_legacy_error(error_str: str) -> bool:
    """
    Verifica se o erro é relacionado a certificado TLS legado.
    
    Args:
        error_str: String do erro
        
    Returns:
        True se for erro de certificado TLS legado
    """
    error_lower = error_str.lower()
    return (
        "unsupported tls certificate" in error_lower or
        "deprecated" in error_lower or
        "legacy provider" in error_lower or
        "security algorithm" in error_lower
    )


class NFSeAutenticacaoError(Exception):
    """Erro genérico para falhas durante autenticação no portal NFSe."""
    pass




async def criar_contexto_com_certificado(
    cnpj: str,
    headless: bool = True,
    ignore_https_errors: bool = True,
    viewport: Optional[dict] = None
) -> Tuple[Playwright, Browser, BrowserContext]:
    """
    Cria um contexto do navegador Chromium configurado para usar certificado A1.
    
    REFATORADO PARA ASYNC: Esta função agora usa async_playwright para integração
    correta com FastAPI e asyncio, permitindo execução concorrente.
    
    Esta função:
    1. Carrega o certificado A1 (.pfx) e senha usando CertificateService
    2. Inicia o Playwright Async API e configura o Chromium para usar o certificado
    3. Usa a funcionalidade nativa do Playwright (client_certificates) para
       autenticação via certificado cliente sem popups de seleção
    4. Retorna o playwright, browser e context configurados
    
    Args:
        cnpj: CNPJ da empresa (sem formatação, apenas números)
        headless: Se True, executa o navegador em modo headless
        ignore_https_errors: Se True, ignora erros de certificado SSL
        viewport: Dicionário com width e height do viewport (ex: {"width": 1920, "height": 1080})
                  Se None, usa Full HD (1920x1080) como padrão
        
    Returns:
        Tupla (playwright, browser, context) configurados com certificado
        
    Raises:
        NFSeAutenticacaoError: Se o certificado não for encontrado ou inválido
    """
    logger.info(f"🔐 Iniciando criação de contexto com certificado A1 para CNPJ: {cnpj}")
    
    try:
        # Carrega o certificado e senha descriptografados usando o service
        logger.info("📥 Carregando certificado do armazenamento...")
        certificate_service = get_certificate_service()
        conteudo_pfx, senha = certificate_service.carregar_certificado(cnpj)
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
        logger.info("🚀 Iniciando Playwright Async API...")
        playwright = await async_playwright().start()
        
        # Lança o Chromium
        logger.info("🌐 Lançando Chromium...")
        browser = await playwright.chromium.launch(
            headless=headless,
            args=[
                # Desabilita avisos de segurança de download
                "--disable-features=DownloadBubble,DownloadBubbleV2",
                "--disable-features=SafeBrowsing",
                "--safebrowsing-disable-auto-update",
                "--safebrowsing-disable-download-protection",
                # Permite downloads automáticos sem confirmação
                "--disable-web-security",
                "--allow-running-insecure-content",
                # Desabilita notificações de download perigoso
                "--disable-notifications",
                "--disable-infobars",
            ]
        )
        
        # Cria um contexto com certificado cliente configurado
        # O Playwright Python (versão 1.46+) suporta certificados cliente
        # através do parâmetro client_certificates no new_context()
        # Isso permite autenticação via certificado A1 sem popups de seleção
        
        logger.info("🔐 Configurando certificado cliente no contexto do navegador...")
        
        # Define viewport: usa o fornecido ou Full HD como padrão
        viewport_config = viewport if viewport else {"width": 1920, "height": 1080}
        logger.info(f"📐 Viewport configurado: {viewport_config['width']}x{viewport_config['height']}")
        
        # Prepara configuração do contexto
        context_config = {
            "ignore_https_errors": ignore_https_errors,
            "viewport": viewport_config,
            "user_agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "accept_downloads": True,
        }
        
        # Tenta criar contexto com certificado original primeiro
        pfx_para_usar = conteudo_pfx
        context = None
        erro_original = None
        
        try:
            context_config["client_certificates"] = [{
                "origin": "https://www.nfse.gov.br",
                "pfx": pfx_para_usar,
                "passphrase": senha
            }]
            context = await browser.new_context(**context_config)
            logger.info("✅ Contexto do navegador criado com certificado cliente configurado")
            
        except Exception as e:
            erro_original = e
            error_str = str(e)
            
            # Verifica se é erro de certificado TLS legado
            if _is_tls_legacy_error(error_str):
                logger.warning(f"⚠️  Erro de certificado TLS legado detectado: {error_str[:100]}...")
                logger.info("🔄 Tentando converter certificado para formato moderno...")
                
                # Tenta converter o certificado para formato moderno
                pfx_convertido = _converter_certificado_tls_moderno(conteudo_pfx, senha)
                
                if pfx_convertido:
                    try:
                        # Tenta novamente com certificado convertido
                        context_config["client_certificates"] = [{
                            "origin": "https://www.nfse.gov.br",
                            "pfx": pfx_convertido,
                            "passphrase": senha
                        }]
                        context = await browser.new_context(**context_config)
                        logger.info("✅ Contexto criado com certificado convertido para formato moderno")
                        
                    except Exception as e2:
                        error_str2 = str(e2)
                        logger.error(f"❌ Certificado convertido também falhou: {error_str2[:100]}...")
                        
                        # Se ainda falhar, fornece mensagem de erro detalhada
                        error_msg = (
                            f"❌ Certificado TLS legado não suportado para CNPJ {cnpj}.\n\n"
                            f"O certificado digital usa algoritmos de segurança depreciados pelo OpenSSL moderno.\n"
                            f"Mesmo após tentativa de conversão, o certificado não pôde ser usado.\n\n"
                            f"💡 Soluções recomendadas:\n"
                            f"1. ✅ RENOVAR o certificado digital com a autoridade certificadora\n"
                            f"   - Solicite um novo certificado com algoritmos modernos (SHA-256 ou superior)\n"
                            f"   - Certificados antigos com MD5 ou SHA1 não são mais suportados\n"
                            f"2. 📞 Contatar a autoridade certificadora (Serasa, Serpro, Certisign, etc.)\n"
                            f"   - Explique que o certificado precisa ser atualizado para algoritmos modernos\n"
                            f"   - Mencione que está usando OpenSSL moderno que não suporta algoritmos legados\n"
                            f"3. 🔄 Verificar se há uma versão mais recente do certificado disponível\n\n"
                            f"⚠️  Nota: Outros certificados funcionam normalmente porque usam algoritmos modernos.\n"
                            f"Este certificado específico precisa ser renovado para funcionar.\n\n"
                            f"Erro técnico original: {error_str[:200]}"
                        )
                        logger.error(error_msg)
                        raise NFSeAutenticacaoError(error_msg)
                else:
                    # Conversão não disponível ou falhou
                    error_msg = (
                        f"❌ Certificado TLS legado não suportado para CNPJ {cnpj}.\n\n"
                        f"O certificado digital usa algoritmos de segurança depreciados pelo OpenSSL moderno.\n"
                        f"Este é um problema comum com certificados antigos que usam algoritmos como MD5 ou SHA1.\n\n"
                        f"💡 Soluções recomendadas:\n"
                        f"1. ✅ RENOVAR o certificado digital com a autoridade certificadora\n"
                        f"   - Solicite um novo certificado com algoritmos modernos (SHA-256 ou superior)\n"
                        f"   - Certificados antigos com MD5 ou SHA1 não são mais suportados\n"
                        f"2. 📞 Contatar a autoridade certificadora (Serasa, Serpro, Certisign, etc.)\n"
                        f"   - Explique que o certificado precisa ser atualizado para algoritmos modernos\n"
                        f"   - Mencione que está usando OpenSSL moderno que não suporta algoritmos legados\n"
                        f"3. 🔄 Verificar se há uma versão mais recente do certificado disponível\n\n"
                        f"⚠️  Nota: Outros certificados funcionam normalmente porque usam algoritmos modernos.\n"
                        f"Este certificado específico precisa ser renovado para funcionar.\n\n"
                        f"Erro técnico: {error_str[:200]}"
                    )
                    logger.error(error_msg)
                    raise NFSeAutenticacaoError(error_msg)
            else:
                # Outro tipo de erro, propaga normalmente
                error_msg = f"Erro ao criar contexto com certificado: {error_str}"
                logger.error(f"❌ {error_msg}")
                raise NFSeAutenticacaoError(error_msg)
        
        if context:
            logger.info("   O certificado será usado automaticamente para autenticação")
            logger.info("   sem exibir popups de seleção")
            return playwright, browser, context
        else:
            raise NFSeAutenticacaoError("Não foi possível criar contexto do navegador")
        
    except NFSeAutenticacaoError:
        # Re-propaga erros de autenticação
        raise
    except Exception as e:
        # Captura informações detalhadas do erro
        error_type = type(e).__name__
        error_str = str(e) if str(e) else repr(e)
        import traceback
        error_traceback = traceback.format_exc()
        
        # Se a mensagem estiver vazia, tenta obter mais informações
        if not error_str or error_str.strip() == '':
            error_str = f"{error_type} sem mensagem. Verifique os logs do servidor para detalhes."
        
        error_msg = f"Erro inesperado ao criar contexto com certificado: [{error_type}] {error_str}"
        logger.error(f"❌ {error_msg}")
        logger.error(f"❌ Tipo de exceção: {error_type}")
        logger.error(f"❌ Args da exceção: {getattr(e, 'args', 'N/A')}")
        logger.error(f"❌ Traceback completo:\n{error_traceback}")
        raise NFSeAutenticacaoError(error_msg)


async def abrir_dashboard_nfse(
    cnpj: str,
    headless: bool = False,
    timeout: int = 30000,
    viewport: Optional[dict] = None
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
        viewport: Dicionário com width e height do viewport (ex: {"width": 1920, "height": 1080})
                  Se None, usa Full HD (1920x1080) como padrão
        
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
        log(f"🚀 Iniciando automação NFSe para CNPJ: {cnpj}")
        
        # Cria contexto com certificado
        log("📋 Criando contexto do navegador com certificado A1...")
        playwright_instance, browser, context = await criar_contexto_com_certificado(
            cnpj=cnpj,
            headless=headless,
            ignore_https_errors=True,
            viewport=viewport
        )
        log("✅ Contexto criado com sucesso")
        
        # Cria uma nova página
        log("📄 Criando nova página...")
        page = await context.new_page()
        
        # Configura viewport quando não estiver em headless (já configurado no contexto, mas garante)
        if not headless and viewport:
            try:
                await page.set_viewport_size(viewport)
                log(f"✅ Janela configurada para {viewport['width']}x{viewport['height']}")
            except Exception as e:
                log(f"⚠️  Não foi possível configurar viewport: {e}")
        
        log("✅ Página criada")
        
        # Acessa a URL base do portal
        log(f"🌐 Acessando portal NFSe Nacional: {BASE_URL}")
        # Usa 'domcontentloaded' ao invés de 'networkidle' para ser mais rápido
        # 'networkidle' espera por até 500ms sem requisições de rede, o que pode ser lento
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=timeout)
        log(f"✅ Página carregada: {page.url}")
        
        # Aguarda apenas o necessário para elementos críticos carregarem
        # Reduzido de 2000ms para 500ms - otimização de tempo
        await page.wait_for_timeout(500)
        
        # Tenta detectar se estamos na página de login ou já autenticados
        current_url = page.url
        page_title = await page.title()
        
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
                login_element = await page.query_selector(selector)
                if login_element:
                    log(f"🔍 Encontrado elemento de login: {selector}")
                    break
            except:
                continue
        
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
        
        # Se encontrou elemento de login, tenta clicar
        if login_element and not dashboard_element:
            log("🔐 Elemento de login encontrado - tentando autenticar...")
            try:
                # Clica no botão de certificado
                await login_element.click(timeout=5000)
                log("✅ Clique no botão de certificado realizado")
                
                # Aguarda redirecionamento de forma mais eficiente
                # Reduzido de 3000ms para espera condicional - otimização de tempo
                try:
                    # Espera por mudança de URL ou elementos do dashboard (mais rápido)
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)
                    # Aguarda um pouco para JavaScript processar
                    await page.wait_for_timeout(500)
                    
                    # Verifica se dashboard apareceu
                    await page.wait_for_selector(
                        'text=Dashboard',
                        timeout=5000,
                        state="visible"
                    )
                    log("✅ Dashboard detectado após autenticação!")
                except:
                    # Fallback: aguarda carregamento completo se necessário
                    try:
                        await page.wait_for_load_state("load", timeout=5000)
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
        final_title = await page.title()
        
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
        
        # IMPORTANTE: Não fecha recursos aqui! Eles serão fechados pelo ExecutionService
        # quando a execução terminar. Isso permite que múltiplas execuções concorrentes
        # funcionem corretamente sem interferir umas nas outras.
        return {
            "sucesso": sucesso,
            "url_atual": final_url,
            "titulo": final_title,
            "mensagem": mensagem,
            "logs": logs,
            "page": page,
            "context": context,
            "browser": browser,
            "playwright": playwright_instance
        }
        
    except Exception as e:
        import traceback
        
        error_type = type(e).__name__
        error_str = str(e) if str(e) else repr(e)
        error_traceback = traceback.format_exc()
        
        error_msg = f"Erro durante automação NFSe: [{error_type}] {error_str or 'Sem mensagem de erro'}"
        logger.error(f"❌ {error_msg}")
        logger.error(f"❌ Traceback completo:\n{error_traceback}")
        logs.append(f"❌ ERRO: {error_msg}")
        
        # Em caso de erro, limpa recursos antes de levantar exceção
        # para evitar vazamento de recursos
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


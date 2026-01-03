"""
Automação para processar notas fiscais de uma competência específica no portal NFSe Nacional.

Este módulo implementa a varredura completa de notas emitidas e recebidas para uma
competência específica, fazendo download de XML e DANFS-e (PDF) para notas válidas.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Optional
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

# Configuração de logging (deve vir antes de usar logger)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Importa o módulo de gerenciamento de downloads
# IMPORTANTE: Usa import absoluto porque o módulo é importado diretamente (não como pacote)
# O scripts_automation_path é adicionado ao sys.path, então os módulos são tratados como standalone
try:
    # Tenta import absoluto primeiro (quando usado como módulo standalone via sys.path)
    from download_manager import (
        set_downloads_base_path as set_base_path,
        get_download_base_path,
        salvar_download_direto
    )
    logger.debug("download_manager importado com sucesso (import absoluto)")
except ImportError as e1:
    # Fallback para import relativo (quando usado como pacote)
    try:
        from .download_manager import (
            set_downloads_base_path as set_base_path,
            get_download_base_path,
            salvar_download_direto
        )
        logger.debug("download_manager importado com sucesso (import relativo)")
    except ImportError as e2:
        # Se não conseguir importar, cria stubs para evitar erros
        logger.warning(f"download_manager não disponível. Import absoluto: {e1}, Import relativo: {e2}")
        logger.warning("Algumas funcionalidades podem não funcionar.")
        def set_base_path(path: str) -> None:
            pass
        def get_download_base_path() -> str:
            return "./downloads"
        def salvar_download_direto(*args, **kwargs):
            pass


def set_downloads_base_path(path: str) -> None:
    """
    Define o caminho base para downloads.
    
    Esta função é um wrapper que configura o caminho base no módulo download_manager.
    
    Args:
        path: Caminho base para downloads
    """
    set_base_path(path)


# Cache para configurações (evita múltiplas consultas ao banco)
_configuracoes_cache: Optional[dict] = None


def _obter_configuracoes() -> dict:
    """
    Obtém configurações do banco de dados (com cache).
    
    Returns:
        Dicionário com configurações ou valores padrão se não conseguir obter
    """
    global _configuracoes_cache
    
    # Se já tem cache, retorna
    if _configuracoes_cache is not None:
        return _configuracoes_cache
    
    try:
        # Tenta importar e obter configurações do banco
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        src_path = os.path.join(backend_dir, "src")
        
        if src_path not in sys.path:
            sys.path.insert(0, src_path)
        
        from db.session import get_db
        from db.crud_settings import obter_configuracoes
        
        db = next(get_db())
        try:
            configuracoes = obter_configuracoes(db)
            if configuracoes:
                _configuracoes_cache = {
                    "min_action_delay_ms": configuracoes.min_action_delay_ms or 500,
                    "max_retries_per_step": configuracoes.max_retries_per_step or 3,
                }
                logger.debug(f"Configurações obtidas do banco: {_configuracoes_cache}")
                return _configuracoes_cache
        finally:
            db.close()
    except Exception as e:
        logger.debug(f"Erro ao obter configurações: {e}. Usando padrões.")
    
    # Valores padrão se não conseguir obter
    _configuracoes_cache = {
        "min_action_delay_ms": 500,
        "max_retries_per_step": 3,
    }
    return _configuracoes_cache


def get_min_action_delay_ms() -> int:
    """
    Obtém o delay mínimo entre ações em milissegundos.
    
    Returns:
        Delay em milissegundos (padrão: 500)
    """
    config = _obter_configuracoes()
    return config.get("min_action_delay_ms", 500)


def normalizar_competencia(valor: str) -> str:
    """
    Normaliza a competência para comparação.
    
    Aceita formatos:
    - "MM/AAAA" (ex: "10/2025") → mantém como está
    - "MM-AAAA" (ex: "10-2025") → converte para "MM/AAAA"
    - "MMAAAA" (ex: "102025") → converte para "MM/AAAA"
    
    Args:
        valor: Competência em qualquer formato
        
    Returns:
        Competência normalizada no formato "MM/AAAA"
    """
    if not valor:
        logger.warning("⚠️ Competência vazia recebida na normalização")
        return ""
    
    competencia_original = valor
    competencia = valor.strip()
    
    # Se já está no formato "MM/AAAA", retorna como está
    if "/" in competencia:
        logger.debug(f"🔄 Normalização: '{competencia_original}' -> '{competencia}' (já tem /)")
        return competencia
    
    # Se está no formato "MM-AAAA", converte para "MM/AAAA"
    if "-" in competencia:
        resultado = competencia.replace("-", "/")
        logger.debug(f"🔄 Normalização: '{competencia_original}' -> '{resultado}' (substituiu -)")
        return resultado
    
    # Se está no formato "MMAAAA" (ex: "102025"), converte para "MM/AAAA"
    if len(competencia) == 6 and competencia.isdigit():
        resultado = f"{competencia[:2]}/{competencia[2:]}"
        logger.debug(f"🔄 Normalização: '{competencia_original}' -> '{resultado}' (formato MMMAAA)")
        return resultado
    
    # Se não reconheceu o formato, retorna como está
    logger.warning(f"⚠️ Formato de competência não reconhecido: '{competencia_original}', retornando como está")
    return competencia


async def encontrar_botao_proxima_pagina(page: Page):
    """
    Encontra o botão "Próxima" página usando múltiplas estratégias robustas.
    
    Tenta as seguintes estratégias em ordem:
    1. page.locator('i.fa-angle-right').first
    2. page.locator('a:has(i.fa-angle-right)').first
    3. page.locator('xpath=//i[@class="fa fa-angle-right"]')
    4. page.locator('xpath=//a[.//i[contains(@class,"fa-angle-right")]]')
    5. XPath fixo: /html/body/div[1]/div[3]/div[1]/ul/li[6]/a
    
    Args:
        page: Página do Playwright
        
    Returns:
        Locator do botão "Próxima" ou None se não encontrar
        
    Raises:
        Exception: Se não conseguir encontrar o botão com nenhuma estratégia
    """
    estrategias = [
        ("i.fa-angle-right", lambda: page.locator('i.fa-angle-right').first),
        ("a:has(i.fa-angle-right)", lambda: page.locator('a:has(i.fa-angle-right)').first),
        ("xpath=//i[@class=\"fa fa-angle-right\"]", lambda: page.locator('xpath=//i[@class="fa fa-angle-right"]').first),
        ("xpath=//a[.//i[contains(@class,\"fa-angle-right\")]]", lambda: page.locator('xpath=//a[.//i[contains(@class,"fa-angle-right")]]').first),
        ("xpath=/html/body/div[1]/div[3]/div[1]/ul/li[6]/a", lambda: page.locator('xpath=/html/body/div[1]/div[3]/div[1]/ul/li[6]/a').first),
    ]
    
    for nome_estrategia, estrategia_func in estrategias:
        try:
            logger.debug(f"Tentando estratégia: {nome_estrategia}")
            botao = estrategia_func()
            count = await botao.count()
            if count > 0:
                logger.debug(f"✅ Botão encontrado usando estratégia: {nome_estrategia}")
                return botao
        except Exception as e:
            logger.debug(f"Estratégia {nome_estrategia} falhou: {e}")
            continue
    
    raise Exception("Botão 'Próxima' não encontrado com nenhuma estratégia")


async def clicar_botao_proxima_pagina(page: Page) -> bool:
    """
    Clica no botão "Próxima" página e verifica se realmente mudou de página.
    
    Esta função implementa proteção contra loop infinito:
    1. Verifica se o botão existe e está habilitado
    2. Captura o texto da primeira linha ANTES do clique
    3. Clica no botão
    4. Verifica se o texto da primeira linha MUDOU após o clique
    5. Se não mudou, significa que estamos na última página → retorna False
    
    Args:
        page: Página do Playwright
        
    Returns:
        True se conseguiu navegar para próxima página, False caso contrário
    """
    try:
        # ETAPA 1: Encontrar o botão
        botao = await encontrar_botao_proxima_pagina(page)
        
        # ETAPA 2: Verificar se o botão está habilitado
        try:
            # Tenta pegar o elemento pai (link) para verificar disabled
            parent_link = botao.locator("..")
            is_disabled = await parent_link.get_attribute("disabled")
            class_attr = await parent_link.get_attribute("class")
            
            # Verifica também o elemento LI pai (pode ter classe disabled)
            try:
                li_parent = parent_link.locator("..")
                li_class = await li_parent.get_attribute("class")
                if li_class and "disabled" in li_class.lower():
                    logger.info("Botão 'Próxima' está desabilitado (LI pai tem classe disabled)")
                    return False
            except Exception:
                pass  # Não conseguiu verificar LI pai, continua
            
            if is_disabled or (class_attr and "disabled" in class_attr.lower()):
                logger.info("Botão 'Próxima' está desabilitado (já está na última página)")
                return False
        except Exception:
            # Se não conseguir verificar disabled, continua (pode não ter esse atributo)
            logger.debug("Não foi possível verificar se botão está desabilitado")
        
        # Aguarda o elemento estar visível
        await botao.wait_for(state='visible', timeout=5000)
        
        # Verifica se está clicável
        is_enabled = await botao.is_enabled()
        if not is_enabled:
            logger.info("Botão 'Próxima' não está habilitado")
            return False
        
        # ETAPA 3: Capturar o texto da primeira linha ANTES do clique
        # Isso será usado para verificar se a página realmente mudou
        try:
            linhas_antes = page.locator("table tbody tr")
            primeira_linha_antes = linhas_antes.nth(0)
            texto_primeira_linha_antes = await primeira_linha_antes.inner_text()
            texto_primeira_linha_antes = texto_primeira_linha_antes.strip()
            logger.debug(f"Texto da primeira linha ANTES do clique: '{texto_primeira_linha_antes[:50]}...'")
        except Exception as e:
            logger.warning(f"Não foi possível capturar texto da primeira linha antes do clique: {e}")
            texto_primeira_linha_antes = None
        
        # ETAPA 4: Clicar no botão
        logger.info("Clicando no botão 'Próxima'...")
        await botao.click()
        
        # ETAPA 5: Aguardar a tabela recarregar
        await page.wait_for_load_state("networkidle", timeout=10000)
        await page.wait_for_selector("table tbody tr", timeout=8000)
        
        # ETAPA 6: Verificar se a página realmente mudou
        # Se o texto da primeira linha não mudou, significa que estamos na última página
        if texto_primeira_linha_antes is not None:
            try:
                # Aguarda um pouco para garantir que a tabela estável
                await page.wait_for_timeout(500)
                
                # Captura o texto da primeira linha DEPOIS do clique
                linhas_depois = page.locator("table tbody tr")
                primeira_linha_depois = linhas_depois.nth(0)
                texto_primeira_linha_depois = await primeira_linha_depois.inner_text()
                texto_primeira_linha_depois = texto_primeira_linha_depois.strip()
                logger.debug(f"Texto da primeira linha DEPOIS do clique: '{texto_primeira_linha_depois[:50]}...'")
                
                # Compara os textos
                if texto_primeira_linha_antes == texto_primeira_linha_depois:
                    logger.warning("⚠️ A primeira linha não mudou após o clique. Estamos na última página ou o clique não funcionou.")
                    logger.info("Evitando loop infinito: retornando False")
                    return False
                else:
                    logger.debug("✅ A primeira linha mudou. Página realmente mudou.")
            except Exception as e:
                logger.warning(f"Erro ao verificar mudança de página: {e}. Assumindo que mudou.")
                # Em caso de erro, assume que mudou para não bloquear o fluxo
        
        logger.info("✅ Navegação para próxima página concluída com sucesso")
        return True
        
    except Exception as e:
        logger.warning(f"Erro ao clicar no botão 'Próxima': {e}")
        return False


async def verificar_sem_registros(page: Page) -> bool:
    """
    Verifica se a página exibe a mensagem "Nenhum registro encontrado".
    
    Esta função verifica múltiplos seletores para detectar quando não há
    registros na tabela de notas fiscais.
    
    Valida os seguintes seletores:
    - XPath: /html/body/div[1]/span
    - CSS: span.sem-registros
    - Texto: "Nenhum registro encontrado"
    
    Args:
        page: Página do Playwright
        
    Returns:
        True se encontrar a mensagem "Nenhum registro encontrado", False caso contrário
    """
    try:
        # Tenta encontrar pelo xpath (Playwright usa xpath= como prefixo)
        xpath_selector = "/html/body/div[1]/span"
        try:
            elemento_xpath = page.locator(f"xpath={xpath_selector}")
            count = await elemento_xpath.count()
            if count > 0:
                texto = await elemento_xpath.inner_text()
                if texto and "Nenhum registro encontrado" in texto:
                    logger.debug("Mensagem 'Nenhum registro encontrado' encontrada via XPath")
                    return True
        except Exception as e:
            logger.debug(f"Erro ao verificar XPath: {e}")
        
        # Tenta encontrar pelo seletor CSS com classe
        try:
            elemento_span = page.locator("span.sem-registros")
            count = await elemento_span.count()
            if count > 0:
                texto = await elemento_span.inner_text()
                if texto and "Nenhum registro encontrado" in texto:
                    logger.debug("Mensagem 'Nenhum registro encontrado' encontrada via CSS (span.sem-registros)")
                    return True
        except Exception as e:
            logger.debug(f"Erro ao verificar CSS span.sem-registros: {e}")
        
        # Tenta encontrar pelo texto direto (usando locator com texto)
        try:
            elemento_texto = page.locator("text=Nenhum registro encontrado")
            count = await elemento_texto.count()
            if count > 0:
                logger.debug("Mensagem 'Nenhum registro encontrado' encontrada via texto")
                return True
        except Exception as e:
            logger.debug(f"Erro ao verificar texto direto: {e}")
        
        # Tenta encontrar usando get_by_text (método mais moderno do Playwright)
        try:
            elemento_texto_moderno = page.get_by_text("Nenhum registro encontrado", exact=False)
            count = await elemento_texto_moderno.count()
            if count > 0:
                logger.debug("Mensagem 'Nenhum registro encontrado' encontrada via get_by_text")
                return True
        except Exception as e:
            logger.debug(f"Erro ao verificar get_by_text: {e}")
        
        return False
    except Exception as e:
        logger.debug(f"Erro ao verificar mensagem 'sem registros': {e}")
        return False


# Nota: A função salvar_download foi movida para download_manager.py
# Use salvar_download_direto() do módulo download_manager para salvar downloads


async def verificar_nota_cancelada(row_locator) -> bool:
    """
    Verifica se uma nota fiscal está cancelada baseado em dois pontos:
    1. XPath: /html/body/div[1]/table/tbody/tr[3]/td[5]/img (adaptado para a linha atual)
    2. Elemento HTML: <img data-toggle="tooltip" src="/EmissorNacional\\img/tb-cancelada.svg" title="" data-original-title="NFS-e Cancelada">
    
    Args:
        row_locator: Locator da linha da tabela
        
    Returns:
        True se a nota estiver cancelada, False caso contrário
    """
    try:
        # Método 1: Verifica pela coluna de status (coluna 5, índice 4 para recebidas, coluna 6, índice 5 para emitidas)
        # Tenta ambas as colunas possíveis
        celulas = row_locator.locator("td")
        
        # Verifica coluna 5 (índice 4) - comum para recebidas
        coluna_status_5 = celulas.nth(4)
        img_status_5 = coluna_status_5.locator("img")
        
        if await img_status_5.count() > 0:
            # Verifica atributo src para imagem de cancelada
            src_text = await img_status_5.get_attribute("src")
            if src_text:
                # Verifica se contém o caminho da imagem de cancelada
                if "tb-cancelada.svg" in src_text or "cancelada" in src_text.lower():
                    logger.debug("Nota cancelada detectada via src da imagem na coluna 5")
                    return True
            
            # Verifica atributo data-original-title
            data_original_title = await img_status_5.get_attribute("data-original-title")
            if data_original_title:
                if "cancelada" in data_original_title.lower() or "cancel" in data_original_title.lower():
                    logger.debug("Nota cancelada detectada via data-original-title na coluna 5")
                    return True
            
            # Verifica atributo title
            title_text = await img_status_5.get_attribute("title")
            if title_text:
                if "cancelada" in title_text.lower() or "cancel" in title_text.lower():
                    logger.debug("Nota cancelada detectada via title na coluna 5")
                    return True
        
        # Verifica coluna 6 (índice 5) - comum para emitidas
        coluna_status_6 = celulas.nth(5)
        img_status_6 = coluna_status_6.locator("img")
        
        if await img_status_6.count() > 0:
            # Verifica atributo src para imagem de cancelada
            src_text = await img_status_6.get_attribute("src")
            if src_text:
                # Verifica se contém o caminho da imagem de cancelada
                if "tb-cancelada.svg" in src_text or "cancelada" in src_text.lower():
                    logger.debug("Nota cancelada detectada via src da imagem na coluna 6")
                    return True
            
            # Verifica atributo data-original-title
            data_original_title = await img_status_6.get_attribute("data-original-title")
            if data_original_title:
                if "cancelada" in data_original_title.lower() or "cancel" in data_original_title.lower():
                    logger.debug("Nota cancelada detectada via data-original-title na coluna 6")
                    return True
            
            # Verifica atributo title
            title_text = await img_status_6.get_attribute("title")
            if title_text:
                if "cancelada" in title_text.lower() or "cancel" in title_text.lower():
                    logger.debug("Nota cancelada detectada via title na coluna 6")
                    return True
        
        # Método 2: Tenta encontrar usando XPath adaptado para a linha atual
        # O XPath original é /html/body/div[1]/table/tbody/tr[3]/td[5]/img
        # Adaptamos para usar o row_locator e verificar td[5] (índice 4)
        try:
            # Tenta encontrar img dentro de td[5] usando XPath relativo
            img_xpath = row_locator.locator("xpath=./td[5]/img")
            if await img_xpath.count() > 0:
                src_xpath = await img_xpath.get_attribute("src")
                if src_xpath and ("tb-cancelada.svg" in src_xpath or "cancelada" in src_xpath.lower()):
                    logger.debug("Nota cancelada detectada via XPath td[5]/img")
                    return True
        except Exception as e:
            logger.debug(f"Erro ao verificar XPath td[5]/img: {e}")
        
        # Não encontrou indicadores de cancelada
        return False
        
    except Exception as e:
        logger.warning(f"Erro ao verificar se nota está cancelada: {e}. Assumindo não cancelada.")
        return False


async def verificar_nota_valida(row_locator) -> bool:
    """
    Verifica se uma nota fiscal é válida (não cancelada) baseado no ícone na coluna de status.
    
    Esta função verifica se a nota está cancelada usando verificar_nota_cancelada.
    Se estiver cancelada, retorna False (nota inválida para download).
    Se não estiver cancelada, retorna True (nota válida para download).
    
    Args:
        row_locator: Locator da linha da tabela
        
    Returns:
        True se a nota for válida (não cancelada), False caso contrário
    """
    try:
        # Primeiro verifica se está cancelada
        if await verificar_nota_cancelada(row_locator):
            logger.info("⚠️  Nota fiscal cancelada detectada. Não será baixada.")
            return False
        
        # Se não está cancelada, verifica outros indicadores de validade
        # Tenta encontrar o ícone na coluna de status
        celulas = row_locator.locator("td")
        
        # Verifica coluna 5 (índice 4) e coluna 6 (índice 5)
        for col_idx in [4, 5]:
            try:
                coluna_status = celulas.nth(col_idx)
                img_status = coluna_status.locator("img")
                
                if await img_status.count() > 0:
                    # Verifica atributos que indicam nota inválida (mas não cancelada)
                    alt_text = await img_status.get_attribute("alt")
                    src_text = await img_status.get_attribute("src")
                    
                    # Considera inválida se houver indicadores de inválida (mas não cancelada, já verificado acima)
                    if alt_text:
                        alt_lower = alt_text.lower()
                        if any(palavra in alt_lower for palavra in ["inválida", "invalid"]) and "cancelada" not in alt_lower:
                            return False
                    
                    if src_text:
                        src_lower = src_text.lower()
                        if any(palavra in src_lower for palavra in ["invalid"]) and "cancelada" not in src_lower:
                            return False
            except Exception:
                continue
        
        # Se não encontrou indicadores negativos, assume válida
        return True
        
    except Exception as e:
        logger.warning(f"Erro ao verificar validade da nota: {e}. Assumindo válida.")
        return True


async def baixar_arquivos_da_linha(
    page: Page,
    row_locator,
    competencia_alvo: str,
    nome_empresa: str,
    tipo_nota: str,
) -> None:
    """
    Baixa XML e DANFS-e (PDF) de uma linha da tabela.
    
    Esta função usa o módulo download_manager para interceptar, identificar
    e salvar os downloads corretamente na estrutura de pastas configurada.
    
    Args:
        page: Página do Playwright
        row_locator: Locator da linha da tabela
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025")
        nome_empresa: Nome da empresa (do certificado digital)
        tipo_nota: "Emitidas" ou "Recebidas"
    """
    try:
        # Obtém o caminho base configurado
        base_path = get_download_base_path()
        
        # Determina a coluna de ações baseado no tipo
        # Emitidas: coluna 7 (índice 6), Recebidas: coluna 6 (índice 5)
        tipo_interno = tipo_nota.lower().replace("s", "")  # "Emitidas" -> "emitida", "Recebidas" -> "recebida"
        coluna_acoes_idx = 6 if tipo_interno == "emitida" else 5
        
        # Extrai informações da linha para criar nomes de arquivo melhores
        celulas = row_locator.locator("td")
        
        # Tenta extrair número da nota ou data de emissão da linha
        numero_nota = None
        try:
            # Tenta várias colunas comuns onde pode estar o número da nota
            for idx in [0, 1, 2, 3]:
                try:
                    texto_celula = await celulas.nth(idx).inner_text()
                    texto_celula = texto_celula.strip()
                    # Se contém números que parecem número de nota
                    if texto_celula and any(c.isdigit() for c in texto_celula):
                        numero_nota = texto_celula.replace("/", "-").replace("\\", "-").replace(" ", "_")
                        # Limita tamanho do nome
                        if len(numero_nota) > 50:
                            numero_nota = numero_nota[:50]
                        break
                except:
                    continue
        except Exception as e:
            logger.warning(f"Não foi possível extrair número da nota: {e}")
        
        # Clica no ícone de ações da nota
        coluna_acoes = celulas.nth(coluna_acoes_idx)
        icone_acoes = coluna_acoes.locator("div a i, a i").first
        
        # Abre o menu de ações
        await icone_acoes.click()
        logger.info(f"Menu de ações aberto para nota {tipo_nota}")
        
        # Aguarda o popover aparecer - usa seletor do menu suspenso
        menu_suspenso = row_locator.locator('.menu-suspenso-tabela')
        await menu_suspenso.wait_for(state='visible', timeout=3000)
        
        # ============================================================
        # BAIXA XML
        # ============================================================
        try:
            logger.info(f"Baixando XML da nota {tipo_nota}...")
            
            # Intercepta o download
            async with page.expect_download() as download_info:
                # Encontra o link de download XML
                link_xml = None
                try:
                    link_xml = page.get_by_role("link", name="Download XML").first
                    if await link_xml.count() == 0:
                        raise Exception("Role não encontrado")
                except:
                    # Fallback: tenta encontrar por texto dentro do menu suspenso
                    link_xml = menu_suspenso.locator('a:has-text("XML")').first
                
                await link_xml.wait_for(state='visible', timeout=2000)
                await link_xml.click()
            
            download = await download_info.value
            
            # Usa o módulo download_manager para salvar corretamente
            prefixo_nome = f"{numero_nota}_" if numero_nota else None
            arquivo_xml = await salvar_download_direto(
                download=download,
                base_path=base_path,
                competencia=competencia_alvo,
                empresa=nome_empresa,
                tipo_nota=tipo_nota,
                nome_arquivo_prefixo=prefixo_nome
            )
            logger.info(f"✅ XML baixado e salvo em: {arquivo_xml}")
            
        except Exception as e:
            logger.error(f"Erro ao baixar XML: {e}")
            import traceback
            logger.debug(traceback.format_exc())
        
        # Fecha o menu e reabre para baixar o PDF
        await icone_acoes.click()  # Fecha o menu
        delay_ms = get_min_action_delay_ms()
        await page.wait_for_timeout(delay_ms)
        
        # Reabre o menu para baixar DANFS-e
        await icone_acoes.click()
        await menu_suspenso.wait_for(state='visible', timeout=3000)
        
        # ============================================================
        # BAIXA DANFS-e (PDF)
        # ============================================================
        try:
            logger.info(f"Baixando DANFS-e (PDF) da nota {tipo_nota}...")
            
            # Intercepta o download
            async with page.expect_download() as download_info:
                # Encontra o link de download DANFS-e
                link_danfse = None
                try:
                    link_danfse = page.get_by_role("link", name="Download DANFS-e").first
                    if await link_danfse.count() == 0:
                        raise Exception("Role não encontrado")
                except:
                    # Fallback: tenta encontrar por texto dentro do menu suspenso
                    link_danfse = menu_suspenso.locator('a:has-text("DANFS-e")').first
                
                await link_danfse.wait_for(state='visible', timeout=2000)
                await link_danfse.click()
            
            download = await download_info.value
            
            # Usa o módulo download_manager para salvar corretamente
            prefixo_nome = f"{numero_nota}_" if numero_nota else None
            arquivo_pdf = await salvar_download_direto(
                download=download,
                base_path=base_path,
                competencia=competencia_alvo,
                empresa=nome_empresa,
                tipo_nota=tipo_nota,
                nome_arquivo_prefixo=prefixo_nome
            )
            logger.info(f"✅ DANFS-e baixado e salvo em: {arquivo_pdf}")
            
        except Exception as e:
            logger.error(f"Erro ao baixar DANFS-e: {e}")
            import traceback
            logger.debug(traceback.format_exc())
        
        # Fecha o menu novamente
        await icone_acoes.click()
        delay_ms = get_min_action_delay_ms()
        await page.wait_for_timeout(delay_ms)
        
    except Exception as e:
        logger.error(f"Erro ao baixar arquivos da linha: {e}")
        import traceback
        logger.debug(traceback.format_exc())


async def processar_tabela_emitidas(page: Page, competencia_alvo: str, nome_empresa: str) -> dict:
    """
    Processa a tabela de notas emitidas, varrendo todas as páginas.
    
    Args:
        page: Página do Playwright
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025") ou "MMAAAA" (ex: "102025")
        nome_empresa: Nome da empresa (do certificado digital)
    
    Returns:
        dict com:
            - qtd_baixadas: quantidade de notas baixadas (válidas, não canceladas, com competência correta)
            - sem_registros: True se encontrou mensagem "Nenhum registro encontrado"
            - encontrou_notas: True se encontrou notas (mesmo que canceladas ou sem competência)
    """
    # Normaliza a competência UMA VEZ no início para garantir comparação correta
    competencia_alvo_normalizada = normalizar_competencia(competencia_alvo)
    logger.info(f"Iniciando processamento de Notas Emitidas para competência {competencia_alvo} (normalizada: {competencia_alvo_normalizada})")
    
    qtd_baixadas = 0
    sem_registros = False
    encontrou_notas = False
    
    # Verifica se há mensagem "Nenhum registro encontrado" antes de processar
    if await verificar_sem_registros(page):
        logger.info("ℹ️  Nenhuma nota fiscal emitida encontrada para esta competência")
        logger.info("   Mensagem 'Nenhum registro encontrado' detectada na página de Notas Emitidas")
        return {
            "qtd_baixadas": 0,
            "sem_registros": True,
            "encontrou_notas": False
        }
    
    while True:
        try:
            # Aguarda a tabela carregar
            await page.wait_for_selector("table tbody tr", timeout=10000)
            
            # Obtém todas as linhas do tbody
            linhas = page.locator("table tbody tr")
            total_linhas = await linhas.count()
            
            if total_linhas == 0:
                logger.info("Nenhuma linha encontrada na tabela. Encerrando.")
                break
            
            logger.info(f"Processando {total_linhas} linhas na página atual (Emitidas)")
            
            # Processa cada linha
            encontrou_competencia = False
            
            for i in range(total_linhas):
                linha = linhas.nth(i)
                celulas = linha.locator("td")
                
                # Lê a competência da 3ª coluna (índice 2)
                try:
                    competencia_texto = await celulas.nth(2).inner_text()
                    competencia_texto = competencia_texto.strip()
                    
                    # Normaliza a competência da linha antes de comparar
                    competencia_texto_normalizada = normalizar_competencia(competencia_texto)
                    
                    if competencia_texto_normalizada == competencia_alvo_normalizada:
                        encontrou_competencia = True
                        encontrou_notas = True
                        logger.info(f"Nota encontrada na linha {i+1} com competência {competencia_alvo_normalizada}")
                        
                        # Verifica se a nota é válida
                        nota_valida = await verificar_nota_valida(linha)
                        
                        if nota_valida:
                            logger.info(f"Nota válida confirmada. Baixando arquivos...")
                            await baixar_arquivos_da_linha(page, linha, competencia_alvo_normalizada, nome_empresa, "Emitidas")
                            qtd_baixadas += 1
                        else:
                            logger.info(f"Nota inválida/cancelada. Pulando download.")
                    
                except Exception as e:
                    logger.warning(f"Erro ao processar linha {i+1}: {e}")
                    continue
            
            # Verifica se precisa continuar na próxima página
            # REGRA: Se a última linha ainda tem a competência alvo → IR PARA A PRÓXIMA PÁGINA
            # REGRA: Se a última linha NÃO tem a competência alvo → ENCERRAR EMITIDAS
            if total_linhas > 0:
                ultima_linha = linhas.nth(total_linhas - 1)
                celulas_ultima = ultima_linha.locator("td")
                
                try:
                    competencia_ultima_texto = await celulas_ultima.nth(2).inner_text()
                    competencia_ultima_texto = competencia_ultima_texto.strip()
                    
                    # Normaliza a competência da última linha antes de comparar
                    competencia_ultima_normalizada = normalizar_competencia(competencia_ultima_texto)
                    
                    logger.debug(f"Última linha - competência: '{competencia_ultima_texto}' (normalizada: '{competencia_ultima_normalizada}')")
                    logger.debug(f"Competência alvo normalizada: '{competencia_alvo_normalizada}'")
                    
                    if competencia_ultima_normalizada == competencia_alvo_normalizada:
                        # Ainda há notas da competência, tenta ir para próxima página
                        logger.info("✅ Última linha ainda tem competência alvo. Tentando navegar para próxima página...")
                        
                        # Usa a função robusta para encontrar e clicar no botão
                        # Esta função verifica se o botão existe, está habilitado E se a página realmente mudou
                        mudou_pagina = await clicar_botao_proxima_pagina(page)
                        
                        if mudou_pagina:
                            # Página mudou com sucesso, continua o loop
                            logger.info("✅ Navegação bem-sucedida. Continuando processamento...")
                            # Aguarda um pouco para garantir que a tabela está estável
                            delay_ms = get_min_action_delay_ms()
                            await page.wait_for_timeout(delay_ms)
                            continue
                        else:
                            # Não foi possível avançar de página (última página ou botão desabilitado)
                            logger.info("⚠️ Não foi possível avançar de página. Evitando loop infinito.")
                            logger.info("Encerrando processamento de Emitidas.")
                            break
                    else:
                        # Passou da competência desejada
                        logger.info(f"❌ Última linha tem competência '{competencia_ultima_normalizada}' diferente da alvo '{competencia_alvo_normalizada}'. Encerrando busca em Emitidas.")
                        break
                        
                except Exception as e:
                    logger.warning(f"Erro ao verificar última linha: {e}")
                    break
            else:
                # Não há linhas na tabela
                logger.info("Nenhuma linha encontrada na tabela. Encerrando Emitidas.")
                break
                
        except PlaywrightTimeoutError:
            logger.error("Timeout ao aguardar tabela. Encerrando.")
            break
        except Exception as e:
            logger.error(f"Erro ao processar tabela de emitidas: {e}")
            break
    
    logger.info(f"Processamento de Notas Emitidas finalizado. Notas baixadas: {qtd_baixadas}")
    return {
        "qtd_baixadas": qtd_baixadas,
        "sem_registros": sem_registros,
        "encontrou_notas": encontrou_notas
    }


async def processar_tabela_recebidas(page: Page, competencia_alvo: str, nome_empresa: str) -> dict:
    """
    Processa a tabela de notas recebidas, varrendo todas as páginas.
    
    Args:
        page: Página do Playwright
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025") ou "MMAAAA" (ex: "102025")
        nome_empresa: Nome da empresa (do certificado digital)
    
    Returns:
        dict com:
            - qtd_baixadas: quantidade de notas baixadas (válidas, não canceladas, com competência correta)
            - sem_registros: True se encontrou mensagem "Nenhum registro encontrado"
            - encontrou_notas: True se encontrou notas (mesmo que canceladas ou sem competência)
    """
    # Normaliza a competência UMA VEZ no início para garantir comparação correta
    competencia_alvo_normalizada = normalizar_competencia(competencia_alvo)
    logger.info(f"Iniciando processamento de Notas Recebidas para competência {competencia_alvo} (normalizada: {competencia_alvo_normalizada})")
    
    qtd_baixadas = 0
    sem_registros = False
    encontrou_notas = False
    
    # Verifica se há mensagem "Nenhum registro encontrado" antes de processar
    if await verificar_sem_registros(page):
        logger.info("ℹ️  Nenhuma nota fiscal recebida encontrada para esta competência")
        logger.info("   Mensagem 'Nenhum registro encontrado' detectada na página de Notas Recebidas")
        return {
            "qtd_baixadas": 0,
            "sem_registros": True,
            "encontrou_notas": False
        }
    
    while True:
        try:
            # Aguarda a tabela carregar
            await page.wait_for_selector("table tbody tr", timeout=10000)
            
            # Obtém todas as linhas do tbody
            linhas = page.locator("table tbody tr")
            total_linhas = await linhas.count()
            
            if total_linhas == 0:
                logger.info("Nenhuma linha encontrada na tabela. Encerrando.")
                break
            
            logger.info(f"Processando {total_linhas} linhas na página atual (Recebidas)")
            
            # Processa cada linha
            encontrou_competencia = False
            
            for i in range(total_linhas):
                linha = linhas.nth(i)
                celulas = linha.locator("td")
                
                # Lê a competência da 3ª coluna (índice 2)
                try:
                    competencia_texto = await celulas.nth(2).inner_text()
                    competencia_texto = competencia_texto.strip()
                    
                    # Normaliza a competência da linha antes de comparar
                    competencia_texto_normalizada = normalizar_competencia(competencia_texto)
                    
                    if competencia_texto_normalizada == competencia_alvo_normalizada:
                        encontrou_competencia = True
                        encontrou_notas = True
                        logger.info(f"Nota encontrada na linha {i+1} com competência {competencia_alvo_normalizada}")
                        
                        # Verifica se a nota é válida
                        nota_valida = await verificar_nota_valida(linha)
                        
                        if nota_valida:
                            logger.info(f"Nota válida confirmada. Baixando arquivos...")
                            await baixar_arquivos_da_linha(page, linha, competencia_alvo_normalizada, nome_empresa, "Recebidas")
                            qtd_baixadas += 1
                        else:
                            logger.info(f"Nota inválida/cancelada. Pulando download.")
                    
                except Exception as e:
                    logger.warning(f"Erro ao processar linha {i+1}: {e}")
                    continue
            
            # Verifica se precisa continuar na próxima página
            # REGRA: Se a última linha ainda tem a competência alvo → IR PARA A PRÓXIMA PÁGINA
            # REGRA: Se a última linha NÃO tem a competência alvo → ENCERRAR RECEBIDAS
            if total_linhas > 0:
                ultima_linha = linhas.nth(total_linhas - 1)
                celulas_ultima = ultima_linha.locator("td")
                
                try:
                    competencia_ultima_texto = await celulas_ultima.nth(2).inner_text()
                    competencia_ultima_texto = competencia_ultima_texto.strip()
                    
                    # Normaliza a competência da última linha antes de comparar
                    competencia_ultima_normalizada = normalizar_competencia(competencia_ultima_texto)
                    
                    logger.debug(f"Última linha - competência: '{competencia_ultima_texto}' (normalizada: '{competencia_ultima_normalizada}')")
                    logger.debug(f"Competência alvo normalizada: '{competencia_alvo_normalizada}'")
                    
                    if competencia_ultima_normalizada == competencia_alvo_normalizada:
                        # Ainda há notas da competência, tenta ir para próxima página
                        logger.info("✅ Última linha ainda tem competência alvo. Tentando navegar para próxima página...")
                        
                        # Usa a função robusta para encontrar e clicar no botão
                        # Esta função verifica se o botão existe, está habilitado E se a página realmente mudou
                        mudou_pagina = await clicar_botao_proxima_pagina(page)
                        
                        if mudou_pagina:
                            # Página mudou com sucesso, continua o loop
                            logger.info("✅ Navegação bem-sucedida. Continuando processamento...")
                            # Aguarda um pouco para garantir que a tabela está estável
                            delay_ms = get_min_action_delay_ms()
                            await page.wait_for_timeout(delay_ms)
                            continue
                        else:
                            # Não foi possível avançar de página (última página ou botão desabilitado)
                            logger.info("⚠️ Não foi possível avançar de página. Evitando loop infinito.")
                            logger.info("Encerrando processamento de Recebidas.")
                            break
                    else:
                        # Passou da competência desejada
                        logger.info(f"❌ Última linha tem competência '{competencia_ultima_normalizada}' diferente da alvo '{competencia_alvo_normalizada}'. Encerrando busca em Recebidas.")
                        break
                        
                except Exception as e:
                    logger.warning(f"Erro ao verificar última linha: {e}")
                    break
            else:
                # Não há linhas na tabela
                logger.info("Nenhuma linha encontrada na tabela. Encerrando Recebidas.")
                break
                
        except PlaywrightTimeoutError:
            logger.error("Timeout ao aguardar tabela. Encerrando.")
            break
        except Exception as e:
            logger.error(f"Erro ao processar tabela de recebidas: {e}")
            break
    
    logger.info(f"Processamento de Notas Recebidas finalizado. Notas baixadas: {qtd_baixadas}")
    return {
        "qtd_baixadas": qtd_baixadas,
        "sem_registros": sem_registros,
        "encontrou_notas": encontrou_notas
    }


async def preencher_datas_e_filtrar(page: Page, data_inicio: str, data_fim: str) -> None:
    """
    Preenche os campos de data início e data fim e clica no botão filtrar.
    
    Args:
        page: Página do Playwright
        data_inicio: Data início no formato DD/MM/YYYY (ex: "01/12/2025")
        data_fim: Data fim no formato DD/MM/YYYY (ex: "31/12/2025")
    """
    try:
        logger.info(f"Preenchendo datas: início={data_inicio}, fim={data_fim}")
        
        # Aguarda os campos de data carregarem usando xpath
        campo_data_inicio = page.locator('xpath=//*[@id="datainicio"]')
        campo_data_fim = page.locator('xpath=//*[@id="datafim"]')
        
        await campo_data_inicio.wait_for(state='visible', timeout=10000)
        await campo_data_fim.wait_for(state='visible', timeout=10000)
        
        # Preenche data início
        await campo_data_inicio.fill('')
        await campo_data_inicio.fill(data_inicio)
        logger.info(f"✅ Data início preenchida: {data_inicio}")
        
        # Preenche data fim
        await campo_data_fim.fill('')
        await campo_data_fim.fill(data_fim)
        logger.info(f"✅ Data fim preenchida: {data_fim}")
        
        # Aguarda um pouco para garantir que os campos foram preenchidos
        delay_ms = get_min_action_delay_ms()
        await page.wait_for_timeout(delay_ms)
        
        # Clica no botão filtrar usando xpath
        botao_filtrar = page.locator('xpath=//*[@id="searchbar"]/form/div[2]/div[2]/div[2]/button')
        await botao_filtrar.wait_for(state='visible', timeout=5000)
        await botao_filtrar.click()
        logger.info("✅ Botão filtrar clicado")
        
        # Aguarda a tabela recarregar após filtrar
        await page.wait_for_load_state("networkidle", timeout=10000)
        await page.wait_for_timeout(delay_ms * 2)
        
        logger.info("✅ Filtro aplicado com sucesso")
        
    except Exception as e:
        logger.error(f"Erro ao preencher datas e filtrar: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise


async def processar_notas(page: Page, competencia_alvo: str, nome_empresa: str) -> None:
    """
    Função principal que processa notas fiscais de uma competência específica.
    
    Fluxo:
    1. Acessa "Notas fiscais emitidas"
    2. Varre todas as páginas procurando pela competência alvo
    3. Baixa XML e DANFS-e para notas válidas encontradas
    4. Acessa "Notas fiscais recebidas"
    5. Repete o mesmo processo para recebidas
    
    Args:
        page: Página do Playwright (assume que já está logado no dashboard)
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025") ou "MMAAAA" (ex: "102025")
        nome_empresa: Nome da empresa (do certificado digital)
    """
    # Normaliza a competência recebida como parâmetro
    competencia_alvo_normalizada = normalizar_competencia(competencia_alvo)
    logger.info(f"🚀 Iniciando processamento de notas para competência: {competencia_alvo} (normalizada: {competencia_alvo_normalizada}), empresa: {nome_empresa}")
    
    try:
        # 1) Acessar "Notas fiscais emitidas"
        logger.info("Acessando menu 'Notas fiscais emitidas'...")
        
        # Usa seletor robusto baseado no teste.json
        menu_emitidas = page.locator("li:nth-of-type(3) img").first
        
        # Valida que o elemento existe antes de clicar
        await menu_emitidas.wait_for(state="visible", timeout=10000)
        await menu_emitidas.click()
        
        # Aguarda navegação e carregamento da tabela
        await page.wait_for_url("**/Notas/Emitidas", timeout=15000)
        await page.wait_for_load_state("networkidle", timeout=15000)
        
        # Aguarda um pouco para garantir que a página carregou completamente
        delay_ms = get_min_action_delay_ms() * 2  # Delay maior para carregamento de página
        await page.wait_for_timeout(delay_ms)
        
        # Verifica se há mensagem "Nenhum registro encontrado"
        if await verificar_sem_registros(page):
            logger.info("ℹ️  Nenhuma nota fiscal emitida encontrada para esta competência")
            logger.info("   Mensagem 'Nenhum registro encontrado' detectada na página de Notas Emitidas")
        else:
            # Só aguarda a tabela se não houver mensagem de "sem registros"
            try:
                await page.wait_for_selector("table tbody tr", timeout=10000)
            except:
                # Se não encontrar tabela, verifica novamente se há mensagem de sem registros
                if await verificar_sem_registros(page):
                    logger.info("ℹ️  Nenhuma nota fiscal emitida encontrada para esta competência")
                    logger.info("   Mensagem 'Nenhum registro encontrado' detectada na página de Notas Emitidas")
                else:
                    logger.warning("⚠️  Não foi possível encontrar tabela nem mensagem de 'sem registros'")
        
        logger.info("✅ Acessou Notas Emitidas com sucesso")
        
        # 2) Processar tabela de Notas Emitidas (só processa se não houver mensagem de sem registros)
        if not await verificar_sem_registros(page):
            await processar_tabela_emitidas(page, competencia_alvo_normalizada, nome_empresa)
        else:
            logger.info("⏭️  Pulando processamento de Notas Emitidas (nenhum registro encontrado)")
        
        # 4) Ir para "Notas fiscais recebidas"
        logger.info("Acessando menu 'Notas fiscais recebidas'...")
        
        # Usa seletor robusto baseado no teste.json
        menu_recebidas = page.locator("li:nth-of-type(4) img").first
        
        # Valida que o elemento existe antes de clicar
        await menu_recebidas.wait_for(state="visible", timeout=10000)
        await menu_recebidas.click()
        
        # Aguarda navegação e carregamento da tabela
        await page.wait_for_url("**/Notas/Recebidas", timeout=15000)
        await page.wait_for_load_state("networkidle", timeout=15000)
        
        # Aguarda um pouco para garantir que a página carregou completamente
        delay_ms = get_min_action_delay_ms() * 2  # Delay maior para carregamento de página
        await page.wait_for_timeout(delay_ms)
        
        # Verifica se há mensagem "Nenhum registro encontrado"
        if await verificar_sem_registros(page):
            logger.info("ℹ️  Nenhuma nota fiscal recebida encontrada para esta competência")
            logger.info("   Mensagem 'Nenhum registro encontrado' detectada na página de Notas Recebidas")
        else:
            # Só aguarda a tabela se não houver mensagem de "sem registros"
            try:
                await page.wait_for_selector("table tbody tr", timeout=10000)
            except:
                # Se não encontrar tabela, verifica novamente se há mensagem de sem registros
                if await verificar_sem_registros(page):
                    logger.info("ℹ️  Nenhuma nota fiscal recebida encontrada para esta competência")
                    logger.info("   Mensagem 'Nenhum registro encontrado' detectada na página de Notas Recebidas")
                else:
                    logger.warning("⚠️  Não foi possível encontrar tabela nem mensagem de 'sem registros'")
        
        logger.info("✅ Acessou Notas Recebidas com sucesso")
        
        # 5) Processar tabela de Notas Recebidas (só processa se não houver mensagem de sem registros)
        if not await verificar_sem_registros(page):
            await processar_tabela_recebidas(page, competencia_alvo_normalizada, nome_empresa)
        else:
            logger.info("⏭️  Pulando processamento de Notas Recebidas (nenhum registro encontrado)")
        
        logger.info("🎉 Processamento completo finalizado!")
        
    except Exception as e:
        logger.error(f"❌ Erro durante processamento: {e}")
        raise


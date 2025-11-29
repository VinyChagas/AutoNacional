"""
Automação para processar notas fiscais de uma competência específica no portal NFSe Nacional.

Este módulo implementa a varredura completa de notas emitidas e recebidas para uma
competência específica, fazendo download de XML e DANFS-e (PDF) para notas válidas.
"""

import logging
import re
from pathlib import Path
from typing import Optional
from playwright.async_api import Page, Download, TimeoutError as PlaywrightTimeoutError

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Variável global para armazenar o caminho base de downloads
# Pode ser configurada externamente antes de chamar processar_notas
_downloads_base_path: Optional[str] = None


def set_downloads_base_path(path: str) -> None:
    """
    Define o caminho base para downloads.
    
    Args:
        path: Caminho base para downloads
    """
    global _downloads_base_path
    _downloads_base_path = path


def get_download_base_path() -> Path:
    """
    Obtém o caminho base para downloads.
    
    Tenta usar o caminho configurado via set_downloads_base_path,
    caso contrário usa o padrão './downloads'.
    
    Returns:
        Path do diretório base de downloads
    """
    if _downloads_base_path:
        return Path(_downloads_base_path)
    return Path("./downloads")


def formatar_competencia_para_pasta(competencia: str) -> str:
    """
    Formata a competência para uso como nome de pasta.
    
    Args:
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        
    Returns:
        Competência formatada para pasta (ex: "10-2025")
    """
    return competencia.replace("/", "-")


def sanitizar_nome_pasta(nome: str) -> str:
    """
    Sanitiza o nome para uso como nome de pasta, removendo caracteres inválidos.
    
    Args:
        nome: Nome da empresa
        
    Returns:
        Nome sanitizado, sem caracteres problemáticos
    """
    nome = nome.strip()
    # Remove caracteres que não são letras, números, espaços, underscore ou hífen
    nome = re.sub(r"[^\w\s\-]", "", nome)
    # Remove espaços múltiplos e substitui por espaço único
    nome = re.sub(r"\s+", " ", nome)
    return nome


def montar_diretorio_download(competencia: str, nome_empresa: str, tipo_nota: str) -> Path:
    """
    Monta o diretório de download seguindo a hierarquia:
    <downloads_base_path>/<competencia>/<nome_empresa>/<tipo_nota>/
    
    Cria o diretório se não existir.
    
    Args:
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        nome_empresa: Nome da empresa (será sanitizado)
        tipo_nota: "Emitidas" ou "Recebidas"
        
    Returns:
        Path do diretório de destino
    """
    base = get_download_base_path()
    comp_folder = formatar_competencia_para_pasta(competencia)
    empresa_folder = sanitizar_nome_pasta(nome_empresa)
    destino = base / comp_folder / empresa_folder / tipo_nota
    
    # Cria o diretório e todos os pais se necessário
    destino.mkdir(parents=True, exist_ok=True)
    
    return destino


async def salvar_download(download: Download, destino_dir: Path) -> Path:
    """
    Salva um arquivo baixado no diretório de destino.
    
    Args:
        download: Objeto Download do Playwright
        destino_dir: Diretório de destino
        
    Returns:
        Path do arquivo salvo
    """
    suggested_name = download.suggested_filename
    destino_arquivo = destino_dir / suggested_name
    await download.save_as(destino_arquivo)
    return destino_arquivo


async def verificar_nota_valida(row_locator) -> bool:
    """
    Verifica se uma nota fiscal é válida baseado no ícone na coluna 6.
    
    Args:
        row_locator: Locator da linha da tabela
        
    Returns:
        True se a nota for válida, False caso contrário
    """
    try:
        # Tenta encontrar o ícone na coluna 6 (índice 5, pois começa em 0)
        # Para emitidas: coluna 6, para recebidas: coluna 6 também
        celulas = row_locator.locator("td")
        coluna_status = celulas.nth(5)  # 6ª coluna (índice 5)
        
        # Procura por imagem na coluna de status
        img_status = coluna_status.locator("img")
        
        if await img_status.count() > 0:
            # Verifica atributos que indicam nota válida
            alt_text = await img_status.get_attribute("alt")
            src_text = await img_status.get_attribute("src")
            class_text = await img_status.get_attribute("class")
            
            # Considera válida se não houver indicadores de inválida/cancelada
            if alt_text:
                alt_lower = alt_text.lower()
                if any(palavra in alt_lower for palavra in ["cancelada", "cancel", "inválida", "invalid"]):
                    return False
            
            if src_text:
                src_lower = src_text.lower()
                if any(palavra in src_lower for palavra in ["cancel", "invalid"]):
                    return False
            
            # Se não encontrou indicadores negativos, assume válida
            return True
        
        # Se não encontrou imagem, assume válida por padrão
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
    
    Args:
        page: Página do Playwright
        row_locator: Locator da linha da tabela
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025")
        nome_empresa: Nome da empresa (do certificado digital)
        tipo_nota: "Emitidas" ou "Recebidas"
    """
    try:
        # Determina a coluna de ações baseado no tipo
        # Emitidas: coluna 7 (índice 6), Recebidas: coluna 6 (índice 5)
        tipo_interno = tipo_nota.lower().replace("s", "")  # "Emitidas" -> "emitida", "Recebidas" -> "recebida"
        coluna_acoes_idx = 6 if tipo_interno == "emitida" else 5
        
        # Monta o diretório de destino
        dest_dir = montar_diretorio_download(competencia_alvo, nome_empresa, tipo_nota)
        logger.info(f"Diretório de destino: {dest_dir}")
        
        # Clica no ícone de ações da nota
        celulas = row_locator.locator("td")
        coluna_acoes = celulas.nth(coluna_acoes_idx)
        icone_acoes = coluna_acoes.locator("div a i, a i").first
        
        # Abre o menu de ações
        await icone_acoes.click()
        logger.info(f"Menu de ações aberto para nota {tipo_nota}")
        
        # Aguarda o popover aparecer - usa seletor do menu suspenso
        menu_suspenso = row_locator.locator('.menu-suspenso-tabela')
        await menu_suspenso.wait_for(state='visible', timeout=3000)
        
        # Baixa XML
        try:
            logger.info(f"Baixando XML da nota {tipo_nota}...")
            async with page.expect_download() as download_info:
                # Usa seletores baseados em texto/aria ao invés de IDs fixos
                # Tenta primeiro pelo role, depois por texto
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
            # Salva no diretório correto usando a função auxiliar
            arquivo_xml = await salvar_download(download, dest_dir)
            logger.info(f"✅ XML baixado: {download.suggested_filename} em {arquivo_xml}")
            
        except Exception as e:
            logger.error(f"Erro ao baixar XML: {e}")
        
        # Fecha o menu e reabre para baixar o PDF
        await icone_acoes.click()  # Fecha o menu
        await page.wait_for_timeout(200)
        
        # Reabre o menu para baixar DANFS-e
        await icone_acoes.click()
        await menu_suspenso.wait_for(state='visible', timeout=3000)
        
        # Baixa DANFS-e (PDF)
        try:
            logger.info(f"Baixando DANFS-e (PDF) da nota {tipo_nota}...")
            async with page.expect_download() as download_info:
                # Usa seletores baseados em texto/aria
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
            # Salva no diretório correto usando a função auxiliar
            arquivo_pdf = await salvar_download(download, dest_dir)
            logger.info(f"✅ DANFS-e baixado: {download.suggested_filename} em {arquivo_pdf}")
            
        except Exception as e:
            logger.error(f"Erro ao baixar DANFS-e: {e}")
        
        # Fecha o menu novamente
        await icone_acoes.click()
        await page.wait_for_timeout(200)
        
    except Exception as e:
        logger.error(f"Erro ao baixar arquivos da linha: {e}")


async def processar_tabela_emitidas(page: Page, competencia_alvo: str, nome_empresa: str) -> None:
    """
    Processa a tabela de notas emitidas, varrendo todas as páginas.
    
    Args:
        page: Página do Playwright
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025")
        nome_empresa: Nome da empresa (do certificado digital)
    """
    logger.info(f"Iniciando processamento de Notas Emitidas para competência {competencia_alvo}")
    
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
                    
                    if competencia_texto == competencia_alvo:
                        encontrou_competencia = True
                        logger.info(f"Nota encontrada na linha {i+1} com competência {competencia_alvo}")
                        
                        # Verifica se a nota é válida
                        nota_valida = await verificar_nota_valida(linha)
                        
                        if nota_valida:
                            logger.info(f"Nota válida confirmada. Baixando arquivos...")
                            await baixar_arquivos_da_linha(page, linha, competencia_alvo, nome_empresa, "Emitidas")
                        else:
                            logger.info(f"Nota inválida/cancelada. Pulando download.")
                    
                except Exception as e:
                    logger.warning(f"Erro ao processar linha {i+1}: {e}")
                    continue
            
            # Verifica se precisa continuar na próxima página
            # Se a última linha ainda tem a competência alvo, continua
            if encontrou_competencia and total_linhas > 0:
                ultima_linha = linhas.nth(total_linhas - 1)
                celulas_ultima = ultima_linha.locator("td")
                
                try:
                    competencia_ultima = await celulas_ultima.nth(2).inner_text()
                    competencia_ultima = competencia_ultima.strip()
                    
                    if competencia_ultima == competencia_alvo:
                        # Ainda há notas da competência, vai para próxima página
                        logger.info("Última linha ainda tem competência alvo. Navegando para próxima página...")
                        
                        try:
                            # Tenta encontrar o botão de próxima página
                            # Baseado no código existente: li:nth-of-type(8) i
                            # XPath de referência: /html/body/div[1]/div[3]/div[1]/ul/li[6]/a/i
                            botao_proxima = page.locator("li:nth-of-type(8) i").first
                            
                            # Verifica se o botão existe e está habilitado
                            if await botao_proxima.count() > 0:
                                # Verifica se não está desabilitado
                                parent_link = botao_proxima.locator("..")  # Pega o elemento pai (link)
                                is_disabled = await parent_link.get_attribute("disabled")
                                
                                if not is_disabled:
                                    await botao_proxima.click()
                                    await page.wait_for_load_state("networkidle", timeout=10000)
                                    await page.wait_for_selector("table tbody tr", timeout=8000)
                                    logger.info("Navegou para próxima página")
                                    continue
                                else:
                                    logger.info("Botão de próxima página desabilitado. Encerrando.")
                                    break
                            else:
                                logger.info("Botão de próxima página não encontrado. Encerrando.")
                                break
                                
                        except Exception as e:
                            logger.warning(f"Erro ao navegar para próxima página: {e}")
                            break
                    else:
                        # Passou da competência desejada
                        logger.info("Passou da competência alvo. Encerrando busca em Emitidas.")
                        break
                        
                except Exception as e:
                    logger.warning(f"Erro ao verificar última linha: {e}")
                    break
            else:
                # Não encontrou mais notas da competência
                logger.info("Nenhuma nota da competência encontrada nesta página. Encerrando Emitidas.")
                break
                
        except PlaywrightTimeoutError:
            logger.error("Timeout ao aguardar tabela. Encerrando.")
            break
        except Exception as e:
            logger.error(f"Erro ao processar tabela de emitidas: {e}")
            break
    
    logger.info("Processamento de Notas Emitidas finalizado")


async def processar_tabela_recebidas(page: Page, competencia_alvo: str, nome_empresa: str) -> None:
    """
    Processa a tabela de notas recebidas, varrendo todas as páginas.
    
    Args:
        page: Página do Playwright
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025")
        nome_empresa: Nome da empresa (do certificado digital)
    """
    logger.info(f"Iniciando processamento de Notas Recebidas para competência {competencia_alvo}")
    
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
                    
                    if competencia_texto == competencia_alvo:
                        encontrou_competencia = True
                        logger.info(f"Nota encontrada na linha {i+1} com competência {competencia_alvo}")
                        
                        # Verifica se a nota é válida
                        nota_valida = await verificar_nota_valida(linha)
                        
                        if nota_valida:
                            logger.info(f"Nota válida confirmada. Baixando arquivos...")
                            await baixar_arquivos_da_linha(page, linha, competencia_alvo, nome_empresa, "Recebidas")
                        else:
                            logger.info(f"Nota inválida/cancelada. Pulando download.")
                    
                except Exception as e:
                    logger.warning(f"Erro ao processar linha {i+1}: {e}")
                    continue
            
            # Verifica se precisa continuar na próxima página
            # Se a última linha ainda tem a competência alvo, continua
            if encontrou_competencia and total_linhas > 0:
                ultima_linha = linhas.nth(total_linhas - 1)
                celulas_ultima = ultima_linha.locator("td")
                
                try:
                    competencia_ultima = await celulas_ultima.nth(2).inner_text()
                    competencia_ultima = competencia_ultima.strip()
                    
                    if competencia_ultima == competencia_alvo:
                        # Ainda há notas da competência, vai para próxima página
                        logger.info("Última linha ainda tem competência alvo. Navegando para próxima página...")
                        
                        try:
                            # Tenta encontrar o botão de próxima página
                            # Baseado no código existente: li:nth-of-type(8) i
                            botao_proxima = page.locator("li:nth-of-type(8) i").first
                            
                            # Verifica se o botão existe e está habilitado
                            if await botao_proxima.count() > 0:
                                # Verifica se não está desabilitado
                                parent_link = botao_proxima.locator("..")  # Pega o elemento pai (link)
                                is_disabled = await parent_link.get_attribute("disabled")
                                
                                if not is_disabled:
                                    await botao_proxima.click()
                                    await page.wait_for_load_state("networkidle", timeout=10000)
                                    await page.wait_for_selector("table tbody tr", timeout=8000)
                                    logger.info("Navegou para próxima página")
                                    continue
                                else:
                                    logger.info("Botão de próxima página desabilitado. Encerrando.")
                                    break
                            else:
                                logger.info("Botão de próxima página não encontrado. Encerrando.")
                                break
                                
                        except Exception as e:
                            logger.warning(f"Erro ao navegar para próxima página: {e}")
                            break
                    else:
                        # Passou da competência desejada
                        logger.info("Passou da competência alvo. Encerrando busca em Recebidas.")
                        break
                        
                except Exception as e:
                    logger.warning(f"Erro ao verificar última linha: {e}")
                    break
            else:
                # Não encontrou mais notas da competência
                logger.info("Nenhuma nota da competência encontrada nesta página. Encerrando Recebidas.")
                break
                
        except PlaywrightTimeoutError:
            logger.error("Timeout ao aguardar tabela. Encerrando.")
            break
        except Exception as e:
            logger.error(f"Erro ao processar tabela de recebidas: {e}")
            break
    
    logger.info("Processamento de Notas Recebidas finalizado")


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
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025")
        nome_empresa: Nome da empresa (do certificado digital)
    """
    logger.info(f"🚀 Iniciando processamento de notas para competência: {competencia_alvo}, empresa: {nome_empresa}")
    
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
        await page.wait_for_selector("table tbody tr", timeout=10000)
        
        logger.info("✅ Acessou Notas Emitidas com sucesso")
        
        # 2) Processar tabela de Notas Emitidas
        await processar_tabela_emitidas(page, competencia_alvo, nome_empresa)
        
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
        await page.wait_for_selector("table tbody tr", timeout=10000)
        
        logger.info("✅ Acessou Notas Recebidas com sucesso")
        
        # 5) Processar tabela de Notas Recebidas
        await processar_tabela_recebidas(page, competencia_alvo, nome_empresa)
        
        logger.info("🎉 Processamento completo finalizado!")
        
    except Exception as e:
        logger.error(f"❌ Erro durante processamento: {e}")
        raise


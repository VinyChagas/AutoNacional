#!/usr/bin/env python3
"""
Script de diagnóstico para identificar problemas no download de arquivos.

Este script ajuda a identificar problemas comuns:
1. Problemas com seletores CSS
2. Problemas com contexto do menu suspenso
3. Problemas com extração de href
4. Problemas com requisições HTTP
"""

import sys
import os
from pathlib import Path

# Adiciona o diretório do script ao path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeoutError
from urllib.parse import urljoin
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)


def diagnosticar_seletores(page: Page, linha_index: int = 0):
    """
    Diagnostica problemas com seletores na linha específica.
    
    Args:
        page: Página do Playwright
        linha_index: Índice da linha a ser diagnosticada (0 = primeira linha)
    """
    logger.info(f"🔍 Iniciando diagnóstico para linha {linha_index + 1}")
    
    try:
        # Aguarda tabela carregar
        page.wait_for_selector("table tbody tr", timeout=10000)
        
        # Obtém todas as linhas
        linhas = page.locator("table tbody tr")
        total_linhas = linhas.count()
        
        logger.info(f"📊 Total de linhas encontradas: {total_linhas}")
        
        if linha_index >= total_linhas:
            logger.error(f"❌ Linha {linha_index + 1} não existe. Total de linhas: {total_linhas}")
            return
        
        # Obtém a linha específica
        linha = linhas.nth(linha_index)
        celulas = linha.locator("td")
        
        # Lê informações da linha
        logger.info(f"📋 Informações da linha {linha_index + 1}:")
        try:
            competencia = celulas.nth(2).inner_text()
            logger.info(f"   Competência: {competencia.strip()}")
        except Exception as e:
            logger.warning(f"   ⚠️ Erro ao ler competência: {e}")
        
        # Tenta encontrar o menu suspenso
        logger.info(f"🔍 Procurando menu suspenso...")
        menu_suspenso = linha.locator('.menu-suspenso-tabela')
        menu_count = menu_suspenso.count()
        logger.info(f"   Menu suspenso encontrado: {menu_count} ocorrência(s)")
        
        if menu_count == 0:
            logger.error(f"❌ Menu suspenso não encontrado na linha {linha_index + 1}")
            return
        
        # Verifica se o menu está visível
        try:
            is_visible = menu_suspenso.first.is_visible()
            logger.info(f"   Menu está visível: {is_visible}")
        except Exception as e:
            logger.warning(f"   ⚠️ Erro ao verificar visibilidade: {e}")
        
        # Tenta encontrar o ícone de ações
        logger.info(f"🔍 Procurando ícone de ações...")
        coluna_acoes_idx = 5  # Para recebidas
        try:
            coluna_acoes = celulas.nth(coluna_acoes_idx)
            icone_acoes = coluna_acoes.locator("div a i, a i").first
            icone_count = icone_acoes.count()
            logger.info(f"   Ícone de ações encontrado: {icone_count} ocorrência(s)")
            
            if icone_count > 0:
                # Tenta clicar no ícone
                logger.info(f"🖱️ Clicando no ícone de ações...")
                icone_acoes.click()
                page.wait_for_timeout(500)
                
                # Aguarda menu aparecer
                menu_suspenso.first.wait_for(state='visible', timeout=3000)
                logger.info(f"✅ Menu aberto com sucesso")
                
                # Tenta encontrar links dentro do menu
                logger.info(f"🔍 Procurando links dentro do menu...")
                
                # Link XML
                link_xml = menu_suspenso.locator('a[href*="/EmissorNacional/Notas/Download/NFSe/"]').first
                xml_count = link_xml.count()
                logger.info(f"   Link XML encontrado: {xml_count} ocorrência(s)")
                
                if xml_count > 0:
                    try:
                        href_xml = link_xml.get_attribute('href')
                        logger.info(f"   ✅ Href XML: {href_xml}")
                    except Exception as e:
                        logger.error(f"   ❌ Erro ao obter href XML: {e}")
                else:
                    logger.warning(f"   ⚠️ Link XML não encontrado")
                
                # Link PDF
                link_pdf = menu_suspenso.locator('a[href*="/EmissorNacional/Notas/Download/DANFSe/"]').first
                pdf_count = link_pdf.count()
                logger.info(f"   Link PDF encontrado: {pdf_count} ocorrência(s)")
                
                if pdf_count > 0:
                    try:
                        href_pdf = link_pdf.get_attribute('href')
                        logger.info(f"   ✅ Href PDF: {href_pdf}")
                    except Exception as e:
                        logger.error(f"   ❌ Erro ao obter href PDF: {e}")
                else:
                    logger.warning(f"   ⚠️ Link PDF não encontrado")
                
                # Lista todos os links dentro do menu
                logger.info(f"🔍 Listando todos os links dentro do menu...")
                todos_links = menu_suspenso.locator('a').all()
                logger.info(f"   Total de links encontrados: {len(todos_links)}")
                
                for i, link in enumerate(todos_links):
                    try:
                        href = link.get_attribute('href')
                        texto = link.inner_text()
                        logger.info(f"   Link {i+1}: href='{href}', texto='{texto}'")
                    except Exception as e:
                        logger.warning(f"   ⚠️ Erro ao ler link {i+1}: {e}")
                
            else:
                logger.error(f"❌ Ícone de ações não encontrado")
        except Exception as e:
            logger.error(f"❌ Erro ao processar ícone de ações: {e}")
            import traceback
            logger.error(traceback.format_exc())
        
    except PlaywrightTimeoutError:
        logger.error(f"❌ Timeout ao aguardar elementos")
    except Exception as e:
        logger.error(f"❌ Erro durante diagnóstico: {e}")
        import traceback
        logger.error(traceback.format_exc())


def main():
    """Função principal do diagnóstico."""
    print("=" * 80)
    print("🔍 DIAGNÓSTICO DE DOWNLOADS")
    print("=" * 80)
    print()
    
    if len(sys.argv) < 2:
        print("Uso: python debug_download.py <cnpj> [linha_index]")
        print()
        print("Exemplo:")
        print("  python debug_download.py 12345678000190 0  # Primeira linha")
        print("  python debug_download.py 12345678000190 1  # Segunda linha")
        sys.exit(1)
    
    cnpj = sys.argv[1]
    linha_index = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    
    print(f"CNPJ: {cnpj}")
    print(f"Linha a diagnosticar: {linha_index + 1}")
    print()
    
    try:
        from playwright_nfse import abrir_dashboard_nfse
        
        print("🔐 Fazendo login...")
        resultado = abrir_dashboard_nfse(
            cnpj=cnpj,
            headless=False,  # Sempre visível para diagnóstico
            timeout=30000
        )
        
        if not resultado.get('sucesso'):
            print(f"❌ Erro no login: {resultado.get('mensagem')}")
            sys.exit(1)
        
        page = resultado.get('page')
        
        # Navega para recebidas
        print("📋 Navegando para Notas Recebidas...")
        menu_recebidas = page.locator("li:nth-of-type(4) img").first
        menu_recebidas.wait_for(state="visible", timeout=10000)
        menu_recebidas.click()
        page.wait_for_url("**/Notas/Recebidas", timeout=15000)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_selector("table tbody tr", timeout=10000)
        
        print("✅ Página carregada")
        print()
        
        # Executa diagnóstico
        diagnosticar_seletores(page, linha_index)
        
        print()
        print("=" * 80)
        print("✅ Diagnóstico concluído")
        print("=" * 80)
        print()
        print("⏸️  Navegador aberto. Pressione Enter para fechar...")
        input()
        
    except Exception as e:
        print(f"❌ Erro durante execução: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()


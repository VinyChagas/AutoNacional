def acessar_notas_recebidas(page):
    logging.info("Acessando tela de Notas Recebidas")
    try:
        menu = page.locator("li:nth-of-type(4) img")
        # Clique com offset relativo informado
        menu.click(position={"x": 8.24, "y": 26.77})
        page.wait_for_selector("table tbody tr", timeout=10000)
        logging.info("Entrou em Notas Recebidas")
    except Exception as e:
        logging.error(f"Erro ao acessar Notas Recebidas: {e}")
        raise

def processar_tabela_recebidas(page, competencia, context):
    while True:
        linhas = page.locator("table tbody tr")
        total = linhas.count()
        logging.info(f"Processando {total} linhas na página atual (Recebidas)")
        todas_validas = True
        encontrou_valida = False
        for i in range(total):
            linha = linhas.nth(i)
            celulas = linha.locator("td")
            competencia_val = celulas.nth(_get_col_index(page, "Competência")).inner_text().strip()
            empresa = celulas.nth(_get_col_index(page, "Emitida por")).inner_text().strip().replace("/", "-").replace("\\", "-")
            numero_nota = celulas.nth(_get_col_index(page, "Emissão")).inner_text().strip().replace("/", "-") + f"_{i+1}"
            if competencia_val == competencia:
                encontrou_valida = True
                try:
                    # Baixar XML
                    abrir_menu_acao_linha(page, linha)
                    page.wait_for_timeout(200)
                    menu = linha.locator('.menu-suspenso-tabela')
                    menu.wait_for(state='visible', timeout=5000)
                    with page.expect_download() as download_info:
                        link_xml = menu.locator('a:has-text("XML")').first
                        link_xml.wait_for(state='visible', timeout=2000)
                        link_xml.click()
                    download = download_info.value
                    salvar_arquivo(download, competencia, empresa, "recebidas", f"{numero_nota}.xml")

                    # Baixar PDF (DANFS-e) - robusto
                    for tentativa in range(2):
                        abrir_menu_acao_linha(page, linha)
                        page.wait_for_timeout(200)
                        menu = linha.locator('.menu-suspenso-tabela')
                        menu.wait_for(state='visible', timeout=5000)
                        link_pdf = menu.locator('a:has-text("DANFS-e")').first
                        if link_pdf.is_visible():
                            try:
                                with page.expect_download() as download_info:
                                    link_pdf.click()
                                download = download_info.value
                                salvar_arquivo(download, competencia, empresa, "recebidas", f"{numero_nota}.pdf")
                                break
                            except Exception as e:
                                logging.error(f"Erro ao clicar no link DANFS-e da linha {i+1} (Recebidas): {e}")
                        else:
                            logging.warning(f"Link DANFS-e não visível na linha {i+1} (Recebidas), tentativa {tentativa+1}")
                            page.wait_for_timeout(300)
                    else:
                        logging.error(f"Não foi possível baixar o DANFS-e da linha {i+1} (Recebidas): link não ficou visível após 2 tentativas.")
                except Exception as e:
                    logging.error(f"Erro ao baixar arquivos da linha {i+1} (Recebidas): {e}")
            else:
                todas_validas = False
        if not encontrou_valida:
            logging.info("Nenhuma linha da competência encontrada. Encerrando Recebidas.")
            break
        if todas_validas:
            try:
                navegar_proxima_pagina(page)
            except Exception:
                logging.info("Não há próxima página. Encerrando Recebidas.")
                break
        else:
            logging.info("Página mista encontrada. Encerrando Recebidas.")
            break

def executar_fluxo_recebidas(page, competencia, context):
    acessar_notas_recebidas(page)
    ordenar_por_competencia(page)
    processar_tabela_recebidas(page, competencia, context)
import os
import sys
import logging
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from salvamento import salvar_arquivo

def login(page):
    # Supondo que a autenticação já foi feita pelo backend
    logging.info("Sessão já autenticada. Pronto para navegar.")

def acessar_notas_emitidas(page):
    logging.info("Acessando tela de Notas Emitidas")
    try:
        menu = page.locator("li:nth-of-type(3) img")
        menu.click()
        page.wait_for_selector("table tbody tr", timeout=10000)
        logging.info("Entrou em Notas Emitidas")
    except Exception as e:
        logging.error(f"Erro ao acessar Notas Emitidas: {e}")
        raise

def ordenar_por_competencia(page):
    logging.info("Ordenando tabela pela coluna Competência")
    try:
        th = page.locator("th.td-competencia")
        th.click()
        page.wait_for_timeout(1000)
    except Exception as e:
        logging.error(f"Erro ao ordenar por competência: {e}")
        raise

def abrir_menu_acao_linha(page, linha):
    try:
        acao = linha.locator("a:has(i)")
        acao.click()
        page.wait_for_timeout(300)
    except Exception as e:
        logging.error(f"Erro ao abrir menu de ações: {e}")
        raise

def baixar_xml(page):
    try:
        page.get_by_text("Download XML").click()
    except Exception:
        page.locator('a:has-text("XML")').click()

def baixar_pdf(page):
    try:
        page.get_by_text("Download DANFS-e").click()
    except Exception:
        page.locator('a:has-text("DANFE")').click()

def abrir_em_nova_aba(context, url):
    page = context.new_page()
    page.goto(url)
    return page



def navegar_proxima_pagina(page):
    try:
        page.locator("li:nth-of-type(8) i").click()
        page.wait_for_selector("table tbody tr", timeout=10000)
        logging.info("Navegou para próxima página")
    except Exception as e:
        logging.error(f"Erro ao navegar para próxima página: {e}")
        raise

def processar_tabela_emitidas(page, competencia, context):
    while True:
        linhas = page.locator("table tbody tr")
        total = linhas.count()
        logging.info(f"Processando {total} linhas na página atual")
        todas_validas = True
        encontrou_valida = False
        for i in range(total):
            linha = linhas.nth(i)
            celulas = linha.locator("td")
            competencia_val = celulas.nth(_get_col_index(page, "Competência")).inner_text().strip()
            empresa = celulas.nth(_get_col_index(page, "Emitida para")).inner_text().strip().replace("/", "-").replace("\\", "-")
            numero_nota = celulas.nth(_get_col_index(page, "Emissão")).inner_text().strip().replace("/", "-") + f"_{i+1}"
            if competencia_val == competencia:
                encontrou_valida = True
                try:
                    # Baixar XML
                    abrir_menu_acao_linha(page, linha)
                    page.wait_for_timeout(200)
                    menu = linha.locator('.menu-suspenso-tabela')
                    menu.wait_for(state='visible', timeout=5000)
                    with page.expect_download() as download_info:
                        link_xml = menu.locator('a:has-text("XML")').first
                        link_xml.wait_for(state='visible', timeout=2000)
                        link_xml.click()
                    download = download_info.value
                    salvar_arquivo(download, competencia, empresa, "emitidas", f"{numero_nota}.xml")

                    # Baixar PDF (DANFS-e) - robusto
                    for tentativa in range(2):
                        abrir_menu_acao_linha(page, linha)
                        page.wait_for_timeout(200)
                        menu = linha.locator('.menu-suspenso-tabela')
                        menu.wait_for(state='visible', timeout=5000)
                        link_pdf = menu.locator('a:has-text("DANFS-e")').first
                        if link_pdf.is_visible():
                            try:
                                with page.expect_download() as download_info:
                                    link_pdf.click()
                                download = download_info.value
                                salvar_arquivo(download, competencia, empresa, "emitidas", f"{numero_nota}.pdf")
                                break
                            except Exception as e:
                                logging.error(f"Erro ao clicar no link DANFS-e da linha {i+1}: {e}")
                        else:
                            logging.warning(f"Link DANFS-e não visível na linha {i+1}, tentativa {tentativa+1}")
                            page.wait_for_timeout(300)
                    else:
                        logging.error(f"Não foi possível baixar o DANFS-e da linha {i+1}: link não ficou visível após 2 tentativas.")
                except Exception as e:
                    logging.error(f"Erro ao baixar arquivos da linha {i+1}: {e}")
            else:
                todas_validas = False
        if not encontrou_valida:
            logging.info("Nenhuma linha da competência encontrada. Encerrando Emitidas.")
            break
        if todas_validas:
            try:
                navegar_proxima_pagina(page)
            except Exception:
                logging.info("Não há próxima página. Encerrando Emitidas.")
                break
        else:
            logging.info("Página mista encontrada. Encerrando Emitidas.")
            break

def _get_col_index(page, header_text):
    headers = page.locator("table thead tr th")
    count = headers.count()
    for i in range(count):
        if headers.nth(i).get_attribute("aria-label") == header_text or headers.nth(i).inner_text().strip() == header_text:
            return i
    raise Exception(f"Coluna '{header_text}' não encontrada")

def executar_fluxo_emitidas(page, competencia, context):
    acessar_notas_emitidas(page)
    ordenar_por_competencia(page)
    processar_tabela_emitidas(page, competencia, context)

def main():
    import argparse
    import logging
    from playwright_nfse import abrir_dashboard_nfse, NFSeAutenticacaoError
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("cnpj", type=str, help="CNPJ da empresa")
    parser.add_argument("competencia", type=str, help="Competência (ex: 112025)")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--tipo", type=str, choices=["emitidas", "recebidas", "ambas"], default="emitidas", help="Tipo de notas: emitidas, recebidas ou ambas")
    args = parser.parse_args()
    cnpj = args.cnpj
    competencia = args.competencia
    headless = args.headless
    tipo = args.tipo
    try:
        resultado = abrir_dashboard_nfse(
            cnpj=cnpj,
            headless=headless,
            timeout=30000
        )
        page = resultado.get("page")
        context = page.context
        if tipo == "emitidas":
            executar_fluxo_emitidas(page, competencia, context)
            print("✅ Fluxo de Notas Emitidas finalizado.")
        elif tipo == "recebidas":
            executar_fluxo_recebidas(page, competencia, context)
            print("✅ Fluxo de Notas Recebidas finalizado.")
        elif tipo == "ambas":
            executar_fluxo_emitidas(page, competencia, context)
            print("✅ Fluxo de Notas Emitidas finalizado.")
            executar_fluxo_recebidas(page, competencia, context)
            print("✅ Fluxo de Notas Recebidas finalizado.")
        if not headless:
            print("\n⏸️  Navegador aberto. Pressione Enter para fechar...")
            input()
    except NFSeAutenticacaoError as e:
        print(f"❌ ERRO DE AUTENTICAÇÃO: {str(e)}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERRO INESPERADO: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

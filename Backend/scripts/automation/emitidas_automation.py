def acessar_notas_recebidas(page):
    logging.info("Acessando tela de Notas Recebidas")
    try:
        menu = page.locator("li:nth-of-type(4) img")
        # Clique com offset relativo informado
        menu.click(position={"x": 8.24, "y": 26.77})
        # Reduzido timeout de 10000ms para 8000ms - otimização
        page.wait_for_selector("table tbody tr", timeout=8000)
        logging.info("Entrou em Notas Recebidas")
    except Exception as e:
        logging.error(f"Erro ao acessar Notas Recebidas: {e}")
        raise

def processar_tabela_recebidas(page, competencia, context):
    """
    Processa a tabela de notas recebidas, varrendo todas as páginas.
    
    Esta função processa TODAS as notas da competência alvo, ignorando notas canceladas
    e continuando até não haver mais notas da competência.
    
    Args:
        page: Página do Playwright
        competencia: Competência alvo no formato "MM/AAAA" (ex: "10/2025") ou "MMAAAA" (ex: "102025")
        context: Contexto do Playwright
    """
    # Normaliza a competência UMA VEZ no início para garantir comparação correta
    competencia_normalizada = _normalizar_competencia(competencia)
    logging.info(f"🔄 Iniciando processamento de Notas Recebidas para competência {competencia} (normalizada: {competencia_normalizada})")
    logging.info(f"   ⚠️  IMPORTANTE: A navegação será baseada APENAS na última linha da página, independente de quantas notas da competência foram encontradas.")
    
    # Contadores para estatísticas
    total_notas_encontradas = 0
    notas_validas_baixadas = 0
    notas_canceladas_ignoradas = 0
    
    while True:
        try:
            logging.info("📄 Processando página atual (Recebidas)")
            linhas = page.locator("table tbody tr")
            total = linhas.count()
            
            if total == 0:
                logging.info("Nenhuma linha encontrada na tabela. Encerrando.")
                break
            
            logging.info(f"📋 Processando {total} linhas na página atual (Recebidas)")
            
            # Variável para rastrear se encontrou notas da competência nesta página (para estatísticas)
            encontrou_competencia_na_pagina = False
            
            # ====================================================================
            # PROCESSAMENTO DE CADA LINHA DA PÁGINA
            # ====================================================================
            # Para cada linha da página atual (máximo 15 linhas):
            # 1. Lê a competência da nota
            # 2. Se for igual à competência alvo:
            #    - Verifica se está cancelada
            #    - Se válida → baixa a nota
            #    - Se cancelada → ignora e continua (NÃO encerra o fluxo)
            # 3. Se for diferente → apenas continua para próxima linha
            # ====================================================================
            
            for i in range(total):
                linha = linhas.nth(i)
                celulas = linha.locator("td")
                
                try:
                    competencia_val = celulas.nth(_get_col_index(page, "Competência")).inner_text().strip()
                    empresa = celulas.nth(_get_col_index(page, "Emitida por")).inner_text().strip().replace("/", "-").replace("\\", "-")
                    numero_nota = celulas.nth(_get_col_index(page, "Emissão")).inner_text().strip().replace("/", "-") + f"_{i+1}"
                    
                    # Verifica se a nota pertence à competência alvo (usando competência já normalizada)
                    competencia_val_normalizada = _normalizar_competencia(competencia_val)
                    if competencia_val_normalizada == competencia_normalizada:
                        encontrou_competencia_na_pagina = True
                        total_notas_encontradas += 1
                        
                        logging.info(f"📄 Nota encontrada na linha {i+1} com competência {competencia_normalizada}")
                        
                        # IMPORTANTE: Verifica se a nota está cancelada ANTES de tentar baixar
                        nota_valida = verificar_nota_valida(linha)
                        
                        if nota_valida:
                            # Nota válida - procede com o download
                            logging.info(f"✅ Nota válida confirmada na linha {i+1}. Iniciando download...")
                            try:
                                # Baixar XML
                                abrir_menu_acao_linha(page, linha)
                                menu = linha.locator('.menu-suspenso-tabela')
                                menu.wait_for(state='visible', timeout=3000)
                                with page.expect_download() as download_info:
                                    link_xml = menu.locator('a:has-text("XML")').first
                                    link_xml.wait_for(state='visible', timeout=2000)
                                    link_xml.click()
                                download = download_info.value
                                salvar_arquivo(download, competencia, empresa, "recebidas", f"{numero_nota}.xml")

                                # Baixar PDF (DANFS-e) - robusto e otimizado
                                for tentativa in range(2):
                                    abrir_menu_acao_linha(page, linha)
                                    menu = linha.locator('.menu-suspenso-tabela')
                                    menu.wait_for(state='visible', timeout=3000)
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
                                        page.wait_for_timeout(200)
                                else:
                                    logging.error(f"Não foi possível baixar o DANFS-e da linha {i+1} (Recebidas): link não ficou visível após 2 tentativas.")
                                
                                notas_validas_baixadas += 1
                                logging.info(f"✅ Download concluído com sucesso para linha {i+1}")
                                
                            except Exception as e:
                                logging.error(f"❌ Erro ao baixar arquivos da linha {i+1} (Recebidas): {e}")
                                # IMPORTANTE: Continua para próxima linha mesmo se houver erro
                                # Tenta fechar menu se estiver aberto
                                try:
                                    page.keyboard.press("Escape")
                                    page.wait_for_timeout(200)
                                except:
                                    pass
                                continue
                        else:
                            # Nota cancelada - ignora e continua
                            notas_canceladas_ignoradas += 1
                            logging.info(f"⚠️  Nota cancelada na linha {i+1}. Ignorando e continuando...")
                            # Continua para próxima linha (NÃO encerra o fluxo)
                            continue
                    
                    # Se a competência for diferente, apenas continua para próxima linha
                    # (a decisão de navegação será feita no final, baseada na última linha)
                    
                except Exception as e:
                    logging.warning(f"⚠️  Erro ao processar linha {i+1} (Recebidas): {e}")
                    # Continua para próxima linha mesmo se houver erro
                    continue
            
            # Log de estatísticas da página
            logging.info(f"📊 Resumo da página (Recebidas): {total_notas_encontradas} nota(s) encontrada(s), "
                        f"{notas_validas_baixadas} baixada(s), {notas_canceladas_ignoradas} cancelada(s) ignorada(s)")
            
            # ====================================================================
            # LÓGICA DE NAVEGAÇÃO ENTRE PÁGINAS
            # ====================================================================
            # REGRA PRINCIPAL: A decisão de navegar para próxima página é baseada
            # APENAS na última linha da página atual, independente de ter encontrado
            # notas válidas ou canceladas na página.
            #
            # - Se a última linha tem a competência alvo → navega para próxima página
            # - Se a última linha não tem a competência alvo → encerra (passou da competência)
            # ====================================================================
            
            if total > 0:
                # SEMPRE verifica a última linha para decidir se continua ou encerra
                # IMPORTANTE: Recria os locators para evitar problemas com elementos "stale"
                logging.info(f"🔍 Verificando última linha (linha {total}) para decidir navegação...")
                
                try:
                    # Recria os locators da tabela para garantir que estão atualizados
                    linhas_atualizadas = page.locator("table tbody tr")
                    ultima_linha = linhas_atualizadas.nth(total - 1)
                    
                    # Aguarda a última linha estar visível
                    ultima_linha.wait_for(state='visible', timeout=5000)
                    
                    celulas_ultima = ultima_linha.locator("td")
                    
                    # Obtém o índice da coluna Competência (recria para garantir que está atualizado)
                    col_index_competencia = _get_col_index(page, "Competência")
                    logging.info(f"   📍 Índice da coluna Competência: {col_index_competencia}")
                    
                    # Lê a competência da última linha
                    competencia_ultima_raw = celulas_ultima.nth(col_index_competencia).inner_text()
                    competencia_ultima = competencia_ultima_raw.strip()
                    
                    logging.info(f"   📋 Competência da última linha (raw): '{competencia_ultima}'")
                    logging.info(f"   🎯 Competência alvo (já normalizada no início): '{competencia_normalizada}'")
                    
                    # Normaliza apenas a competência da última linha (a alvo já está normalizada no início da função)
                    competencia_ultima_normalizada = _normalizar_competencia(competencia_ultima)
                    
                    # Log detalhado (agora em INFO para visibilidade)
                    logging.info(f"   🔄 Competência última linha normalizada: '{competencia_ultima_normalizada}'")
                    logging.info(f"   ⚖️  Comparação: '{competencia_ultima_normalizada}' == '{competencia_normalizada}' ? {competencia_ultima_normalizada == competencia_normalizada}")
                    logging.info(f"   📌 REGRA: Se última linha tem a competência '{competencia_normalizada}' → navega para próxima página")
                    logging.info(f"   📌 REGRA: Se última linha NÃO tem a competência → encerra (passou da competência)")
                    logging.info(f"   ⚠️  IMPORTANTE: Esta decisão é baseada APENAS na última linha, independente de quantas notas da competência foram encontradas na página!")
                    
                    # Se a última linha ainda tem a competência alvo, há mais notas na próxima página
                    # IMPORTANTE: Isso vale mesmo que todas as notas da página atual sejam canceladas
                    # IMPORTANTE: Não importa quantas linhas da competência existem na página, apenas a última linha importa!
                    if competencia_ultima_normalizada == competencia_normalizada:
                        logging.info(f"✅ MATCH! Última linha tem a mesma competência '{competencia_normalizada}'.")
                        logging.info("   ➡️  Navegando para próxima página para continuar buscando...")
                        
                        try:
                            logging.info("   🔍 Chamando função navegar_proxima_pagina()...")
                            navegar_proxima_pagina(page)
                            logging.info("   ⏳ Aguardando tabela carregar após navegação...")
                            # Aguarda a tabela carregar após navegação
                            page.wait_for_selector("table tbody tr", timeout=8000)
                            # Pequeno delay para garantir que a tabela está estável
                            page.wait_for_timeout(500)
                            logging.info("   ✅ Navegação concluída com sucesso! Continuando processamento...")
                            # Continua o loop para processar próxima página
                            continue
                        except Exception as e:
                            # Não há próxima página disponível ou erro ao navegar
                            logging.error(f"❌ ERRO ao navegar para próxima página: {e}")
                            import traceback
                            logging.error(f"   Traceback completo:\n{traceback.format_exc()}")
                            logging.info("   ⚠️  Encerrando busca em Recebidas (não há mais páginas ou erro na navegação).")
                            break
                    else:
                        # A última linha não tem mais a competência alvo
                        # Isso significa que já passou de todas as notas da competência
                        logging.info(f"❌ SEM MATCH! Última linha tem competência '{competencia_ultima_normalizada}'.")
                        logging.info(f"   🛑 Passou da competência alvo '{competencia_normalizada}'. Encerrando busca em Recebidas.")
                        break
                        
                except Exception as e:
                    logging.error(f"❌ Erro ao verificar última linha: {e}")
                    import traceback
                    logging.error(f"   Traceback: {traceback.format_exc()}")
                    logging.warning("   Encerrando por segurança.")
                    break
            else:
                # Não há linhas na tabela - encerra
                logging.info("Nenhuma linha encontrada na tabela. Encerrando.")
                break
                
        except Exception as e:
            logging.error(f"❌ Erro ao processar tabela de recebidas: {e}")
            break
    
    # Log final com estatísticas completas
    logging.info("=" * 80)
    logging.info(f"📊 RESUMO FINAL - Notas Recebidas para competência {competencia}")
    logging.info(f"   Total de notas encontradas: {total_notas_encontradas}")
    logging.info(f"   ✅ Notas válidas baixadas: {notas_validas_baixadas}")
    logging.info(f"   ⚠️  Notas canceladas ignoradas: {notas_canceladas_ignoradas}")
    logging.info("=" * 80)

def executar_fluxo_recebidas(page, competencia, context):
    acessar_notas_recebidas(page)
    ordenar_por_competencia(page)
    processar_tabela_recebidas(page, competencia, context)
import os
import sys
import logging
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError  # pyright: ignore[reportMissingImports]
from salvamento import salvar_arquivo

def login(page):
    # Supondo que a autenticação já foi feita pelo backend
    logging.info("Sessão já autenticada. Pronto para navegar.")

def acessar_notas_emitidas(page):
    logging.info("Acessando tela de Notas Emitidas")
    try:
        menu = page.locator("li:nth-of-type(3) img")
        menu.click()
        # Reduzido timeout de 10000ms para 8000ms - otimização
        # A tabela geralmente carrega rapidamente
        page.wait_for_selector("table tbody tr", timeout=8000)
        logging.info("Entrou em Notas Emitidas")
    except Exception as e:
        logging.error(f"Erro ao acessar Notas Emitidas: {e}")
        raise

def ordenar_por_competencia(page):
    logging.info("Ordenando tabela pela coluna Competência")
    try:
        th = page.locator("th.td-competencia")
        th.click()
        # Aguarda ordenação completar - reduzido de 1000ms para 500ms (otimização)
        # A ordenação geralmente é instantânea, então 500ms é suficiente
        page.wait_for_timeout(500)
    except Exception as e:
        logging.error(f"Erro ao ordenar por competência: {e}")
        raise

def abrir_menu_acao_linha(page, linha):
    try:
        acao = linha.locator("a:has(i)")
        acao.click()
        # Aguarda menu aparecer de forma condicional ao invés de fixo
        # Reduzido de 300ms para espera condicional - otimização de tempo
        try:
            # Tenta aguardar o menu aparecer (mais rápido se aparecer antes)
            menu = linha.locator('.menu-suspenso-tabela')
            menu.wait_for(state='visible', timeout=500)
        except:
            # Fallback: pequeno delay se necessário
            page.wait_for_timeout(100)
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
    """
    Navega para a próxima página usando o botão "Próxima".
    
    Usa o elemento: <a data-original-title="Próxima"><i class="fa fa-angle-right"></i></a>
    XPath: /html/body/div[1]/div[3]/div[1]/ul/li[6]/a
    
    Args:
        page: Página do Playwright
        
    Raises:
        Exception: Se não conseguir encontrar ou clicar no botão "Próxima"
    """
    logging.info("   🔍 Iniciando busca pelo botão 'Próxima'...")
    try:
        # Tenta múltiplos seletores para encontrar o botão "Próxima" (em ordem de prioridade)
        botao_proxima = None
        estrategia_usada = None
        
        # Estratégia 1: Por XPath específico fornecido (mais confiável)
        try:
            logging.info("   📍 Tentativa 1: Buscando via XPath...")
            botao_proxima = page.locator('xpath=/html/body/div[1]/div[3]/div[1]/ul/li[6]/a')
            count = botao_proxima.count()
            logging.info(f"   📊 Elementos encontrados via XPath: {count}")
            if count > 0:
                estrategia_usada = "XPath"
                logging.info("   ✅ Botão 'Próxima' encontrado via XPath")
            else:
                raise Exception("Não encontrado via XPath")
        except Exception as e1:
            logging.info(f"   ⚠️  XPath falhou: {e1}")
            # Estratégia 2: Por data-original-title="Próxima"
            try:
                logging.info("   📍 Tentativa 2: Buscando via data-original-title...")
                botao_proxima = page.locator('a[data-original-title="Próxima"]')
                count = botao_proxima.count()
                logging.info(f"   📊 Elementos encontrados via data-original-title: {count}")
                if count > 0:
                    estrategia_usada = "data-original-title"
                    logging.info("   ✅ Botão 'Próxima' encontrado via data-original-title")
                else:
                    raise Exception("Não encontrado via data-original-title")
            except Exception as e2:
                logging.info(f"   ⚠️  data-original-title falhou: {e2}")
                # Estratégia 3: Por ícone fa-angle-right dentro do link
                try:
                    logging.info("   📍 Tentativa 3: Buscando via ícone fa-angle-right...")
                    botao_proxima = page.locator('a:has(i.fa-angle-right)')
                    count = botao_proxima.count()
                    logging.info(f"   📊 Elementos encontrados via ícone: {count}")
                    if count > 0:
                        estrategia_usada = "ícone fa-angle-right"
                        logging.info("   ✅ Botão 'Próxima' encontrado via ícone fa-angle-right")
                    else:
                        raise Exception("Não encontrado via ícone")
                except Exception as e3:
                    logging.error(f"   ❌ Todas as estratégias falharam!")
                    logging.error(f"      XPath: {e1}")
                    logging.error(f"      data-original-title: {e2}")
                    logging.error(f"      ícone: {e3}")
                    raise Exception("Botão 'Próxima' não encontrado com nenhuma estratégia")
        
        logging.info(f"   ✅ Botão encontrado usando estratégia: {estrategia_usada}")
        
        # Verifica se o botão está habilitado (não está desabilitado)
        # O botão pode estar desabilitado se já estiver na última página
        try:
            logging.info("   🔍 Verificando se botão está habilitado...")
            parent_element = botao_proxima.locator("..")
            is_disabled = parent_element.get_attribute("disabled")
            class_attr = parent_element.get_attribute("class")
            logging.info(f"   📊 Atributo disabled: {is_disabled}, classe: {class_attr}")
            if is_disabled or (class_attr and "disabled" in class_attr.lower()):
                raise Exception("Botão 'Próxima' está desabilitado (já está na última página)")
            logging.info("   ✅ Botão está habilitado")
        except Exception as e:
            # Se não conseguir verificar disabled, continua (pode não ter esse atributo)
            logging.info(f"   ⚠️  Não foi possível verificar disabled: {e}")
            logging.info("   ➡️  Continuando mesmo assim...")
        
        # Aguarda o elemento estar visível
        logging.info("   ⏳ Aguardando botão ficar visível...")
        botao_proxima.wait_for(state='visible', timeout=5000)
        logging.info("   ✅ Botão está visível")
        
        # Verifica se está clicável
        logging.info("   🔍 Verificando se botão está clicável...")
        is_enabled = botao_proxima.is_enabled()
        logging.info(f"   📊 Botão está enabled: {is_enabled}")
        
        # Clica no botão
        logging.info("   🖱️  Clicando no botão 'Próxima'...")
        botao_proxima.click()
        logging.info("   ✅ Clique realizado com sucesso")
        
        # Aguarda a tabela carregar após navegação
        logging.info("   ⏳ Aguardando tabela carregar após navegação...")
        page.wait_for_selector("table tbody tr", timeout=8000)
        logging.info("   ✅ Tabela carregada")
        logging.info("   ✅ Navegação para próxima página concluída com sucesso!")
        
    except Exception as e:
        logging.error(f"   ❌ ERRO ao navegar para próxima página: {e}")
        import traceback
        logging.error(f"   Traceback:\n{traceback.format_exc()}")
        raise

def verificar_nota_cancelada(linha):
    """
    Verifica se uma nota fiscal está cancelada baseado no ícone na coluna de status.
    
    Verifica tanto a coluna 5 (índice 4) quanto a coluna 6 (índice 5) para cobrir
    tanto notas recebidas quanto emitidas.
    
    Args:
        linha: Locator da linha da tabela
        
    Returns:
        True se a nota estiver cancelada, False caso contrário
    """
    try:
        celulas = linha.locator("td")
        
        # Verifica ambas as colunas possíveis (coluna 5 para recebidas, coluna 6 para emitidas)
        for col_idx in [4, 5]:
            try:
                coluna_status = celulas.nth(col_idx)
                img_status = coluna_status.locator("img")
                
                if img_status.count() > 0:
                    # Verifica atributo src para imagem de cancelada
                    src_text = img_status.get_attribute("src")
                    if src_text:
                        if "tb-cancelada.svg" in src_text or "cancelada" in src_text.lower():
                            logging.debug(f"Nota cancelada detectada via src da imagem na coluna {col_idx + 1}")
                            return True
                    
                    # Verifica atributo data-original-title
                    data_original_title = img_status.get_attribute("data-original-title")
                    if data_original_title:
                        if "cancelada" in data_original_title.lower() or "cancel" in data_original_title.lower():
                            logging.debug(f"Nota cancelada detectada via data-original-title na coluna {col_idx + 1}")
                            return True
                    
                    # Verifica atributo title
                    title_text = img_status.get_attribute("title")
                    if title_text:
                        if "cancelada" in title_text.lower() or "cancel" in title_text.lower():
                            logging.debug(f"Nota cancelada detectada via title na coluna {col_idx + 1}")
                            return True
            except Exception:
                # Continua para próxima coluna se houver erro
                continue
        
        # Não encontrou indicadores de cancelada
        return False
        
    except Exception as e:
        logging.warning(f"Erro ao verificar se nota está cancelada: {e}. Assumindo não cancelada.")
        return False

def verificar_nota_valida(linha):
    """
    Verifica se uma nota fiscal é válida (não cancelada).
    
    Args:
        linha: Locator da linha da tabela
        
    Returns:
        True se a nota for válida (não cancelada), False caso contrário
    """
    try:
        # Primeiro verifica se está cancelada
        if verificar_nota_cancelada(linha):
            logging.info("⚠️  Nota fiscal cancelada detectada. Não será baixada.")
            return False
        
        # Se não está cancelada, assume válida
        return True
        
    except Exception as e:
        logging.warning(f"Erro ao verificar validade da nota: {e}. Assumindo válida.")
        return True

def processar_tabela_emitidas(page, competencia, context):
    """
    Processa a tabela de notas emitidas, varrendo todas as páginas.
    
    Esta função processa TODAS as notas da competência alvo, ignorando notas canceladas
    e continuando até não haver mais notas da competência.
    
    Args:
        page: Página do Playwright
        competencia: Competência alvo no formato "MM/AAAA" (ex: "10/2025") ou "MMAAAA" (ex: "102025")
        context: Contexto do Playwright
    """
    # Normaliza a competência UMA VEZ no início para garantir comparação correta
    competencia_normalizada = _normalizar_competencia(competencia)
    logging.info(f"🔄 Iniciando processamento de Notas Emitidas para competência {competencia} (normalizada: {competencia_normalizada})")
    logging.info(f"   ⚠️  IMPORTANTE: A navegação será baseada APENAS na última linha da página, independente de quantas notas da competência foram encontradas.")
    
    # Contadores para estatísticas
    total_notas_encontradas = 0
    notas_validas_baixadas = 0
    notas_canceladas_ignoradas = 0
    
    while True:
        try:
            logging.info("📄 Processando página atual (Emitidas)")
            linhas = page.locator("table tbody tr")
            total = linhas.count()
            
            if total == 0:
                logging.info("Nenhuma linha encontrada na tabela. Encerrando.")
                break
            
            logging.info(f"📋 Processando {total} linhas na página atual (Emitidas)")
            
            # Variável para rastrear se encontrou notas da competência nesta página (para estatísticas)
            encontrou_competencia_na_pagina = False
            
            # ====================================================================
            # PROCESSAMENTO DE CADA LINHA DA PÁGINA
            # ====================================================================
            # Para cada linha da página atual (máximo 15 linhas):
            # 1. Lê a competência da nota
            # 2. Se for igual à competência alvo:
            #    - Verifica se está cancelada
            #    - Se válida → baixa a nota
            #    - Se cancelada → ignora e continua (NÃO encerra o fluxo)
            # 3. Se for diferente → apenas continua para próxima linha
            # ====================================================================
            
            for i in range(total):
                linha = linhas.nth(i)
                celulas = linha.locator("td")
                
                try:
                    competencia_val = celulas.nth(_get_col_index(page, "Competência")).inner_text().strip()
                    empresa = celulas.nth(_get_col_index(page, "Emitida para")).inner_text().strip().replace("/", "-").replace("\\", "-")
                    numero_nota = celulas.nth(_get_col_index(page, "Emissão")).inner_text().strip().replace("/", "-") + f"_{i+1}"
                    
                    # Verifica se a nota pertence à competência alvo (usando competência já normalizada no início)
                    competencia_val_normalizada = _normalizar_competencia(competencia_val)
                    if competencia_val_normalizada == competencia_normalizada:
                        encontrou_competencia_na_pagina = True
                        total_notas_encontradas += 1
                        
                        logging.info(f"📄 Nota encontrada na linha {i+1} com competência {competencia_normalizada}")
                        
                        # IMPORTANTE: Verifica se a nota está cancelada ANTES de tentar baixar
                        nota_valida = verificar_nota_valida(linha)
                        
                        if nota_valida:
                            # Nota válida - procede com o download
                            logging.info(f"✅ Nota válida confirmada na linha {i+1}. Iniciando download...")
                            try:
                                # Baixar XML
                                abrir_menu_acao_linha(page, linha)
                                menu = linha.locator('.menu-suspenso-tabela')
                                menu.wait_for(state='visible', timeout=3000)
                                with page.expect_download() as download_info:
                                    link_xml = menu.locator('a:has-text("XML")').first
                                    link_xml.wait_for(state='visible', timeout=2000)
                                    link_xml.click()
                                download = download_info.value
                                salvar_arquivo(download, competencia, empresa, "emitidas", f"{numero_nota}.xml")

                                # Baixar PDF (DANFS-e) - robusto e otimizado
                                for tentativa in range(2):
                                    abrir_menu_acao_linha(page, linha)
                                    menu = linha.locator('.menu-suspenso-tabela')
                                    menu.wait_for(state='visible', timeout=3000)
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
                                        page.wait_for_timeout(200)
                                else:
                                    logging.error(f"Não foi possível baixar o DANFS-e da linha {i+1}: link não ficou visível após 2 tentativas.")
                                
                                notas_validas_baixadas += 1
                                logging.info(f"✅ Download concluído com sucesso para linha {i+1}")
                                
                            except Exception as e:
                                logging.error(f"❌ Erro ao baixar arquivos da linha {i+1}: {e}")
                                # IMPORTANTE: Continua para próxima linha mesmo se houver erro
                                # Tenta fechar menu se estiver aberto
                                try:
                                    page.keyboard.press("Escape")
                                    page.wait_for_timeout(200)
                                except:
                                    pass
                                continue
                        else:
                            # Nota cancelada - ignora e continua
                            notas_canceladas_ignoradas += 1
                            logging.info(f"⚠️  Nota cancelada na linha {i+1}. Ignorando e continuando...")
                            # Continua para próxima linha (NÃO encerra o fluxo)
                            continue
                    
                    # Se a competência for diferente, apenas continua para próxima linha
                    # (a decisão de navegação será feita no final, baseada na última linha)
                    
                except Exception as e:
                    logging.warning(f"⚠️  Erro ao processar linha {i+1}: {e}")
                    # Continua para próxima linha mesmo se houver erro
                    continue
            
            # Log de estatísticas da página
            logging.info(f"📊 Resumo da página: {total_notas_encontradas} nota(s) encontrada(s), "
                        f"{notas_validas_baixadas} baixada(s), {notas_canceladas_ignoradas} cancelada(s) ignorada(s)")
            
            # ====================================================================
            # LÓGICA DE NAVEGAÇÃO ENTRE PÁGINAS
            # ====================================================================
            # REGRA PRINCIPAL: A decisão de navegar para próxima página é baseada
            # APENAS na última linha da página atual, independente de ter encontrado
            # notas válidas ou canceladas na página.
            #
            # - Se a última linha tem a competência alvo → navega para próxima página
            # - Se a última linha não tem a competência alvo → encerra (passou da competência)
            # ====================================================================
            
            if total > 0:
                # SEMPRE verifica a última linha para decidir se continua ou encerra
                # IMPORTANTE: Recria os locators para evitar problemas com elementos "stale"
                logging.info(f"🔍 Verificando última linha (linha {total}) para decidir navegação...")
                
                try:
                    # Recria os locators da tabela para garantir que estão atualizados
                    linhas_atualizadas = page.locator("table tbody tr")
                    ultima_linha = linhas_atualizadas.nth(total - 1)
                    
                    # Aguarda a última linha estar visível
                    ultima_linha.wait_for(state='visible', timeout=5000)
                    
                    celulas_ultima = ultima_linha.locator("td")
                    
                    # Obtém o índice da coluna Competência (recria para garantir que está atualizado)
                    col_index_competencia = _get_col_index(page, "Competência")
                    logging.info(f"   📍 Índice da coluna Competência: {col_index_competencia}")
                    
                    # Lê a competência da última linha
                    competencia_ultima_raw = celulas_ultima.nth(col_index_competencia).inner_text()
                    competencia_ultima = competencia_ultima_raw.strip()
                    
                    logging.info(f"   📋 Competência da última linha (raw): '{competencia_ultima}'")
                    logging.info(f"   🎯 Competência alvo (já normalizada no início): '{competencia_normalizada}'")
                    
                    # Normaliza apenas a competência da última linha (a alvo já está normalizada no início da função)
                    competencia_ultima_normalizada = _normalizar_competencia(competencia_ultima)
                    
                    # Log detalhado (agora em INFO para visibilidade)
                    logging.info(f"   🔄 Competência última linha normalizada: '{competencia_ultima_normalizada}'")
                    logging.info(f"   ⚖️  Comparação: '{competencia_ultima_normalizada}' == '{competencia_normalizada}' ? {competencia_ultima_normalizada == competencia_normalizada}")
                    logging.info(f"   📌 REGRA: Se última linha tem a competência '{competencia_normalizada}' → navega para próxima página")
                    logging.info(f"   📌 REGRA: Se última linha NÃO tem a competência → encerra (passou da competência)")
                    logging.info(f"   ⚠️  IMPORTANTE: Esta decisão é baseada APENAS na última linha, independente de quantas notas da competência foram encontradas na página!")
                    
                    # Se a última linha ainda tem a competência alvo, há mais notas na próxima página
                    # IMPORTANTE: Isso vale mesmo que todas as notas da página atual sejam canceladas
                    # IMPORTANTE: Não importa quantas linhas da competência existem na página, apenas a última linha importa!
                    if competencia_ultima_normalizada == competencia_normalizada:
                        logging.info(f"✅ MATCH! Última linha tem a mesma competência '{competencia_normalizada}'.")
                        logging.info("   ➡️  Navegando para próxima página para continuar buscando...")
                        
                        try:
                            logging.info("   🔍 Chamando função navegar_proxima_pagina()...")
                            navegar_proxima_pagina(page)
                            logging.info("   ⏳ Aguardando tabela carregar após navegação...")
                            # Aguarda a tabela carregar após navegação
                            page.wait_for_selector("table tbody tr", timeout=8000)
                            # Pequeno delay para garantir que a tabela está estável
                            page.wait_for_timeout(500)
                            logging.info("   ✅ Navegação concluída com sucesso! Continuando processamento...")
                            # Continua o loop para processar próxima página
                            continue
                        except Exception as e:
                            # Não há próxima página disponível ou erro ao navegar
                            logging.error(f"❌ ERRO ao navegar para próxima página: {e}")
                            import traceback
                            logging.error(f"   Traceback completo:\n{traceback.format_exc()}")
                            logging.info("   ⚠️  Encerrando busca em Emitidas (não há mais páginas ou erro na navegação).")
                            break
                    else:
                        # A última linha não tem mais a competência alvo
                        # Isso significa que já passou de todas as notas da competência
                        logging.info(f"❌ SEM MATCH! Última linha tem competência '{competencia_ultima_normalizada}'.")
                        logging.info(f"   🛑 Passou da competência alvo '{competencia_normalizada}'. Encerrando busca em Emitidas.")
                        break
                        
                except Exception as e:
                    logging.error(f"❌ Erro ao verificar última linha: {e}")
                    import traceback
                    logging.error(f"   Traceback: {traceback.format_exc()}")
                    logging.warning("   Encerrando por segurança.")
                    break
            else:
                # Não há linhas na tabela - encerra
                logging.info("Nenhuma linha encontrada na tabela. Encerrando.")
                break
                
        except Exception as e:
            logging.error(f"❌ Erro ao processar tabela de emitidas: {e}")
            break
    
    # Log final com estatísticas completas
    logging.info("=" * 80)
    logging.info(f"📊 RESUMO FINAL - Notas Emitidas para competência {competencia}")
    logging.info(f"   Total de notas encontradas: {total_notas_encontradas}")
    logging.info(f"   ✅ Notas válidas baixadas: {notas_validas_baixadas}")
    logging.info(f"   ⚠️  Notas canceladas ignoradas: {notas_canceladas_ignoradas}")
    logging.info("=" * 80)

def _normalizar_competencia(competencia: str) -> str:
    """
    Normaliza a competência para comparação.
    
    Aceita formatos:
    - "MM/AAAA" (ex: "10/2025")
    - "MMAAAA" (ex: "102025")
    - "MM-AAAA" (ex: "10-2025")
    
    Retorna sempre no formato "MM/AAAA"
    """
    if not competencia:
        logging.warning("   ⚠️  Competência vazia recebida na normalização")
        return ""
    
    competencia_original = competencia
    competencia = competencia.strip()
    
    # Se já está no formato "MM/AAAA", retorna como está
    if "/" in competencia:
        logging.debug(f"   🔄 Normalização: '{competencia_original}' -> '{competencia}' (já tem /)")
        return competencia
    
    # Se está no formato "MM-AAAA", converte para "MM/AAAA"
    if "-" in competencia:
        resultado = competencia.replace("-", "/")
        logging.debug(f"   🔄 Normalização: '{competencia_original}' -> '{resultado}' (substituiu -)")
        return resultado
    
    # Se está no formato "MMAAAA" (ex: "102025"), converte para "MM/AAAA"
    if len(competencia) == 6 and competencia.isdigit():
        resultado = f"{competencia[:2]}/{competencia[2:]}"
        logging.debug(f"   🔄 Normalização: '{competencia_original}' -> '{resultado}' (formato MMMAAA)")
        return resultado
    
    # Se não reconheceu o formato, retorna como está
    logging.warning(f"   ⚠️  Formato de competência não reconhecido: '{competencia_original}', retornando como está")
    return competencia

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

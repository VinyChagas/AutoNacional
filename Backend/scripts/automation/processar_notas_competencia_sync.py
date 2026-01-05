"""
Automação síncrona para processar notas fiscais de uma competência específica no portal NFSe Nacional.

Este módulo implementa a varredura completa de notas emitidas e recebidas para uma
competência específica, fazendo download de XML e DANFS-e (PDF) para notas válidas.
Versão síncrona compatível com playwright.sync_api.
"""

import logging
import re
import time
from pathlib import Path
from urllib.parse import urljoin
from playwright.sync_api import Page, Download, TimeoutError as PlaywrightTimeoutError  # type: ignore

# Importa função para configurar caminho base de downloads
try:
    from .download_manager import set_downloads_base_path as set_base_path
except ImportError:
    # Fallback se import relativo falhar
    try:
        from download_manager import set_downloads_base_path as set_base_path
    except ImportError:
        # Se não conseguir importar, cria função stub
        def set_base_path(path: str) -> None:
            logger.warning(f"download_manager não disponível. Caminho não configurado: {path}")

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def set_downloads_base_path(path: str) -> None:
    """
    Define o caminho base para downloads.
    
    Esta função é um wrapper que configura o caminho base no módulo download_manager.
    
    Args:
        path: Caminho base para downloads
    """
    set_base_path(path)


def sanitizar_nome_arquivo(nome: str) -> str:
    """
    Sanitiza o nome do arquivo removendo caracteres inválidos.
    
    Args:
        nome: Nome do arquivo
        
    Returns:
        Nome sanitizado
    """
    # Remove caracteres inválidos para nomes de arquivo
    nome = re.sub(r'[<>:"/\\|?*]', '_', nome)
    # Remove espaços múltiplos
    nome = re.sub(r'\s+', '_', nome)
    return nome.strip()


def sanitizar_nome_pasta(nome: str) -> str:
    """
    Sanitiza o nome para uso como nome de pasta.
    
    Args:
        nome: Nome da empresa ou pasta
        
    Returns:
        Nome sanitizado, sem caracteres problemáticos
    """
    nome = nome.strip()
    # Remove caracteres que não são letras, números, espaços, underscore ou hífen
    nome = re.sub(r"[^\w\s\-]", "", nome)
    # Remove espaços múltiplos e substitui por espaço único
    nome = re.sub(r"\s+", " ", nome)
    return nome


def validar_download(caminho_arquivo: Path, tamanho_minimo: int = 100) -> dict:
    """
    Valida se um download foi bem-sucedido verificando:
    - Se o arquivo existe
    - Se está no caminho correto
    - Se tem tamanho válido (não está vazio)
    - Se a extensão está correta
    
    Args:
        caminho_arquivo: Caminho do arquivo baixado
        tamanho_minimo: Tamanho mínimo esperado em bytes (padrão: 100 bytes)
        
    Returns:
        Dicionário com informações de validação:
        {
            'sucesso': bool,
            'arquivo_existe': bool,
            'caminho_correto': bool,
            'tamanho_valido': bool,
            'extensao_correta': bool,
            'tamanho_bytes': int,
            'mensagem': str,
            'caminho_completo': str
        }
    """
    resultado = {
        'sucesso': False,
        'arquivo_existe': False,
        'caminho_correto': False,
        'tamanho_valido': False,
        'extensao_correta': False,
        'tamanho_bytes': 0,
        'mensagem': '',
        'caminho_completo': str(caminho_arquivo)
    }
    
    try:
        # Verifica se o arquivo existe
        if not caminho_arquivo.exists():
            resultado['mensagem'] = f"❌ Arquivo não existe: {caminho_arquivo}"
            return resultado
        
        resultado['arquivo_existe'] = True
        
        # Verifica se é um arquivo (não uma pasta)
        if not caminho_arquivo.is_file():
            resultado['mensagem'] = f"❌ Caminho não é um arquivo: {caminho_arquivo}"
            return resultado
        
        # Verifica tamanho do arquivo
        tamanho = caminho_arquivo.stat().st_size
        resultado['tamanho_bytes'] = tamanho
        
        if tamanho < tamanho_minimo:
            resultado['mensagem'] = f"⚠️ Arquivo muito pequeno ({tamanho} bytes). Esperado mínimo: {tamanho_minimo} bytes"
            return resultado
        
        resultado['tamanho_valido'] = True
        
        # Verifica extensão
        extensao = caminho_arquivo.suffix.lower()
        extensoes_validas = ['.xml', '.pdf', '.bin']
        if extensao not in extensoes_validas:
            resultado['mensagem'] = f"⚠️ Extensão não reconhecida: {extensao}. Esperado: {extensoes_validas}"
            return resultado
        
        resultado['extensao_correta'] = True
        
        # Verifica se o caminho está correto (contém estrutura esperada)
        caminho_str = str(caminho_arquivo)
        estrutura_esperada = ['Emitidas', 'Recebidas']
        caminho_correto = any(pasta in caminho_str for pasta in estrutura_esperada)
        
        if not caminho_correto:
            resultado['mensagem'] = f"⚠️ Arquivo não está em pasta 'Emitidas' ou 'Recebidas': {caminho_arquivo}"
            return resultado
        
        resultado['caminho_correto'] = True
        
        # Se chegou até aqui, tudo está OK
        resultado['sucesso'] = True
        resultado['mensagem'] = f"✅ Download validado com sucesso: {caminho_arquivo} ({tamanho} bytes)"
        
    except Exception as e:
        resultado['mensagem'] = f"❌ Erro ao validar download: {e}"
        logger.error(f"Erro na validação: {e}")
        import traceback
        logger.debug(traceback.format_exc())
    
    return resultado


def verificar_downloads_competencia(
    base_path: str,
    competencia: str,
    empresa: str,
    tipo_nota: str = None
) -> dict:
    """
    Verifica todos os downloads de uma competência específica.
    
    Args:
        base_path: Caminho base configurado
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        empresa: Nome da empresa
        tipo_nota: "Emitidas", "Recebidas" ou None (verifica ambos)
        
    Returns:
        Dicionário com estatísticas de validação:
        {
            'total_arquivos': int,
            'arquivos_validos': int,
            'arquivos_invalidos': int,
            'total_bytes': int,
            'detalhes': list[dict],  # Lista de validações individuais
            'resumo': str
        }
    """
    base_path_obj = Path(base_path)
    comp_folder = formatar_competencia_para_pasta(competencia)
    empresa_folder = sanitizar_nome_pasta(empresa)
    
    resultado = {
        'total_arquivos': 0,
        'arquivos_validos': 0,
        'arquivos_invalidos': 0,
        'total_bytes': 0,
        'detalhes': [],
        'resumo': ''
    }
    
    tipos_verificar = [tipo_nota] if tipo_nota else ["Emitidas", "Recebidas"]
    
    for tipo in tipos_verificar:
        pasta_tipo = base_path_obj / comp_folder / empresa_folder / tipo
        
        if not pasta_tipo.exists():
            logger.warning(f"⚠️ Pasta não existe: {pasta_tipo}")
            continue
        
        # Lista todos os arquivos na pasta
        arquivos = list(pasta_tipo.glob("*"))
        
        for arquivo in arquivos:
            if arquivo.is_file():
                resultado['total_arquivos'] += 1
                
                # Valida o arquivo
                validacao = validar_download(arquivo)
                resultado['detalhes'].append({
                    'arquivo': str(arquivo),
                    'tipo': tipo,
                    'validacao': validacao
                })
                
                if validacao['sucesso']:
                    resultado['arquivos_validos'] += 1
                    resultado['total_bytes'] += validacao['tamanho_bytes']
                else:
                    resultado['arquivos_invalidos'] += 1
    
    # Gera resumo
    resultado['resumo'] = (
        f"📊 Validação de Downloads - {competencia} / {empresa}\n"
        f"   Total de arquivos: {resultado['total_arquivos']}\n"
        f"   ✅ Válidos: {resultado['arquivos_validos']}\n"
        f"   ❌ Inválidos: {resultado['arquivos_invalidos']}\n"
        f"   📦 Total de bytes: {resultado['total_bytes']:,}"
    )
    
    return resultado


def formatar_competencia_para_pasta(competencia: str) -> str:
    """
    Formata a competência para uso como nome de pasta.
    
    Args:
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        
    Returns:
        Competência formatada para pasta (ex: "10-2025")
    """
    return competencia.replace("/", "-")


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


def encontrar_botao_proxima_pagina(page: Page):
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
            count = botao.count()
            if count > 0:
                logger.debug(f"✅ Botão encontrado usando estratégia: {nome_estrategia}")
                return botao
        except Exception as e:
            logger.debug(f"Estratégia {nome_estrategia} falhou: {e}")
            continue
    
    raise Exception("Botão 'Próxima' não encontrado com nenhuma estratégia")


def clicar_botao_proxima_pagina(page: Page) -> bool:
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
        botao = encontrar_botao_proxima_pagina(page)
        
        # ETAPA 2: Verificar se o botão está habilitado
        try:
            # Tenta pegar o elemento pai (link) para verificar disabled
            parent_link = botao.locator("..")
            is_disabled = parent_link.get_attribute("disabled")
            class_attr = parent_link.get_attribute("class")
            
            # Verifica também o elemento LI pai (pode ter classe disabled)
            try:
                li_parent = parent_link.locator("..")
                li_class = li_parent.get_attribute("class")
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
        botao.wait_for(state='visible', timeout=5000)
        
        # Verifica se está clicável
        is_enabled = botao.is_enabled()
        if not is_enabled:
            logger.info("Botão 'Próxima' não está habilitado")
            return False
        
        # ETAPA 3: Capturar o texto da primeira linha ANTES do clique
        # Isso será usado para verificar se a página realmente mudou
        try:
            linhas_antes = page.locator("table tbody tr")
            primeira_linha_antes = linhas_antes.nth(0)
            texto_primeira_linha_antes = primeira_linha_antes.inner_text()
            texto_primeira_linha_antes = texto_primeira_linha_antes.strip()
            logger.debug(f"Texto da primeira linha ANTES do clique: '{texto_primeira_linha_antes[:50]}...'")
        except Exception as e:
            logger.warning(f"Não foi possível capturar texto da primeira linha antes do clique: {e}")
            texto_primeira_linha_antes = None
        
        # ETAPA 4: Clicar no botão
        logger.info("Clicando no botão 'Próxima'...")
        botao.click()
        
        # ETAPA 5: Aguardar a tabela recarregar
        page.wait_for_load_state("networkidle", timeout=10000)
        page.wait_for_selector("table tbody tr", timeout=8000)
        
        # ETAPA 6: Verificar se a página realmente mudou
        # Se o texto da primeira linha não mudou, significa que estamos na última página
        if texto_primeira_linha_antes is not None:
            try:
                # Aguarda um pouco para garantir que a tabela estável
                page.wait_for_timeout(500)
                
                # Captura o texto da primeira linha DEPOIS do clique
                linhas_depois = page.locator("table tbody tr")
                primeira_linha_depois = linhas_depois.nth(0)
                texto_primeira_linha_depois = primeira_linha_depois.inner_text()
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


def baixar_arquivo_direto_sync(
    page: Page,
    seletor_link: str,
    base_path: str,
    competencia: str,
    empresa: str,
    tipo_nota: str,
    menu_suspenso_contexto=None,  # Novo parâmetro: contexto do menu suspenso da linha específica
) -> Path:
    """
    Baixa um arquivo diretamente via requisição HTTP usando a sessão autenticada do Playwright (versão síncrona).
    
    Esta função é a estratégia RECOMENDADA para downloads, pois:
    - Não depende de eventos do navegador
    - Garante controle total sobre o salvamento
    - Usa a mesma sessão autenticada automaticamente
    - Detecta extensão correta pelo content-type ou conteúdo
    
    Fluxo:
    1. Localiza o link na página usando o seletor CSS
    2. Extrai o atributo href
    3. Monta URL absoluta usando urljoin
    4. Faz requisição HTTP direta com page.request.get()
    5. Detecta extensão pelo content-type ou conteúdo
    6. Extrai chave da nota do href
    7. Cria estrutura de pastas: {base_path}/{competencia}/{empresa}/{tipo_nota}/
    8. Salva arquivo com nome baseado na chave da nota
    
    Args:
        page: Instância do Playwright Page (sessão autenticada)
        seletor_link: Seletor CSS para localizar o link (ex: 'a[href*="/Download/NFSe/"]')
        base_path: Caminho base configurado pelo usuário
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        empresa: Nome da empresa (será sanitizado)
        tipo_nota: "Emitidas" ou "Recebidas"
        
    Returns:
        Path do arquivo salvo
        
    Raises:
        ValueError: Se tipo_nota for inválido, href estiver vazio, ou status não for 200
        Exception: Se houver erro durante a requisição ou salvamento
    """
    logger.info(f"📥 Iniciando download direto via HTTP: tipo={tipo_nota}, competencia={competencia}, empresa={empresa}")
    
    # ETAPA 1: Valida tipo_nota
    tipo_nota = tipo_nota.strip()
    if tipo_nota not in ["Emitidas", "Recebidas"]:
        raise ValueError(f"tipo_nota deve ser 'Emitidas' ou 'Recebidas'. Recebido: {tipo_nota}")
    
    # ETAPA 2: Localiza o link na página
    logger.debug(f"Buscando link com seletor: {seletor_link}")
    
    # IMPORTANTE: Se menu_suspenso_contexto foi fornecido, usa ele (contexto específico da linha)
    # Caso contrário, tenta encontrar o menu visível na página
    if menu_suspenso_contexto is not None:
        # Usa o contexto específico do menu suspenso da linha atual
        logger.debug(f"✅ Usando contexto específico do menu suspenso da linha")
        
        # Remove o prefixo '.menu-suspenso-tabela' se presente no seletor
        # O contexto já é o menu_suspenso, então não precisa do prefixo
        seletor_relativo = seletor_link.replace('.menu-suspenso-tabela', '').strip()
        
        # Remove espaços iniciais e finais
        seletor_relativo = seletor_relativo.strip()
        
        # Se o seletor começa com espaço após remover o prefixo, remove também
        if seletor_relativo.startswith(' '):
            seletor_relativo = seletor_relativo[1:].strip()
        
        logger.debug(f"Seletor original: {seletor_link}")
        logger.debug(f"Seletor relativo (após remover prefixo): {seletor_relativo}")
        
        # Busca o link dentro do contexto específico
        # IMPORTANTE: O contexto já é o menu_suspenso, então busca diretamente dentro dele
        try:
            link_element = menu_suspenso_contexto.locator(seletor_relativo).first
            logger.debug(f"Buscando dentro do contexto específico com seletor: {seletor_relativo}")
            
            if link_element.count() == 0:
                # Tenta buscar sem o seletor relativo, apenas dentro do contexto
                logger.warning(f"⚠️ Link não encontrado com seletor relativo. Tentando busca direta...")
                # Tenta buscar diretamente pelo href dentro do contexto
                if '/Download/NFSe/' in seletor_link or '/Download/DANFSe/' in seletor_link:
                    # Extrai apenas a parte do href
                    if '/Download/NFSe/' in seletor_link:
                        link_element = menu_suspenso_contexto.locator('a[href*="/EmissorNacional/Notas/Download/NFSe/"]').first
                    elif '/Download/DANFSe/' in seletor_link:
                        link_element = menu_suspenso_contexto.locator('a[href*="/EmissorNacional/Notas/Download/DANFSe/"]').first
                    
                    if link_element.count() == 0:
                        raise ValueError(f"Link não encontrado no contexto específico mesmo com busca direta")
                else:
                    raise ValueError(f"Link não encontrado no contexto específico com seletor: {seletor_relativo}")
        except Exception as e:
            logger.error(f"❌ Erro ao buscar link no contexto específico: {e}")
            logger.error(f"   Seletor original: {seletor_link}")
            logger.error(f"   Seletor relativo: {seletor_relativo}")
            raise
    elif seletor_link.startswith('.menu-suspenso-tabela'):
        # Seletor relativo ao menu - usa apenas o menu visível (da linha atual)
        menu_visivel = page.locator('.menu-suspenso-tabela:visible').first
        if menu_visivel.count() == 0:
            raise ValueError(f"Menu suspenso não está visível. Seletor: {seletor_link}")
        
        # Remove o prefixo '.menu-suspenso-tabela' e busca dentro do menu visível
        seletor_relativo = seletor_link.replace('.menu-suspenso-tabela', '').strip()
        if seletor_relativo.startswith(' '):
            seletor_relativo = seletor_relativo[1:]  # Remove espaço inicial
        
        link_element = menu_visivel.locator(seletor_relativo).first
        logger.debug(f"Buscando dentro do menu visível com seletor relativo: {seletor_relativo}")
    else:
        # Seletor global - pode pegar link de qualquer linha (menos ideal)
        link_element = page.locator(seletor_link).first
        logger.warning(f"⚠️ Usando seletor global. Pode pegar link de outra linha!")
    
    if link_element.count() == 0:
        raise ValueError(f"Link não encontrado com seletor: {seletor_link}")
    
    logger.debug(f"✅ Link encontrado: {link_element.count()} ocorrência(s)")
    
    # Verifica se o link está realmente visível
    try:
        if not link_element.is_visible():
            logger.warning(f"⚠️ Link encontrado mas não está visível. Tentando aguardar...")
            link_element.wait_for(state='visible', timeout=2000)
    except:
        logger.warning(f"⚠️ Não foi possível verificar visibilidade do link")
    
    # ETAPA 3: Extrai o href
    href = link_element.get_attribute('href')
    if not href:
        raise ValueError(f"Link encontrado mas href está vazio. Seletor: {seletor_link}")
    
    logger.debug(f"Href extraído: {href}")
    
    # ETAPA 4: Monta URL absoluta
    current_url = page.url
    full_url = urljoin(current_url, href)
    logger.debug(f"URL completa montada: {full_url}")
    
    # ETAPA 5: Extrai chave da nota do href (último segmento após /)
    nome_chave = href.split("/")[-1]
    if not nome_chave:
        raise ValueError(f"Não foi possível extrair chave da nota do href: {href}")
    
    logger.debug(f"Chave da nota extraída: {nome_chave}")
    
    # ETAPA 6: Faz requisição HTTP direta
    logger.info(f"🌐 Fazendo requisição HTTP para: {full_url}")
    response = page.request.get(full_url)
    
    # ETAPA 7: Verifica status da resposta
    status = response.status
    if status != 200:
        raise Exception(f"Erro na requisição HTTP. Status: {status}, URL: {full_url}")
    
    logger.debug(f"✅ Resposta HTTP recebida com status {status}")
    
    # ETAPA 8: Lê headers e conteúdo
    content_type = response.headers.get('content-type', '').lower()
    logger.debug(f"Content-Type recebido: {content_type}")
    
    # Lê o conteúdo binário
    content = response.body()
    logger.debug(f"Conteúdo recebido: {len(content)} bytes")
    
    # ETAPA 9: Detecta extensão correta
    extensao = None
    
    # 9.1: Tenta detectar pelo content-type
    if 'xml' in content_type:
        extensao = '.xml'
        logger.info(f"✅ Extensão detectada pelo content-type (XML): {extensao}")
    elif 'pdf' in content_type:
        extensao = '.pdf'
        logger.info(f"✅ Extensão detectada pelo content-type (PDF): {extensao}")
    
    # 9.2: Se não detectou ou veio genérico, analisa o conteúdo
    if not extensao or content_type == 'application/octet-stream':
        logger.debug("Content-type não específico ou genérico. Analisando conteúdo...")
        
        # Lê primeiros bytes do conteúdo
        primeiros_bytes = content[:10] if len(content) >= 10 else content
        
        if primeiros_bytes.startswith(b'<?xml') or primeiros_bytes.startswith(b'<'):
            extensao = '.xml'
            logger.info(f"✅ Extensão detectada pelo conteúdo (XML): {extensao}")
        elif primeiros_bytes.startswith(b'%PDF'):
            extensao = '.pdf'
            logger.info(f"✅ Extensão detectada pelo conteúdo (PDF): {extensao}")
        else:
            extensao = '.bin'
            logger.warning(f"⚠️ Não foi possível detectar extensão. Usando fallback: {extensao}")
    
    # ETAPA 10: Monta estrutura de pastas
    logger.info(f"🔧 Montando estrutura de pastas:")
    logger.info(f"   base_path: {base_path}")
    logger.info(f"   competencia: {competencia}")
    logger.info(f"   empresa: {empresa}")
    logger.info(f"   tipo_nota: {tipo_nota}")
    
    # Valida se competencia e empresa foram fornecidos
    if not competencia:
        raise ValueError(f"competencia não pode ser None ou vazio. Recebido: {competencia}")
    if not empresa:
        raise ValueError(f"empresa não pode ser None ou vazio. Recebido: {empresa}")
    
    # IMPORTANTE: Converte para Path e resolve para caminho absoluto
    # Isso garante que mesmo se base_path for relativo, será resolvido corretamente
    base_path_obj = Path(base_path).resolve()
    
    logger.info(f"🔍 Caminho base processado:")
    logger.info(f"   Input: {base_path}")
    logger.info(f"   Resolvido (absoluto): {base_path_obj}")
    logger.info(f"   Existe? {base_path_obj.exists()}")
    
    # Verifica se base_path existe, se não existir, cria
    if not base_path_obj.exists():
        logger.warning(f"⚠️ Caminho base não existe: {base_path_obj}. Tentando criar...")
        try:
            base_path_obj.mkdir(parents=True, exist_ok=True)
            logger.info(f"✅ Caminho base criado: {base_path_obj}")
            
            # Verifica novamente após criar
            if base_path_obj.exists():
                logger.info(f"✅ Caminho base confirmado após criação: {base_path_obj}")
            else:
                logger.error(f"❌ Caminho base ainda não existe após tentativa de criação!")
                raise Exception(f"Falha ao criar caminho base: {base_path_obj}")
        except Exception as e:
            logger.error(f"❌ Erro ao criar caminho base: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise
    
    comp_folder = formatar_competencia_para_pasta(competencia)
    empresa_folder = sanitizar_nome_pasta(empresa)
    
    logger.info(f"   comp_folder formatado: {comp_folder}")
    logger.info(f"   empresa_folder sanitizado: {empresa_folder}")
    
    pasta_final = base_path_obj / comp_folder / empresa_folder / tipo_nota
    pasta_final = pasta_final.resolve()  # Garante caminho absoluto
    
    logger.info(f"📁 Caminho completo da pasta:")
    logger.info(f"   Relativo: {base_path_obj / comp_folder / empresa_folder / tipo_nota}")
    logger.info(f"   Absoluto: {pasta_final}")
    logger.info(f"📁 Criando estrutura de pastas...")
    
    try:
        pasta_final.mkdir(parents=True, exist_ok=True)
        logger.info(f"✅ mkdir() executado para: {pasta_final}")
        
        # Verifica se a pasta foi realmente criada
        if pasta_final.exists():
            logger.info(f"✅ Pasta confirmada (existe): {pasta_final}")
            logger.info(f"   É diretório? {pasta_final.is_dir()}")
            logger.info(f"   Permissões: {oct(pasta_final.stat().st_mode)}")
        else:
            logger.error(f"❌ Pasta não foi criada!")
            logger.error(f"   Caminho esperado: {pasta_final}")
            logger.error(f"   Caminho absoluto resolvido: {pasta_final.resolve()}")
            logger.error(f"   Diretório pai existe? {pasta_final.parent.exists()}")
            raise Exception(f"Falha ao criar pasta: {pasta_final}")
    except Exception as e:
        logger.error(f"❌ Erro ao criar estrutura de pastas: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise
    
    # ETAPA 11: Monta nome do arquivo final
    nome_arquivo = f"{nome_chave}{extensao}"
    nome_arquivo = sanitizar_nome_arquivo(nome_arquivo)
    caminho_final = pasta_final / nome_arquivo
    caminho_final = caminho_final.resolve()  # Garante caminho absoluto
    
    logger.info(f"💾 Preparando para salvar arquivo:")
    logger.info(f"   Nome arquivo: {nome_arquivo}")
    logger.info(f"   Caminho relativo: {pasta_final / nome_arquivo}")
    logger.info(f"   Caminho absoluto: {caminho_final}")
    logger.info(f"   Pasta existe? {pasta_final.exists()}")
    logger.info(f"   Tamanho conteúdo: {len(content)} bytes")
    
    # ETAPA 12: Salva o arquivo em disco
    try:
        logger.info(f"💾 Abrindo arquivo para escrita: {caminho_final}")
        with open(caminho_final, "wb") as f:
            bytes_escritos = f.write(content)
            logger.info(f"✅ Escritos {bytes_escritos} bytes no arquivo")
            f.flush()  # Força escrita imediata
            import os
            os.fsync(f.fileno())  # Força sincronização com disco
        
        # IMPORTANTE: Verifica imediatamente após fechar o arquivo
        logger.info(f"🔍 Verificando arquivo após escrita...")
        
        # Força sincronização do sistema de arquivos
        import os
        try:
            os.sync()  # Sincroniza todo o sistema de arquivos (Linux/macOS)
        except:
            pass  # Windows não tem os.sync()
        
        # Aguarda um pouco para garantir que o sistema de arquivos processou
        import time
        time.sleep(0.1)
        
        # Verifica se o arquivo foi salvo corretamente
        caminho_absoluto = caminho_final.resolve()
        
        if caminho_final.exists():
            tamanho = caminho_final.stat().st_size
            logger.info(f"✅ Arquivo salvo com sucesso!")
            logger.info(f"   Caminho relativo: {caminho_final}")
            logger.info(f"   Caminho absoluto: {caminho_absoluto}")
            logger.info(f"   Tamanho no disco: {tamanho} bytes")
            logger.info(f"   Tamanho esperado: {len(content)} bytes")
            logger.info(f"   Pasta existe: {pasta_final.exists()}")
            logger.info(f"   Pasta absoluta: {pasta_final.resolve()}")
            
            # Verifica se o tamanho está correto
            if tamanho != len(content):
                logger.warning(f"⚠️ Tamanho do arquivo não corresponde!")
                logger.warning(f"   Esperado: {len(content)} bytes")
                logger.warning(f"   Encontrado: {tamanho} bytes")
                logger.warning(f"   Diferença: {abs(len(content) - tamanho)} bytes")
            else:
                logger.info(f"✅ Tamanho do arquivo confere: {tamanho} bytes")
            
            # Validação automática após salvar
            validacao = validar_download(caminho_final)
            if not validacao['sucesso']:
                logger.warning(f"⚠️ Validação do download falhou: {validacao['mensagem']}")
                logger.warning(f"   Detalhes da validação:")
                logger.warning(f"   - Arquivo existe: {validacao['arquivo_existe']}")
                logger.warning(f"   - Caminho correto: {validacao['caminho_correto']}")
                logger.warning(f"   - Tamanho válido: {validacao['tamanho_valido']}")
                logger.warning(f"   - Extensão correta: {validacao['extensao_correta']}")
            else:
                logger.info(f"✅ Validação do download passou: {validacao['mensagem']}")
        else:
            logger.error(f"❌ Arquivo não foi criado!")
            logger.error(f"   Caminho esperado (relativo): {caminho_final}")
            logger.error(f"   Caminho esperado (absoluto): {caminho_absoluto}")
            logger.error(f"   Pasta existe? {pasta_final.exists()}")
            if pasta_final.exists():
                logger.error(f"   Pasta absoluta: {pasta_final.resolve()}")
                logger.error(f"   Conteúdo da pasta: {list(pasta_final.iterdir())}")
            else:
                logger.error(f"   Pasta não existe! Tentando criar novamente...")
                try:
                    pasta_final.mkdir(parents=True, exist_ok=True)
                    logger.error(f"   Pasta criada. Tentando salvar novamente...")
                    # Tenta salvar novamente
                    with open(caminho_final, "wb") as f:
                        f.write(content)
                        f.flush()
                        os.fsync(f.fileno())
                    if caminho_final.exists():
                        logger.info(f"✅ Arquivo salvo na segunda tentativa!")
                    else:
                        raise Exception("Falha mesmo na segunda tentativa")
                except Exception as e2:
                    logger.error(f"   Erro na segunda tentativa: {e2}")
            
            raise Exception(f"Arquivo não foi criado: {caminho_final}")
    except Exception as e:
        logger.error(f"❌ Erro ao salvar arquivo: {e}")
        raise
    
    return caminho_final


def detectar_extensao_sync(download: Download, caminho_temp: Path = None) -> str:
    """
    Detecta a extensão correta do arquivo baixado (versão síncrona).
    
    IMPORTANTE: Esta função deve receber o caminho_temp já obtido via download.path()
    para evitar chamar download.path() múltiplas vezes.
    
    Ordem de detecção:
    1. Tenta pela URL do download (rápido)
    2. Analisa o conteúdo real do arquivo (primeiros bytes) - MAIS CONFIÁVEL
    3. Fallback baseado em suggested_filename
    4. Fallback final: '.bin'
    
    Args:
        download: Objeto Download do Playwright
        caminho_temp: Caminho temporário do arquivo (opcional, será obtido se None)
        
    Returns:
        Extensão do arquivo (ex: '.xml', '.pdf', '.bin')
    """
    extensao = None
    
    # ETAPA 1: Tentar detectar pela URL (rápido, mas pode falhar)
    try:
        url = str(download.url) if hasattr(download, 'url') else ''
        
        if 'xml' in url.lower() or 'application/xml' in url.lower():
            extensao = '.xml'
            logger.debug(f"✅ Extensão detectada pela URL: {extensao}")
        elif 'pdf' in url.lower() or 'danfse' in url.lower() or 'application/pdf' in url.lower():
            extensao = '.pdf'
            logger.debug(f"✅ Extensão detectada pela URL: {extensao}")
    except Exception as e:
        logger.debug(f"Erro ao detectar extensão pela URL: {e}")
    
    # ETAPA 2: Analisa o conteúdo real do arquivo (MAIS CONFIÁVEL)
    if not extensao:
        try:
            # Se não recebeu caminho_temp, obtém agora
            if caminho_temp is None:
                caminho_temp = download.path()
            
            logger.debug(f"Lendo arquivo temporário: {caminho_temp}")
            
            # Lê os primeiros bytes do arquivo para identificar o tipo
            with open(caminho_temp, 'rb') as f:
                primeiros_bytes = f.read(10)
            
            logger.debug(f"Primeiros bytes lidos: {primeiros_bytes}")
            
            # Verifica assinatura do arquivo
            if primeiros_bytes.startswith(b'<?xml') or primeiros_bytes.startswith(b'<'):
                extensao = '.xml'
                logger.info(f"✅ Extensão detectada pelo conteúdo (XML): {extensao}")
            elif primeiros_bytes.startswith(b'%PDF'):
                extensao = '.pdf'
                logger.info(f"✅ Extensão detectada pelo conteúdo (PDF): {extensao}")
            else:
                logger.warning(f"⚠️ Assinatura não reconhecida. Primeiros bytes: {primeiros_bytes}")
        except Exception as e:
            logger.warning(f"Erro ao detectar extensão pelo conteúdo: {e}")
            import traceback
            logger.debug(traceback.format_exc())
    
    # ETAPA 3: Fallback baseado em suggested_filename
    if not extensao:
        try:
            suggested = download.suggested_filename.lower() if download.suggested_filename else ''
            if suggested.endswith('.xml'):
                extensao = '.xml'
                logger.debug(f"Extensão detectada pelo suggested_filename: {extensao}")
            elif suggested.endswith('.pdf'):
                extensao = '.pdf'
                logger.debug(f"Extensão detectada pelo suggested_filename: {extensao}")
        except Exception as e:
            logger.debug(f"Erro ao detectar extensão pelo suggested_filename: {e}")
    
    # ETAPA 4: Fallback final
    if not extensao:
        extensao = '.bin'
        logger.warning(f"⚠️ Não foi possível detectar extensão. Usando fallback: {extensao}")
    
    return extensao


def salvar_download_sync(download: Download, destino_dir: Path, nome_arquivo: str = None, extensao: str = None) -> Path:
    """
    Salva um arquivo baixado no diretório de destino (versão síncrona).
    
    Segue o padrão da documentação oficial do Playwright:
    1. Aguarda o download completar (download.path() aguarda automaticamente)
    2. Usa extensão fornecida ou detecta automaticamente
    3. Gera o nome final do arquivo
    4. Cria o diretório se necessário
    5. Salva usando download.save_as() e cópia manual
    
    IMPORTANTE: download.path() retorna caminho temporário com GUID.
    O arquivo temporário é deletado quando o contexto fecha.
    
    REGRA DE NEGÓCIO: 
    - Primeiro download de uma nota = sempre XML
    - Segundo download de uma nota = sempre PDF
    
    Args:
        download: Objeto Download do Playwright
        destino_dir: Diretório de destino
        nome_arquivo: Nome personalizado para o arquivo (opcional, sem extensão)
        extensao: Extensão fornecida ('.xml' ou '.pdf'). Se None, tenta detectar.
        
    Returns:
        Path do arquivo salvo
    """
    logger.info(f"📥 Iniciando salvamento de download. Destino: {destino_dir}")
    
    # ETAPA 1: Aguarda download completar e obtém caminho temporário
    # download.path() aguarda automaticamente a conclusão do download
    caminho_temp = download.path()
    logger.debug(f"📂 Caminho temporário obtido: {caminho_temp}")
    
    # ETAPA 2: Determina extensão
    # Se extensão foi fornecida, usa ela (mais confiável)
    # Caso contrário, tenta detectar pelo conteúdo
    if extensao:
        logger.info(f"📋 Extensão fornecida: {extensao}")
    else:
        extensao = detectar_extensao_sync(download, caminho_temp)
        logger.info(f"📋 Extensão detectada: {extensao}")
    
    # ETAPA 3: Gera nome final do arquivo
    if nome_arquivo:
        # Remove extensão se já tiver e adiciona a correta detectada
        nome_base = Path(nome_arquivo).stem
        nome_final = f"{nome_base}{extensao}"
        logger.debug(f"📝 Nome gerado do prefixo: {nome_final}")
    else:
        suggested_name = download.suggested_filename
        logger.debug(f"📝 Nome sugerido: {suggested_name}")
        
        # Verifica se o nome sugerido é válido
        nome_valido = (
            suggested_name and
            len(suggested_name) <= 200 and
            (suggested_name.endswith(('.xml', '.pdf', '.bin')) or
             any(c.isalnum() for c in suggested_name))
        )
        
        if nome_valido:
            # Usa o nome sugerido, mas garante extensão correta
            nome_base = Path(suggested_name).stem
            nome_final = f"{nome_base}{extensao}"
            logger.debug(f"📝 Usando nome sugerido: {nome_final}")
        else:
            # Gera nome automático
            timestamp = int(time.time())
            nome_final = f"nota_{timestamp}{extensao}"
            logger.debug(f"📝 Nome automático gerado: {nome_final}")
    
    # ETAPA 4: Sanitiza o nome
    nome_final = sanitizar_nome_arquivo(nome_final)
    logger.debug(f"📝 Nome final sanitizado: {nome_final}")
    
    # ETAPA 5: Garante que o diretório existe
    destino_dir.mkdir(parents=True, exist_ok=True)
    logger.debug(f"📁 Diretório garantido: {destino_dir}")
    
    # ETAPA 6: Monta caminho final completo
    destino_arquivo = destino_dir / nome_final
    logger.info(f"💾 Salvando arquivo em: {destino_arquivo}")
    
    # ETAPA 7: Salva usando save_as() conforme documentação do Playwright
    # Conforme documentação: "Copia o arquivo baixado para um caminho especificado pelo usuário.
    # É seguro chamar este método enquanto o download ainda estiver em andamento."
    import shutil
    
    try:
        # Tenta usar save_as() primeiro (padrão da documentação)
        download.save_as(destino_arquivo)
        logger.debug(f"save_as() executado")
    except Exception as e:
        logger.warning(f"save_as() falhou: {e}. Usando cópia manual direta.")
    
    # SEMPRE copia manualmente para garantir que o arquivo está salvo corretamente
    # Isso é necessário porque save_as() pode não funcionar corretamente em alguns casos
    if Path(caminho_temp).exists():
        try:
            # Copia o arquivo da pasta temporária para o destino final
            shutil.copy2(caminho_temp, destino_arquivo)
            logger.debug(f"Arquivo copiado de {caminho_temp} para {destino_arquivo}")
            
            # Verifica se o arquivo foi realmente salvo
            if destino_arquivo.exists():
                tamanho = destino_arquivo.stat().st_size
                logger.info(f"✅ Arquivo salvo com sucesso: {destino_arquivo} ({tamanho} bytes)")
            else:
                raise Exception(f"Arquivo não existe após cópia: {destino_arquivo}")
        except Exception as e:
            logger.error(f"❌ Erro ao copiar arquivo: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            raise
    else:
        # Se o arquivo temporário não existe, verifica se save_as() funcionou
        if destino_arquivo.exists():
            tamanho = destino_arquivo.stat().st_size
            logger.info(f"✅ Arquivo salvo via save_as(): {destino_arquivo} ({tamanho} bytes)")
        else:
            raise Exception(f"Arquivo temporário não existe e save_as() não funcionou. Temp: {caminho_temp}, Destino: {destino_arquivo}")
    
    return destino_arquivo


def verificar_nota_valida(row_locator) -> bool:
    """
    Verifica se uma nota fiscal é válida baseado no ícone na coluna 6.
    
    Args:
        row_locator: Locator da linha da tabela
        
    Returns:
        True se a nota for válida, False caso contrário
    """
    try:
        # Tenta encontrar o ícone na coluna 6 (índice 5, pois começa em 0)
        celulas = row_locator.locator("td")
        coluna_status = celulas.nth(5)  # 6ª coluna (índice 5)
        
        # Procura por imagem na coluna de status
        img_status = coluna_status.locator("img")
        
        if img_status.count() > 0:
            # Verifica atributos que indicam nota válida
            alt_text = img_status.get_attribute("alt")
            src_text = img_status.get_attribute("src")
            
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


def baixar_arquivos_da_linha(page: Page, row_locator, tipo: str, competencia: str = None, nome_empresa: str = None) -> None:
    """
    Baixa XML e DANFS-e (PDF) de uma linha da tabela.
    
    Esta função usa o módulo download_manager para interceptar, identificar
    e salvar os downloads corretamente na estrutura de pastas configurada.
    
    Args:
        page: Página do Playwright
        row_locator: Locator da linha da tabela
        tipo: "emitida" ou "recebida" (para ajustar seletores se necessário)
        competencia: Competência da nota (opcional, para criar estrutura de pastas)
        nome_empresa: Nome da empresa (opcional, para criar estrutura de pastas)
    """
    try:
        # Obtém o caminho base configurado (usa Downloads padrão se não configurado)
        try:
            from .download_manager import get_download_base_path
        except ImportError:
            try:
                from download_manager import get_download_base_path
            except ImportError:
                # Fallback se não conseguir importar
                get_download_base_path = lambda: Path.home() / "Downloads"
        
        base_path = get_download_base_path()
        base_path = base_path.resolve()  # Garante caminho absoluto
        logger.info(f"📂 Caminho base de downloads obtido:")
        logger.info(f"   Caminho relativo: {base_path}")
        logger.info(f"   Caminho absoluto: {base_path.resolve()}")
        logger.info(f"   Existe? {base_path.exists()}")
        logger.info(f"   É diretório? {base_path.is_dir() if base_path.exists() else 'N/A'}")
        
        # Determina a coluna de ações baseado no tipo
        # Emitidas: coluna 7 (índice 6), Recebidas: coluna 6 (índice 5)
        coluna_acoes_idx = 6 if tipo == "emitida" else 5
        
        # Monta diretório de destino usando a estrutura correta
        # Se não tiver nome_empresa, usa "Empresa" como padrão
        empresa_para_pasta = nome_empresa if nome_empresa else "Empresa"
        
        logger.info(f"🔍 Parâmetros recebidos:")
        logger.info(f"   competencia: {competencia}")
        logger.info(f"   nome_empresa: {nome_empresa}")
        logger.info(f"   empresa_para_pasta: {empresa_para_pasta}")
        logger.info(f"   base_path: {base_path}")
        
        # IMPORTANTE: Se competencia não foi fornecida, tenta extrair da linha da tabela
        if not competencia:
            logger.warning("⚠️ Competência não fornecida. Tentando extrair da linha da tabela...")
            try:
                celulas_temp = row_locator.locator("td")
                competencia_texto = celulas_temp.nth(2).inner_text()  # 3ª coluna (índice 2)
                competencia = competencia_texto.strip()
                if competencia:
                    logger.info(f"✅ Competência extraída da tabela: {competencia}")
                else:
                    logger.error("❌ Não foi possível extrair competência da tabela")
                    raise ValueError("competencia é obrigatória e não foi fornecida nem encontrada na tabela")
            except Exception as e:
                logger.error(f"❌ Erro ao extrair competência: {e}")
                raise ValueError(f"competencia é obrigatória. Erro ao extrair: {e}")
        
        # Garante que competencia não é None ou vazio
        if not competencia or competencia.strip() == "":
            raise ValueError("competencia não pode ser None ou vazio")
        
        # Extrai informações da linha para criar nomes de arquivo melhores
        celulas = row_locator.locator("td")
        numero_nota = None
        
        # Tenta extrair número da nota ou data de emissão das células da tabela
        try:
            for idx in [0, 1, 2, 3]:
                try:
                    texto_celula = celulas.nth(idx).inner_text()
                    texto_celula = texto_celula.strip()
                    if texto_celula and any(c.isdigit() for c in texto_celula):
                        numero_nota = texto_celula.replace("/", "-").replace("\\", "-").replace(" ", "_")
                        if len(numero_nota) > 50:
                            numero_nota = numero_nota[:50]
                        break
                except:
                    continue
        except Exception as e:
            logger.warning(f"Não foi possível extrair número da nota das células: {e}")
        
        # Clica no ícone de ações da nota
        coluna_acoes = celulas.nth(coluna_acoes_idx)
        icone_acoes = coluna_acoes.locator("div a i, a i").first
        
        # Abre o menu de ações
        icone_acoes.click()
        logger.info(f"Menu de ações aberto para nota {tipo}")
        
        # Aguarda o popover aparecer - usa seletor do menu suspenso
        menu_suspenso = row_locator.locator('.menu-suspenso-tabela')
        menu_suspenso.wait_for(state='visible', timeout=3000)
        
        # NOVA ESTRATÉGIA: Download direto via HTTP usando page.request.get()
        # Esta abordagem é mais robusta e não depende de eventos do navegador
        
        # Baixa XML (PRIMEIRO download - sempre XML)
        try:
            logger.info(f"Baixando XML da nota {tipo}...")
            
            # Estratégia de seleção em ordem de preferência:
            # 1. Seletor baseado no href (mais específico)
            # 2. Seletor por texto dentro do menu suspenso
            # 3. Seletor por estrutura do popover
            
            # Estratégia de seleção: usa seletor global que funciona em qualquer contexto
            # Tenta múltiplas estratégias até encontrar o link
            seletor_xml = None
            
            # IMPORTANTE: Usa o contexto do menu_suspenso para garantir que pega o link da linha correta
            # Não usa page.locator() global, pois pode pegar link de outra linha
            
            # 1. Tenta seletor baseado no href dentro do menu suspenso (mais específico)
            link_test = menu_suspenso.locator('a[href*="/EmissorNacional/Notas/Download/NFSe/"]').first
            if link_test.count() > 0:
                # Usa seletor relativo ao menu suspenso da linha atual
                seletor_xml = '.menu-suspenso-tabela a[href*="/EmissorNacional/Notas/Download/NFSe/"]'
                logger.debug("✅ Seletor XML encontrado por href dentro do menu")
            else:
                # 2. Fallback: tenta encontrar por texto dentro do menu suspenso
                link_test = menu_suspenso.locator('a:has-text("XML")').first
                if link_test.count() > 0:
                    seletor_xml = '.menu-suspenso-tabela a:has-text("XML")'
                    logger.debug("✅ Seletor XML encontrado por texto")
                else:
                    # 3. Último fallback: estrutura do popover (posição fixa)
                    popover_content = menu_suspenso.locator('div').nth(1)  # div[2] = índice 1
                    link_test = popover_content.locator('a').nth(3)  # a[4] = índice 3
                    if link_test.count() > 0:
                        seletor_xml = '.menu-suspenso-tabela div:nth-child(2) a:nth-child(4)'
                        logger.debug("✅ Seletor XML encontrado por estrutura do popover")
                    else:
                        raise Exception("Link XML não encontrado com nenhuma estratégia")
            
            # IMPORTANTE: Garante que o seletor está dentro do contexto do menu_suspenso
            # Isso evita pegar links de outras linhas
            logger.debug(f"Seletor XML final: {seletor_xml}")
            
            # Usa a nova função de download direto via HTTP
            # Converte base_path para string se for Path
            base_path_str = str(base_path) if isinstance(base_path, Path) else base_path
            
            # Garante que competencia está definida
            if not competencia:
                logger.error("❌ Competência não está definida! Não é possível baixar arquivo.")
                raise ValueError("competencia é obrigatória para baixar arquivos")
            
            logger.info(f"📥 Iniciando download XML com:")
            logger.info(f"   base_path: {base_path_str}")
            logger.info(f"   competencia: {competencia}")
            logger.info(f"   empresa: {empresa_para_pasta}")
            logger.info(f"   tipo_nota: {'Emitidas' if tipo == 'emitida' else 'Recebidas'}")
            
            arquivo_xml = baixar_arquivo_direto_sync(
                page=page,
                seletor_link=seletor_xml,
                base_path=base_path_str,
                competencia=competencia,
                empresa=empresa_para_pasta,
                tipo_nota="Emitidas" if tipo == "emitida" else "Recebidas",
                menu_suspenso_contexto=menu_suspenso  # Passa o contexto específico do menu da linha
            )
            
            # Validação após download
            validacao_xml = validar_download(arquivo_xml)
            if validacao_xml['sucesso']:
                logger.info(f"✅ XML baixado e validado: {arquivo_xml} ({validacao_xml['tamanho_bytes']} bytes)")
            else:
                logger.error(f"❌ XML baixado mas validação falhou: {validacao_xml['mensagem']}")
                logger.error(f"   Arquivo: {arquivo_xml}")
            
        except Exception as e:
            logger.error(f"Erro ao baixar XML: {e}")
            import traceback
            logger.debug(traceback.format_exc())
        
        # Baixa DANFS-e (PDF) - SEGUNDO download (sempre PDF)
        # O menu ainda está aberto, então podemos usar diretamente
        try:
            logger.info(f"Baixando DANFS-e (PDF) da nota {tipo}...")
            
            # Estratégia de seleção em ordem de preferência:
            # 1. Seletor baseado no href (mais específico)
            # 2. Seletor por texto dentro do menu suspenso
            # 3. Seletor por estrutura do popover
            
            # Estratégia de seleção: usa seletor global que funciona em qualquer contexto
            # Tenta múltiplas estratégias até encontrar o link
            seletor_pdf = None
            
            # IMPORTANTE: Usa o contexto do menu_suspenso para garantir que pega o link da linha correta
            # Não usa page.locator() global, pois pode pegar link de outra linha
            
            # 1. Tenta seletor baseado no href dentro do menu suspenso (mais específico)
            link_test = menu_suspenso.locator('a[href*="/EmissorNacional/Notas/Download/DANFSe/"]').first
            if link_test.count() > 0:
                # Usa seletor relativo ao menu suspenso da linha atual
                seletor_pdf = '.menu-suspenso-tabela a[href*="/EmissorNacional/Notas/Download/DANFSe/"]'
                logger.debug("✅ Seletor PDF encontrado por href dentro do menu")
            else:
                # 2. Fallback: tenta encontrar por texto dentro do menu suspenso
                link_test = menu_suspenso.locator('a:has-text("DANFS-e")').first
                if link_test.count() > 0:
                    seletor_pdf = '.menu-suspenso-tabela a:has-text("DANFS-e")'
                    logger.debug("✅ Seletor PDF encontrado por texto")
                else:
                    # 3. Último fallback: estrutura do popover (posição fixa)
                    popover_content = menu_suspenso.locator('div').nth(1)  # div[2] = índice 1
                    link_test = popover_content.locator('a').nth(4)  # a[5] = índice 4
                    if link_test.count() > 0:
                        seletor_pdf = '.menu-suspenso-tabela div:nth-child(2) a:nth-child(5)'
                        logger.debug("✅ Seletor PDF encontrado por estrutura do popover")
                    else:
                        raise Exception("Link PDF não encontrado com nenhuma estratégia")
            
            # IMPORTANTE: Garante que o seletor está dentro do contexto do menu_suspenso
            # Isso evita pegar links de outras linhas
            logger.debug(f"Seletor PDF final: {seletor_pdf}")
            
            # Usa a nova função de download direto via HTTP
            # Converte base_path para string se for Path
            base_path_str = str(base_path) if isinstance(base_path, Path) else base_path
            
            # Garante que competencia está definida
            if not competencia:
                logger.error("❌ Competência não está definida! Não é possível baixar arquivo.")
                raise ValueError("competencia é obrigatória para baixar arquivos")
            
            logger.info(f"📥 Iniciando download PDF com:")
            logger.info(f"   base_path: {base_path_str}")
            logger.info(f"   competencia: {competencia}")
            logger.info(f"   empresa: {empresa_para_pasta}")
            logger.info(f"   tipo_nota: {'Emitidas' if tipo == 'emitida' else 'Recebidas'}")
            
            arquivo_pdf = baixar_arquivo_direto_sync(
                page=page,
                seletor_link=seletor_pdf,
                base_path=base_path_str,
                competencia=competencia,
                empresa=empresa_para_pasta,
                tipo_nota="Emitidas" if tipo == "emitida" else "Recebidas",
                menu_suspenso_contexto=menu_suspenso  # Passa o contexto específico do menu da linha
            )
            
            # Validação após download
            validacao_pdf = validar_download(arquivo_pdf)
            if validacao_pdf['sucesso']:
                logger.info(f"✅ DANFS-e baixado e validado: {arquivo_pdf} ({validacao_pdf['tamanho_bytes']} bytes)")
            else:
                logger.error(f"❌ DANFS-e baixado mas validação falhou: {validacao_pdf['mensagem']}")
                logger.error(f"   Arquivo: {arquivo_pdf}")
            
        except Exception as e:
            logger.error(f"Erro ao baixar DANFS-e: {e}")
            import traceback
            logger.debug(traceback.format_exc())
        
        # IMPORTANTE: Fecha o menu para não interferir com próxima linha
        # Tenta múltiplas estratégias para garantir que fecha
        logger.debug("Fechando menu de ações...")
        try:
            # Estratégia 1: Clica no ícone novamente
            icone_acoes.click()
            page.wait_for_timeout(100)
        except Exception as e1:
            logger.debug(f"Estratégia 1 de fechar menu falhou: {e1}")
        
        try:
            # Estratégia 2: Pressiona Escape
            page.keyboard.press("Escape")
            page.wait_for_timeout(100)
        except Exception as e2:
            logger.debug(f"Estratégia 2 de fechar menu falhou: {e2}")
        
        try:
            # Estratégia 3: Clica fora do menu (canto superior esquerdo)
            page.click("body", position={"x": 10, "y": 10})
            page.wait_for_timeout(100)
        except Exception as e3:
            logger.debug(f"Estratégia 3 de fechar menu falhou: {e3}")
        
        # Verifica se o menu foi fechado
        try:
            menu_ainda_aberto = page.locator('.menu-suspenso-tabela:visible').first
            if menu_ainda_aberto.count() > 0:
                logger.warning(f"⚠️ Menu ainda está aberto após tentativas de fechar. Continuando mesmo assim...")
            else:
                logger.debug(f"✅ Menu fechado com sucesso")
        except:
            pass
        
        # Aguarda um pouco antes de processar próxima linha
        page.wait_for_timeout(300)
        logger.info(f"✅ Processamento da linha concluído. Pronto para próxima linha.")
        
    except Exception as e:
        logger.error(f"Erro ao baixar arquivos da linha: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        
        # IMPORTANTE: Tenta fechar menu mesmo em caso de erro para não bloquear próxima linha
        try:
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
        except:
            pass


def processar_tabela_emitidas(page: Page, competencia_alvo: str, nome_empresa: str = None) -> None:
    """
    Processa a tabela de notas emitidas, varrendo todas as páginas.
    
    IMPORTANTE: Esta função agora IGNORA o filtro de competência e baixa todas as notas
    válidas que aparecem após o filtro de data ser aplicado. A competência é usada apenas
    para organizar os arquivos nas pastas, mas não para filtrar quais notas baixar.
    
    Args:
        page: Página do Playwright
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025") ou "MMAAAA" (ex: "102025")
                         Usada apenas para organização de pastas, não para filtrar notas
        nome_empresa: Nome da empresa (opcional, para estrutura de pastas)
    """
    logger.info(f"Iniciando processamento de Notas Emitidas (ignorando filtro de competência)")
    logger.info(f"   Todas as notas válidas após o filtro de data serão baixadas")
    
    while True:
        try:
            # Aguarda a tabela carregar
            page.wait_for_selector("table tbody tr", timeout=10000)
            
            # Obtém todas as linhas do tbody
            linhas = page.locator("table tbody tr")
            total_linhas = linhas.count()
            
            if total_linhas == 0:
                logger.info("Nenhuma linha encontrada na tabela. Encerrando.")
                break
            
            logger.info(f"Processando {total_linhas} linhas na página atual (Emitidas)")
            
            # Processa cada linha - IGNORA filtro de competência, baixa todas as válidas
            notas_processadas = 0
            notas_baixadas = 0
            
            logger.info(f"🔄 Iniciando loop para processar {total_linhas} linhas...")
            
            for i in range(total_linhas):
                logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                logger.info(f"📋 Processando linha {i+1} de {total_linhas}")
                logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                linha = linhas.nth(i)
                celulas = linha.locator("td")
                
                try:
                    # Extrai a competência da linha apenas para organização de pastas
                    competencia_texto = None
                    competencia_texto_normalizada = None
                    try:
                        competencia_texto = celulas.nth(2).inner_text()
                        competencia_texto = competencia_texto.strip()
                        competencia_texto_normalizada = normalizar_competencia(competencia_texto)
                    except Exception as e:
                        logger.debug(f"Não foi possível extrair competência da linha {i+1}: {e}")
                        # Se não conseguir extrair, usa a competência alvo como fallback
                        competencia_texto_normalizada = normalizar_competencia(competencia_alvo) if competencia_alvo else None
                    
                    logger.info(f"📋 Processando nota na linha {i+1}/{total_linhas} (competência: {competencia_texto_normalizada or 'N/A'})")
                    
                    # Verifica se a nota é válida (não cancelada)
                    nota_valida = verificar_nota_valida(linha)
                    
                    if nota_valida:
                        notas_processadas += 1
                        logger.info(f"✅ Nota válida confirmada na linha {i+1}. Iniciando download...")
                        logger.info(f"📊 Estatísticas: {notas_processadas} nota(s) processada(s), {notas_baixadas} baixada(s)")
                        try:
                            # Usa a competência extraída da linha, ou fallback para competencia_alvo
                            competencia_para_pasta = competencia_texto_normalizada if competencia_texto_normalizada else normalizar_competencia(competencia_alvo)
                            baixar_arquivos_da_linha(page, linha, "emitida", competencia_para_pasta, nome_empresa)
                            notas_baixadas += 1
                            logger.info(f"✅ Download da linha {i+1} concluído com sucesso")
                            logger.info(f"📊 Estatísticas atualizadas: {notas_processadas} processada(s), {notas_baixadas} baixada(s)")
                        except Exception as e_download:
                            logger.error(f"❌ Erro ao baixar arquivos da linha {i+1}: {e_download}")
                            import traceback
                            logger.debug(traceback.format_exc())
                            # IMPORTANTE: Continua para próxima linha mesmo se houver erro
                            # Fecha qualquer menu que possa estar aberto
                            try:
                                # Tenta fechar menu se estiver aberto
                                menu_aberto = page.locator('.menu-suspenso-tabela:visible').first
                                if menu_aberto.count() > 0:
                                    # Clica fora para fechar
                                    page.keyboard.press("Escape")
                                    page.wait_for_timeout(200)
                                    logger.debug("Menu fechado após erro")
                            except:
                                pass
                            logger.info(f"⏭️ Continuando para próxima linha após erro...")
                            continue
                    else:
                        logger.info(f"⚠️ Nota inválida/cancelada na linha {i+1}. Pulando download.")
                    
                    logger.info(f"✅ Linha {i+1} processada. Avançando para próxima...")
                    
                except Exception as e:
                    logger.warning(f"⚠️ Erro ao processar linha {i+1}: {e}")
                    import traceback
                    logger.debug(traceback.format_exc())
                    # Continua para próxima linha
                    logger.info(f"⏭️ Continuando para próxima linha após erro na leitura...")
                    continue
            
            # Log final do processamento da página (Emitidas)
            logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            logger.info(f"📊 Resumo da página (Emitidas): {notas_processadas} nota(s) processada(s), {notas_baixadas} baixada(s)")
            logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            
            # Verifica se precisa continuar na próxima página
            # REGRA MODIFICADA: Continua navegando enquanto houver páginas disponíveis,
            # sem verificar competência (já que o filtro de data já foi aplicado)
            if total_linhas > 0:
                try:
                    # Tenta navegar para próxima página
                    logger.info("Tentando navegar para próxima página...")
                    
                    # Usa a função robusta para encontrar e clicar no botão
                    # Esta função verifica se o botão existe, está habilitado E se a página realmente mudou
                    mudou_pagina = clicar_botao_proxima_pagina(page)
                    
                    if mudou_pagina:
                        # Página mudou com sucesso, continua o loop
                        logger.info("✅ Navegação bem-sucedida. Continuando processamento...")
                        # Aguarda um pouco para garantir que a tabela está estável
                        page.wait_for_timeout(500)
                        continue
                    else:
                        # Não foi possível avançar de página (última página ou botão desabilitado)
                        logger.info("⚠️ Não foi possível avançar de página. Última página alcançada.")
                        logger.info("Encerrando processamento de Emitidas.")
                        break
                        
                except Exception as e:
                    logger.warning(f"Erro ao verificar navegação: {e}")
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
    
    logger.info("Processamento de Notas Emitidas finalizado")


def processar_tabela_recebidas(page: Page, competencia_alvo: str, nome_empresa: str = None) -> None:
    """
    Processa a tabela de notas recebidas, varrendo todas as páginas.
    
    IMPORTANTE: Esta função agora IGNORA o filtro de competência e baixa todas as notas
    válidas que aparecem após o filtro de data ser aplicado. A competência é usada apenas
    para organizar os arquivos nas pastas, mas não para filtrar quais notas baixar.
    
    Args:
        page: Página do Playwright
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025") ou "MMAAAA" (ex: "102025")
                         Usada apenas para organização de pastas, não para filtrar notas
        nome_empresa: Nome da empresa (opcional, para estrutura de pastas)
    """
    logger.info(f"Iniciando processamento de Notas Recebidas (ignorando filtro de competência)")
    logger.info(f"   Todas as notas válidas após o filtro de data serão baixadas")
    
    while True:
        try:
            # Aguarda a tabela carregar
            page.wait_for_selector("table tbody tr", timeout=10000)
            
            # Obtém todas as linhas do tbody
            linhas = page.locator("table tbody tr")
            total_linhas = linhas.count()
            
            if total_linhas == 0:
                logger.info("Nenhuma linha encontrada na tabela. Encerrando.")
                break
            
            logger.info(f"Processando {total_linhas} linhas na página atual (Recebidas)")
            
            # Processa cada linha - IGNORA filtro de competência, baixa todas as válidas
            notas_processadas = 0
            notas_baixadas = 0
            
            logger.info(f"🔄 Iniciando loop para processar {total_linhas} linhas...")
            
            for i in range(total_linhas):
                logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                logger.info(f"📋 Processando linha {i+1} de {total_linhas}")
                logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                linha = linhas.nth(i)
                celulas = linha.locator("td")
                
                try:
                    # Extrai a competência da linha apenas para organização de pastas
                    competencia_texto = None
                    competencia_texto_normalizada = None
                    try:
                        competencia_texto = celulas.nth(2).inner_text()
                        competencia_texto = competencia_texto.strip()
                        competencia_texto_normalizada = normalizar_competencia(competencia_texto)
                    except Exception as e:
                        logger.debug(f"Não foi possível extrair competência da linha {i+1}: {e}")
                        # Se não conseguir extrair, usa a competência alvo como fallback
                        competencia_texto_normalizada = normalizar_competencia(competencia_alvo) if competencia_alvo else None
                    
                    logger.info(f"📋 Processando nota na linha {i+1}/{total_linhas} (competência: {competencia_texto_normalizada or 'N/A'})")
                    
                    # Verifica se a nota é válida (não cancelada)
                    nota_valida = verificar_nota_valida(linha)
                    
                    if nota_valida:
                        notas_processadas += 1
                        logger.info(f"✅ Nota válida confirmada na linha {i+1}. Iniciando download...")
                        logger.info(f"📊 Estatísticas: {notas_processadas} nota(s) processada(s), {notas_baixadas} baixada(s)")
                        try:
                            # Usa a competência extraída da linha, ou fallback para competencia_alvo
                            competencia_para_pasta = competencia_texto_normalizada if competencia_texto_normalizada else normalizar_competencia(competencia_alvo)
                            baixar_arquivos_da_linha(page, linha, "recebida", competencia_para_pasta, nome_empresa)
                            notas_baixadas += 1
                            logger.info(f"✅ Download da linha {i+1} concluído com sucesso")
                            logger.info(f"📊 Estatísticas atualizadas: {notas_processadas} processada(s), {notas_baixadas} baixada(s)")
                        except Exception as e_download:
                            logger.error(f"❌ Erro ao baixar arquivos da linha {i+1}: {e_download}")
                            import traceback
                            logger.debug(traceback.format_exc())
                            # IMPORTANTE: Continua para próxima linha mesmo se houver erro
                            # Fecha qualquer menu que possa estar aberto
                            try:
                                # Tenta fechar menu se estiver aberto
                                menu_aberto = page.locator('.menu-suspenso-tabela:visible').first
                                if menu_aberto.count() > 0:
                                    # Clica fora para fechar
                                    page.keyboard.press("Escape")
                                    page.wait_for_timeout(200)
                                    logger.debug("Menu fechado após erro")
                            except:
                                pass
                            logger.info(f"⏭️ Continuando para próxima linha após erro...")
                            continue
                    else:
                        logger.info(f"⚠️ Nota inválida/cancelada na linha {i+1}. Pulando download.")
                    
                    logger.info(f"✅ Linha {i+1} processada. Avançando para próxima...")
                    
                except Exception as e:
                    logger.warning(f"⚠️ Erro ao processar linha {i+1}: {e}")
                    import traceback
                    logger.debug(traceback.format_exc())
                    # Continua para próxima linha
                    logger.info(f"⏭️ Continuando para próxima linha após erro na leitura...")
                    continue
            
            # Log final do processamento da página (Recebidas)
            logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            logger.info(f"📊 Resumo da página (Recebidas): {notas_processadas} nota(s) processada(s), {notas_baixadas} baixada(s)")
            logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            
            # Verifica se precisa continuar na próxima página
            # REGRA MODIFICADA: Continua navegando enquanto houver páginas disponíveis,
            # sem verificar competência (já que o filtro de data já foi aplicado)
            if total_linhas > 0:
                try:
                    # Tenta navegar para próxima página
                    logger.info("Tentando navegar para próxima página...")
                    
                    # Usa a função robusta para encontrar e clicar no botão
                    # Esta função verifica se o botão existe, está habilitado E se a página realmente mudou
                    mudou_pagina = clicar_botao_proxima_pagina(page)
                    
                    if mudou_pagina:
                        # Página mudou com sucesso, continua o loop
                        logger.info("✅ Navegação bem-sucedida. Continuando processamento...")
                        # Aguarda um pouco para garantir que a tabela está estável
                        page.wait_for_timeout(500)
                        continue
                    else:
                        # Não foi possível avançar de página (última página ou botão desabilitado)
                        logger.info("⚠️ Não foi possível avançar de página. Última página alcançada.")
                        logger.info("Encerrando processamento de Recebidas.")
                        break
                        
                except Exception as e:
                    logger.warning(f"Erro ao verificar navegação: {e}")
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
    
    logger.info("Processamento de Notas Recebidas finalizado")


def gerar_relatorio_downloads(
    base_path: str,
    competencia: str,
    empresa: str,
    tipo_nota: str = None
) -> None:
    """
    Gera um relatório completo de validação de downloads para uma competência.
    
    Esta função pode ser chamada após o processamento para verificar se todos
    os downloads foram bem-sucedidos.
    
    Args:
        base_path: Caminho base configurado
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        empresa: Nome da empresa
        tipo_nota: "Emitidas", "Recebidas" ou None (verifica ambos)
    """
    logger.info("=" * 80)
    logger.info("📊 GERANDO RELATÓRIO DE VALIDAÇÃO DE DOWNLOADS")
    logger.info("=" * 80)
    
    resultado = verificar_downloads_competencia(
        base_path=base_path,
        competencia=competencia,
        empresa=empresa,
        tipo_nota=tipo_nota
    )
    
    # Imprime resumo
    logger.info(resultado['resumo'])
    logger.info("")
    
    # Imprime detalhes de cada arquivo
    if resultado['detalhes']:
        logger.info("📋 DETALHES POR ARQUIVO:")
        logger.info("-" * 80)
        
        for detalhe in resultado['detalhes']:
            arquivo = detalhe['arquivo']
            tipo = detalhe['tipo']
            validacao = detalhe['validacao']
            
            status = "✅ VÁLIDO" if validacao['sucesso'] else "❌ INVÁLIDO"
            logger.info(f"{status} | {tipo} | {arquivo}")
            
            if not validacao['sucesso']:
                logger.info(f"   └─ {validacao['mensagem']}")
                logger.info(f"   └─ Tamanho: {validacao['tamanho_bytes']} bytes")
                logger.info(f"   └─ Existe: {validacao['arquivo_existe']}")
                logger.info(f"   └─ Caminho correto: {validacao['caminho_correto']}")
                logger.info(f"   └─ Tamanho válido: {validacao['tamanho_valido']}")
                logger.info(f"   └─ Extensão correta: {validacao['extensao_correta']}")
    else:
        logger.warning("⚠️ Nenhum arquivo encontrado para validação!")
    
    logger.info("")
    logger.info("=" * 80)
    
    # Retorna estatísticas para possível uso programático
    return resultado


def processar_notas(page: Page, competencia_alvo: str, nome_empresa: str = None) -> None:
    """
    Função principal que processa notas fiscais após aplicar filtro de data.
    
    IMPORTANTE: Esta função IGNORA o filtro de competência e baixa todas as notas válidas
    que aparecem após o filtro de data ser aplicado. A competência é usada apenas para
    organização de pastas, não para filtrar quais notas baixar.
    
    Fluxo:
    1. Acessa "Notas fiscais emitidas"
    2. Varre todas as páginas baixando todas as notas válidas (após filtro de data)
    3. Baixa XML e DANFS-e para todas as notas válidas encontradas
    4. Acessa "Notas fiscais recebidas"
    5. Repete o mesmo processo para recebidas
    
    Args:
        page: Página do Playwright (assume que já está logado no dashboard)
        competencia_alvo: Competência alvo no formato "MM/AAAA" (ex: "10/2025") ou "MMAAAA" (ex: "102025")
                         Usada apenas para organização de pastas, não para filtrar notas
        nome_empresa: Nome da empresa (opcional, para estrutura de pastas)
    """
    # Normaliza a competência recebida como parâmetro (usada apenas para organização)
    competencia_alvo_normalizada = normalizar_competencia(competencia_alvo)
    logger.info(f"🚀 Iniciando processamento de notas (ignorando filtro de competência)")
    logger.info(f"   Competência para organização: {competencia_alvo} (normalizada: {competencia_alvo_normalizada})")
    logger.info(f"   Empresa: {nome_empresa}")
    logger.info(f"   Todas as notas válidas após o filtro de data serão baixadas")
    
    try:
        # 1) Acessar "Notas fiscais emitidas"
        logger.info("Acessando menu 'Notas fiscais emitidas'...")
        
        # Usa seletor robusto baseado no teste.json
        menu_emitidas = page.locator("li:nth-of-type(3) img").first
        
        # Valida que o elemento existe antes de clicar
        menu_emitidas.wait_for(state="visible", timeout=10000)
        menu_emitidas.click()
        
        # Aguarda navegação e carregamento da tabela
        page.wait_for_url("**/Notas/Emitidas", timeout=15000)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_selector("table tbody tr", timeout=10000)
        
        logger.info("✅ Acessou Notas Emitidas com sucesso")
        
        # 2) Processar tabela de Notas Emitidas
        processar_tabela_emitidas(page, competencia_alvo_normalizada, nome_empresa)
        
        # 4) Ir para "Notas fiscais recebidas"
        logger.info("Acessando menu 'Notas fiscais recebidas'...")
        
        # Usa seletor robusto baseado no teste.json
        menu_recebidas = page.locator("li:nth-of-type(4) img").first
        
        # Valida que o elemento existe antes de clicar
        menu_recebidas.wait_for(state="visible", timeout=10000)
        menu_recebidas.click()
        
        # Aguarda navegação e carregamento da tabela
        page.wait_for_url("**/Notas/Recebidas", timeout=15000)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_selector("table tbody tr", timeout=10000)
        
        logger.info("✅ Acessou Notas Recebidas com sucesso")
        
        # 5) Processar tabela de Notas Recebidas
        processar_tabela_recebidas(page, competencia_alvo_normalizada, nome_empresa)
        
        logger.info("🎉 Processamento completo finalizado!")
        
    except Exception as e:
        logger.error(f"❌ Erro durante processamento: {e}")
        raise


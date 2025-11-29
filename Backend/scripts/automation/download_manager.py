"""
Gerenciador de downloads para automação NFSe.

Este módulo fornece funções utilitárias para interceptar, identificar,
nomear e salvar downloads de forma robusta e reutilizável.

Suporta duas estratégias:
1. Download via evento do navegador (page.expect_download)
2. Download direto via HTTP (page.request.get) - RECOMENDADO
"""

import logging
import re
import time
from pathlib import Path
from typing import Optional, Callable, Awaitable
from urllib.parse import urljoin, urlparse
from playwright.async_api import Page, Download, APIResponse

logger = logging.getLogger(__name__)

# Caminho fixo para testes de download (dentro do backend)
# Este caminho será usado quando nenhum caminho específico for configurado
# Calcula o caminho do backend: scripts/automation/download_manager.py -> scripts -> Backend
BACKEND_DIR = Path(__file__).parent.parent.parent.resolve()  # Resolve para caminho absoluto
DOWNLOADS_TESTE_DIR = BACKEND_DIR / "downloads_teste"

logger.debug(f"Caminho do backend calculado: {BACKEND_DIR}")
logger.debug(f"Caminho de downloads de teste: {DOWNLOADS_TESTE_DIR}")

# Variável global para armazenar o caminho base de downloads
# Se não configurado, usa o caminho de teste do backend
_downloads_base_path: Optional[str] = None


def set_downloads_base_path(path: str) -> None:
    """
    Define o caminho base para downloads.
    
    Esta função é opcional. Se não for chamada, o sistema usa automaticamente
    a pasta Downloads padrão do sistema operacional (Path.home() / "Downloads").
    
    Args:
        path: Caminho base para downloads (ex: "C:\\DownloadsAutomacao" ou "/home/usuario/Downloads")
    
    Nota:
        - Windows: C:\\Users\\{usuario}\\Downloads
        - Linux: /home/{usuario}/Downloads
        - macOS: /Users/{usuario}/Downloads
    """
    global _downloads_base_path
    _downloads_base_path = path
    logger.info(f"Caminho base de downloads configurado: {path}")


def get_download_base_path() -> Path:
    """
    Obtém o caminho base para downloads.
    
    Prioridade:
    1. Se foi configurado explicitamente via set_downloads_base_path() → usa o configurado
    2. Se não configurado → usa o caminho fixo de testes: Backend/downloads_teste
    
    Returns:
        Path do diretório base de downloads
        
    Nota:
        - Em desenvolvimento/testes: Backend/downloads_teste (caminho fixo)
        - Em produção: deve ser configurado via set_downloads_base_path()
    """
    if _downloads_base_path:
        return Path(_downloads_base_path)
    
    # Usa o caminho fixo de testes dentro do backend
    # Cria a pasta se não existir
    DOWNLOADS_TESTE_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Caminho base não configurado. Usando caminho fixo de testes: {DOWNLOADS_TESTE_DIR}")
    return DOWNLOADS_TESTE_DIR


def formatar_competencia_para_pasta(competencia: str) -> str:
    """
    Formata a competência para uso como nome de pasta.
    
    Args:
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        
    Returns:
        Competência formatada para pasta (ex: "10-2025")
    """
    return competencia.replace("/", "-")


def sanitizar_nome_arquivo(nome: str) -> str:
    """
    Sanitiza o nome do arquivo removendo caracteres inválidos.
    
    Args:
        nome: Nome do arquivo
        
    Returns:
        Nome sanitizado, sem caracteres problemáticos
    """
    # Remove caracteres inválidos para nomes de arquivo
    nome = re.sub(r'[<>:"/\\|?*]', '_', nome)
    # Remove espaços múltiplos e substitui por underscore
    nome = re.sub(r'\s+', '_', nome)
    # Remove espaços no início e fim
    nome = nome.strip()
    return nome


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


async def detectar_extensao_arquivo(download: Download) -> str:
    """
    Detecta a extensão correta do arquivo baixado.
    
    Ordem de detecção:
    1. Tenta pelo content-type da resposta HTTP
    2. Analisa o conteúdo real do arquivo (primeiros bytes)
    3. Fallback: retorna '.bin'
    
    Args:
        download: Objeto Download do Playwright
        
    Returns:
        Extensão do arquivo (ex: '.xml', '.pdf', '.bin')
    """
    extensao = None
    
    # ETAPA 1: Tentar detectar pelo content-type
    try:
        # Aguarda o download completar para acessar informações
        await download.path()
        
        # Tenta obter informações da resposta HTTP
        # Nota: Playwright não expõe diretamente o content-type, então vamos
        # tentar pela URL primeiro
        url = str(download.url) if hasattr(download, 'url') else ''
        
        if 'xml' in url.lower() or 'application/xml' in url.lower():
            extensao = '.xml'
            logger.debug(f"Extensão detectada pela URL: {extensao}")
        elif 'pdf' in url.lower() or 'danfse' in url.lower() or 'application/pdf' in url.lower():
            extensao = '.pdf'
            logger.debug(f"Extensão detectada pela URL: {extensao}")
    except Exception as e:
        logger.warning(f"Erro ao detectar extensão pela URL: {e}")
    
    # ETAPA 2: Se não detectou, analisa o conteúdo real do arquivo
    if not extensao:
        try:
            # Lê os primeiros bytes do arquivo para identificar o tipo
            caminho_temp = await download.path()
            
            with open(caminho_temp, 'rb') as f:
                primeiros_bytes = f.read(10)
            
            # Verifica assinatura do arquivo
            if primeiros_bytes.startswith(b'<?xml') or primeiros_bytes.startswith(b'<'):
                extensao = '.xml'
                logger.debug(f"Extensão detectada pelo conteúdo (XML): {extensao}")
            elif primeiros_bytes.startswith(b'%PDF'):
                extensao = '.pdf'
                logger.debug(f"Extensão detectada pelo conteúdo (PDF): {extensao}")
        except Exception as e:
            logger.warning(f"Erro ao detectar extensão pelo conteúdo: {e}")
    
    # ETAPA 3: Fallback
    if not extensao:
        extensao = '.bin'
        logger.warning(f"Não foi possível detectar extensão. Usando fallback: {extensao}")
    
    return extensao


async def gerar_nome_arquivo(download: Download, extensao: str, prefixo: Optional[str] = None) -> str:
    """
    Gera o nome final do arquivo.
    
    Regras:
    1. Se suggested_filename for válido → usar (garantindo extensão correta)
    2. Se vier vazio/inválido → gerar: nota_{timestamp}.{ext}
    
    Args:
        download: Objeto Download do Playwright
        extensao: Extensão detectada (ex: '.xml', '.pdf')
        prefixo: Prefixo opcional para o nome (ex: 'nota_123')
        
    Returns:
        Nome do arquivo com extensão correta
    """
    suggested_name = download.suggested_filename
    
    # Verifica se o nome sugerido é válido
    # Considera inválido se: vazio, muito longo, ou não tem extensão conhecida
    nome_valido = (
        suggested_name and
        len(suggested_name) <= 200 and
        (suggested_name.endswith(('.xml', '.pdf', '.bin')) or
         any(c.isalnum() for c in suggested_name))
    )
    
    if nome_valido:
        # Usa o nome sugerido, mas garante extensão correta
        nome_base = Path(suggested_name).stem  # Remove extensão existente
        nome_final = f"{nome_base}{extensao}"
        logger.debug(f"Usando nome sugerido: {nome_final}")
    else:
        # Gera nome automático
        if prefixo:
            nome_final = f"{prefixo}{extensao}"
        else:
            timestamp = int(time.time())
            nome_final = f"nota_{timestamp}{extensao}"
        logger.debug(f"Gerando nome automático: {nome_final}")
    
    # Sanitiza o nome final
    nome_final = sanitizar_nome_arquivo(nome_final)
    
    return nome_final


def montar_caminho_completo(
    base_path: Path,
    competencia: str,
    empresa: str,
    tipo_nota: str
) -> Path:
    """
    Monta o caminho completo seguindo a hierarquia definida.
    
    Estrutura:
    {base_path}/{competencia}/{empresa}/{tipo_nota}/
    
    Onde tipo_nota deve ser "Emitidas" ou "Recebidas".
    
    Args:
        base_path: Caminho base configurado
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        empresa: Nome da empresa (será sanitizado)
        tipo_nota: "Emitidas" ou "Recebidas"
        
    Returns:
        Path do diretório de destino completo
    """
    # Valida tipo_nota
    tipo_nota = tipo_nota.strip()
    if tipo_nota not in ["Emitidas", "Recebidas"]:
        raise ValueError(f"tipo_nota deve ser 'Emitidas' ou 'Recebidas'. Recebido: {tipo_nota}")
    
    # Formata competência
    comp_folder = formatar_competencia_para_pasta(competencia)
    
    # Sanitiza nome da empresa
    empresa_folder = sanitizar_nome_pasta(empresa)
    
    # Monta caminho completo
    caminho_completo = base_path / comp_folder / empresa_folder / tipo_nota
    
    # Cria toda a hierarquia de pastas
    caminho_completo.mkdir(parents=True, exist_ok=True)
    logger.debug(f"Caminho completo montado: {caminho_completo}")
    
    return caminho_completo


async def salvar_download(
    page: Page,
    seletor: str,
    base_path: Path,
    competencia: str,
    empresa: str,
    tipo_nota: str,
    nome_arquivo_prefixo: Optional[str] = None
) -> Path:
    """
    Função utilitária completa para interceptar, identificar e salvar downloads.
    
    Esta função:
    1. Aguarda o download ser iniciado
    2. Detecta o nome real do arquivo
    3. Detecta a extensão correta (.xml ou .pdf)
    4. Cria toda a hierarquia de pastas necessária
    5. Salva o arquivo no caminho final correto
    6. Retorna o caminho final onde o arquivo foi salvo
    
    Args:
        page: Página do Playwright onde o download será executado
        seletor: Seletor CSS/XPath do elemento que dispara o download
        base_path: Caminho base configurado pelo usuário
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        empresa: Nome da empresa (será sanitizado)
        tipo_nota: "Emitidas" ou "Recebidas"
        nome_arquivo_prefixo: Prefixo opcional para o nome do arquivo (ex: "nota_123")
        
    Returns:
        Path do arquivo salvo
        
    Raises:
        ValueError: Se tipo_nota for inválido
        Exception: Se houver erro durante o download ou salvamento
    """
    logger.info(f"Iniciando download: competencia={competencia}, empresa={empresa}, tipo={tipo_nota}")
    
    # ETAPA 1: Intercepta o download
    logger.debug(f"Aguardando download do seletor: {seletor}")
    async with page.expect_download() as download_info:
        # Clica no elemento que dispara o download
        await page.click(seletor)
    
    download = await download_info.value
    logger.debug(f"Download iniciado: {download.suggested_filename}")
    
    # ETAPA 2: Detecta extensão correta
    extensao = await detectar_extensao_arquivo(download)
    logger.debug(f"Extensão detectada: {extensao}")
    
    # ETAPA 3: Gera nome do arquivo
    nome_arquivo = await gerar_nome_arquivo(download, extensao, nome_arquivo_prefixo)
    logger.debug(f"Nome do arquivo gerado: {nome_arquivo}")
    
    # ETAPA 4: Monta caminho completo
    diretorio_destino = montar_caminho_completo(base_path, competencia, empresa, tipo_nota)
    
    # ETAPA 5: Salva o arquivo no caminho final
    caminho_final = diretorio_destino / nome_arquivo
    
    # Aguarda o download completar antes de salvar
    await download.path()
    
    # Salva o arquivo
    await download.save_as(caminho_final)
    
    logger.info(f"✅ Arquivo salvo com sucesso: {caminho_final}")
    
    return caminho_final


async def salvar_download_direto(
    download: Download,
    base_path: Path,
    competencia: str,
    empresa: str,
    tipo_nota: str,
    nome_arquivo_prefixo: Optional[str] = None
) -> Path:
    """
    Versão simplificada que recebe o objeto Download diretamente.
    
    Útil quando o download já foi interceptado manualmente.
    
    Args:
        download: Objeto Download do Playwright já capturado
        base_path: Caminho base configurado pelo usuário
        competencia: Competência no formato "MM/AAAA" (ex: "10/2025")
        empresa: Nome da empresa (será sanitizado)
        tipo_nota: "Emitidas" ou "Recebidas"
        nome_arquivo_prefixo: Prefixo opcional para o nome do arquivo
        
    Returns:
        Path do arquivo salvo
    """
    logger.info(f"Processando download direto: competencia={competencia}, empresa={empresa}, tipo={tipo_nota}")
    
    # Detecta extensão
    extensao = await detectar_extensao_arquivo(download)
    logger.debug(f"Extensão detectada: {extensao}")
    
    # Gera nome do arquivo
    nome_arquivo = await gerar_nome_arquivo(download, extensao, nome_arquivo_prefixo)
    logger.debug(f"Nome do arquivo gerado: {nome_arquivo}")
    
    # Monta caminho completo
    diretorio_destino = montar_caminho_completo(base_path, competencia, empresa, tipo_nota)
    
    # Salva o arquivo
    caminho_final = diretorio_destino / nome_arquivo
    
    # Aguarda o download completar
    await download.path()
    
    # Salva
    await download.save_as(caminho_final)
    
    logger.info(f"✅ Arquivo salvo com sucesso: {caminho_final}")
    
    return caminho_final


async def baixar_arquivo_direto(
    page: Page,
    seletor_link: str,
    base_path: str,
    competencia: str,
    empresa: str,
    tipo_nota: str,
) -> Path:
    """
    Baixa um arquivo diretamente via requisição HTTP usando a sessão autenticada do Playwright.
    
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
        
    Exemplo:
        # Download do XML
        await baixar_arquivo_direto(
            page=page,
            seletor_link='a[href*="/EmissorNacional/Notas/Download/NFSe/"]',
            base_path="/caminho/base",
            competencia="10/2025",
            empresa="Empresa XYZ",
            tipo_nota="Emitidas"
        )
        
        # Download do DANFSe (PDF)
        await baixar_arquivo_direto(
            page=page,
            seletor_link='a[href*="/EmissorNacional/Notas/Download/DANFSe/"]',
            base_path="/caminho/base",
            competencia="10/2025",
            empresa="Empresa XYZ",
            tipo_nota="Emitidas"
        )
    """
    logger.info(f"📥 Iniciando download direto via HTTP: tipo={tipo_nota}, competencia={competencia}, empresa={empresa}")
    
    # ETAPA 1: Valida tipo_nota
    tipo_nota = tipo_nota.strip()
    if tipo_nota not in ["Emitidas", "Recebidas"]:
        raise ValueError(f"tipo_nota deve ser 'Emitidas' ou 'Recebidas'. Recebido: {tipo_nota}")
    
    # ETAPA 2: Localiza o link na página
    logger.debug(f"Buscando link com seletor: {seletor_link}")
    link_element = page.locator(seletor_link).first
    
    if link_element.count() == 0:
        raise ValueError(f"Link não encontrado com seletor: {seletor_link}")
    
    # ETAPA 3: Extrai o href
    href = await link_element.get_attribute('href')
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
    response: APIResponse = await page.request.get(full_url)
    
    # ETAPA 7: Verifica status da resposta
    status = response.status
    if status != 200:
        raise Exception(f"Erro na requisição HTTP. Status: {status}, URL: {full_url}")
    
    logger.debug(f"✅ Resposta HTTP recebida com status {status}")
    
    # ETAPA 8: Lê headers e conteúdo
    content_type = response.headers.get('content-type', '').lower()
    logger.debug(f"Content-Type recebido: {content_type}")
    
    # Lê o conteúdo binário
    content = await response.body()
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
    base_path_obj = Path(base_path)
    comp_folder = formatar_competencia_para_pasta(competencia)
    empresa_folder = sanitizar_nome_pasta(empresa)
    
    pasta_final = base_path_obj / comp_folder / empresa_folder / tipo_nota
    pasta_final.mkdir(parents=True, exist_ok=True)
    logger.debug(f"📁 Estrutura de pastas criada: {pasta_final}")
    
    # ETAPA 11: Monta nome do arquivo final
    nome_arquivo = f"{nome_chave}{extensao}"
    nome_arquivo = sanitizar_nome_arquivo(nome_arquivo)
    caminho_final = pasta_final / nome_arquivo
    
    logger.info(f"💾 Salvando arquivo em: {caminho_final}")
    
    # ETAPA 12: Salva o arquivo em disco
    try:
        with open(caminho_final, "wb") as f:
            f.write(content)
        
        # Verifica se o arquivo foi salvo corretamente
        if caminho_final.exists():
            tamanho = caminho_final.stat().st_size
            logger.info(f"✅ Arquivo salvo com sucesso: {caminho_final} ({tamanho} bytes)")
        else:
            raise Exception(f"Arquivo não foi criado: {caminho_final}")
    except Exception as e:
        logger.error(f"❌ Erro ao salvar arquivo: {e}")
        raise
    
    return caminho_final


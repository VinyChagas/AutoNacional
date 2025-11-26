import os
from pathlib import Path
import logging

def get_downloads_folder():
    """Retorna o caminho da pasta Downloads do usuário."""
    return str(Path.home() / "Downloads")


def montar_caminho_arquivo(competencia, empresa, tipo, nome_arquivo):
    """Monta o caminho completo para salvar o arquivo, seguindo a hierarquia desejada."""
    base = get_downloads_folder()
    competencia_norm = competencia.replace('/', '')
    return os.path.join(base, competencia_norm, empresa, tipo, nome_arquivo)


def salvar_arquivo(download, competencia, empresa, tipo, nome_arquivo):
    """Salva o arquivo baixado no caminho correto, criando as pastas se necessário."""
    caminho = montar_caminho_arquivo(competencia, empresa, tipo, nome_arquivo)
    Path(os.path.dirname(caminho)).mkdir(parents=True, exist_ok=True)
    download.save_as(caminho)
    logging.info(f"Arquivo salvo em {caminho}")

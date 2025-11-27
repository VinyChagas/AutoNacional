"""
Centralização de logs do sistema.

Este módulo fornece um logger configurado globalmente para uso em toda a aplicação.
"""

import logging
import sys
from typing import Optional

# Configuração padrão do logger
_logger: Optional[logging.Logger] = None


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """
    Obtém uma instância do logger configurado.
    
    Args:
        name: Nome do logger (geralmente __name__ do módulo). Se None, usa o logger raiz.
        
    Returns:
        Logger configurado
    """
    global _logger
    
    if _logger is None:
        # Configura o logger raiz
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(sys.stdout)
            ]
        )
        _logger = logging.getLogger()
    
    if name:
        return logging.getLogger(name)
    
    return _logger


def configure_logger(level: int = logging.INFO, format_string: Optional[str] = None):
    """
    Configura o logger global com nível e formato personalizados.
    
    Args:
        level: Nível de log (logging.DEBUG, INFO, WARNING, ERROR, CRITICAL)
        format_string: String de formatação personalizada. Se None, usa formato padrão.
    """
    global _logger
    
    format_str = format_string or '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    
    logging.basicConfig(
        level=level,
        format=format_str,
        handlers=[
            logging.StreamHandler(sys.stdout)
        ],
        force=True  # Força reconfiguração mesmo se já configurado
    )
    
    _logger = logging.getLogger()


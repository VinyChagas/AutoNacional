"""
Service para gerenciamento de certificados digitais.

Este service centraliza toda a lógica relacionada a certificados:
- Validação de certificados
- Extração de informações
- Armazenamento e recuperação de certificados criptografados
"""

import os
from typing import Tuple
from cryptography.fernet import Fernet
from dotenv import load_dotenv, set_key, find_dotenv
from cryptography import x509

from ..infrastructure.config import CERTIFICATES_DIR, FERNET_KEY
from ..infrastructure.logger import get_logger
from ..utils.certificado_utils import (
    validar_pfx,
    extrair_informacoes_certificado
)
from ..models.certificado import CertificadoInfo

logger = get_logger(__name__)


class CertificateService:
    """Service para gerenciamento de certificados digitais."""
    
    def __init__(self):
        """Inicializa o service de certificado."""
        # Inicializa Fernet com a chave de configuração
        if not FERNET_KEY:
            raise ValueError("FERNET_KEY não configurada. Verifique o arquivo .env")
        
        try:
            # FERNET_KEY vem como string do config, precisa converter para bytes
            key_bytes = FERNET_KEY.encode() if isinstance(FERNET_KEY, str) else FERNET_KEY
            self.fernet = Fernet(key_bytes)
        except Exception as e:
            logger.error(f"Erro ao inicializar Fernet: {str(e)}")
            raise ValueError(f"FERNET_KEY inválida: {str(e)}")
    
    def salvar_certificado(self, cnpj: str, conteudo_pfx: bytes, senha: str) -> None:
        """
        Criptografa e salva o certificado e a senha no disco.
        
        Args:
            cnpj: CNPJ da empresa (apenas números, 14 dígitos)
            conteudo_pfx: Conteúdo do arquivo .pfx em bytes
            senha: Senha do certificado
            
        Raises:
            PermissionError: Se não tiver permissão para escrever
            OSError: Se houver erro ao salvar arquivo
            Exception: Se houver erro inesperado
        """
        try:
            # Valida CNPJ
            cnpj_limpo = cnpj.replace(".", "").replace("/", "").replace("-", "").strip()
            if len(cnpj_limpo) != 14:
                raise ValueError(f"CNPJ inválido: {cnpj}")
            
            # Criptografa certificado e senha
            encrypted_pfx = self.fernet.encrypt(conteudo_pfx)
            encrypted_pwd = self.fernet.encrypt(senha.encode())
            
            # Define caminhos dos arquivos
            file_path = CERTIFICATES_DIR / f"{cnpj_limpo}.pfx.enc"
            pwd_path = CERTIFICATES_DIR / f"{cnpj_limpo}.pwd.enc"
            
            logger.info(f"Salvando certificado em: {file_path}")
            logger.info(f"Salvando senha em: {pwd_path}")
            
            # Salva arquivos
            with open(file_path, "wb") as f:
                f.write(encrypted_pfx)
            
            with open(pwd_path, "wb") as f:
                f.write(encrypted_pwd)
            
            logger.info(f"Certificado salvo com sucesso para CNPJ: {cnpj_limpo}")
            
        except PermissionError as e:
            error_msg = f"Sem permissão para escrever em {CERTIFICATES_DIR}: {str(e)}"
            logger.error(error_msg)
            raise PermissionError(error_msg)
        except OSError as e:
            error_msg = f"Erro ao salvar arquivo em {CERTIFICATES_DIR}: {str(e)}"
            logger.error(error_msg)
            raise OSError(error_msg)
        except Exception as e:
            logger.error(f"Erro inesperado ao salvar certificado: {str(e)}", exc_info=True)
            raise Exception(f"Erro ao salvar certificado: {str(e)}")
    
    def carregar_certificado(self, cnpj: str) -> Tuple[bytes, str]:
        """
        Lê e descriptografa o certificado e a senha para uso na automação.
        
        Args:
            cnpj: CNPJ da empresa (apenas números, 14 dígitos)
            
        Returns:
            Tupla (conteudo_pfx, senha) descriptografados
            
        Raises:
            FileNotFoundError: Se o certificado não for encontrado
            ValueError: Se o CNPJ for inválido
            Exception: Se houver erro ao carregar
        """
        if not cnpj:
            raise ValueError("CNPJ não pode ser None ou vazio")
        
        cnpj_limpo = str(cnpj).strip().replace(".", "").replace("/", "").replace("-", "")
        if not cnpj_limpo or len(cnpj_limpo) != 14:
            raise ValueError(f"CNPJ inválido: {cnpj}")
        
        file_path = CERTIFICATES_DIR / f"{cnpj_limpo}.pfx.enc"
        pwd_path = CERTIFICATES_DIR / f"{cnpj_limpo}.pwd.enc"
        
        if not file_path.exists() or not pwd_path.exists():
            raise FileNotFoundError(f"Certificado ou senha não encontrados para CNPJ: {cnpj_limpo}")
        
        try:
            with open(file_path, "rb") as f:
                encrypted_pfx = f.read()
            with open(pwd_path, "rb") as f:
                encrypted_pwd = f.read()
            
            conteudo_pfx = self.fernet.decrypt(encrypted_pfx)
            senha_bytes = self.fernet.decrypt(encrypted_pwd)
            
            if senha_bytes is None:
                raise ValueError(f"Senha descriptografada está None para CNPJ: {cnpj_limpo}")
            
            senha = senha_bytes.decode('utf-8')
            
            if not senha:
                raise ValueError(f"Senha descriptografada está vazia para CNPJ: {cnpj_limpo}")
            
            logger.info(f"Certificado carregado com sucesso para CNPJ: {cnpj_limpo}")
            return conteudo_pfx, senha
            
        except Exception as e:
            logger.error(f"Erro ao carregar certificado para CNPJ {cnpj_limpo}: {str(e)}", exc_info=True)
            raise Exception(f"Erro ao carregar certificado: {str(e)}")
    
    def validar_e_extrair_info(self, conteudo_pfx: bytes, senha: str, debug: bool = False) -> CertificadoInfo:
        """
        Valida o certificado e extrai informações (empresa, CNPJ, data de vencimento).
        
        Args:
            conteudo_pfx: Conteúdo do arquivo .pfx em bytes
            senha: Senha do certificado
            debug: Se True, imprime logs de debug
            
        Returns:
            CertificadoInfo com informações extraídas
            
        Raises:
            HTTPException: Se o certificado ou senha forem inválidos
        """
        # Valida o certificado primeiro
        validar_pfx(conteudo_pfx, senha)
        
        # Extrai informações
        info_dict = extrair_informacoes_certificado(conteudo_pfx, senha, debug)
        
        return CertificadoInfo(**info_dict)
    
    def obter_common_name(self, conteudo_pfx: bytes, senha: str) -> str:
        """
        Obtém o Common Name (CN) do certificado.
        
        Args:
            conteudo_pfx: Conteúdo do arquivo .pfx em bytes
            senha: Senha do certificado
            
        Returns:
            Common Name do certificado ou None se não encontrado
        """
        try:
            key, cert, additional_certs = validar_pfx(conteudo_pfx, senha)
            subject = cert.subject
            
            for attr in subject:
                if attr.oid == x509.NameOID.COMMON_NAME:
                    return attr.value
            
            return None
        except Exception as e:
            logger.warning(f"Não foi possível extrair Common Name: {e}")
            return None


# Instância singleton do service
_certificate_service: CertificateService = None


def get_certificate_service() -> CertificateService:
    """
    Obtém a instância singleton do CertificateService.
    
    Returns:
        Instância do CertificateService
    """
    global _certificate_service
    if _certificate_service is None:
        _certificate_service = CertificateService()
    return _certificate_service


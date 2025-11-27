"""
Modelos relacionados a certificados digitais.
"""

from typing import Optional
from pydantic import BaseModel


class CertificadoInfo(BaseModel):
    """Informações extraídas de um certificado digital."""
    empresa: str
    cnpj: str
    cnpj_limpo: Optional[str] = None
    dataVencimento: Optional[str] = None


class CertificadoUploadResponse(BaseModel):
    """Resposta do upload de certificado."""
    message: str
    cnpj: str
    subject_common_name: Optional[str] = None
    success: bool


class CertificadoImportResponse(BaseModel):
    """Resposta da importação de certificado."""
    success: bool
    empresa: str
    cnpj: str
    dataVencimento: Optional[str] = None
    message: Optional[str] = None


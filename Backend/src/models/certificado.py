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
    contabilidade_id: Optional[int] = None  # Novo campo para vínculo


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


class CertificadoValidacaoLoteItem(BaseModel):
    """Item de resultado da validação em lote."""
    nome_arquivo: str
    sucesso: bool
    cnpj: Optional[str] = None
    empresa: Optional[str] = None
    data_vencimento: Optional[str] = None
    mensagem_erro: Optional[str] = None


class CertificadoValidacaoLoteResponse(BaseModel):
    """Resposta da validação de certificados em lote."""
    total: int
    sucesso: int
    falha: int
    resultados: list[CertificadoValidacaoLoteItem]


class CertificadoImportacaoLoteItem(BaseModel):
    """Item de resultado da importação em lote."""
    nome_arquivo: str
    sucesso: bool
    cnpj: Optional[str] = None
    empresa: Optional[str] = None
    data_vencimento: Optional[str] = None
    mensagem_erro: Optional[str] = None


class CertificadoImportacaoLoteResponse(BaseModel):
    """Resposta da importação de certificados em lote."""
    total: int
    sucesso: int
    falha: int
    resultados: list[CertificadoImportacaoLoteItem]


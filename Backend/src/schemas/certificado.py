"""
Schemas Pydantic para certificados digitais (persistência).

Este módulo define os schemas de entrada e saída para operações
de CRUD de certificados digitais no banco de dados.
"""

from typing import Optional
from datetime import date
from pydantic import BaseModel, Field, validator


class CertificadoBase(BaseModel):
    """Schema base para certificado digital."""
    cnpj: str = Field(..., description="CNPJ da empresa (14 dígitos)")
    empresa: str = Field(..., description="Nome da empresa")
    data_vencimento: date = Field(..., description="Data de vencimento do certificado")
    
    @validator('cnpj')
    def validar_cnpj(cls, v):
        """Valida e limpa o CNPJ."""
        cnpj_limpo = v.replace(".", "").replace("/", "").replace("-", "").strip()
        if len(cnpj_limpo) != 14 or not cnpj_limpo.isdigit():
            raise ValueError("CNPJ deve conter exatamente 14 dígitos")
        return cnpj_limpo


class CertificadoCreate(CertificadoBase):
    """Schema para criação de certificado."""
    pass


class CertificadoUpdate(BaseModel):
    """Schema para atualização de certificado."""
    empresa: Optional[str] = Field(None, description="Nome da empresa")
    data_vencimento: Optional[date] = Field(None, description="Data de vencimento do certificado")


class CertificadoResponse(CertificadoBase):
    """Schema de resposta para certificado."""
    id: int = Field(..., description="ID do certificado")
    
    class Config:
        from_attributes = True  # Permite conversão de ORM para Pydantic


class CertificadoListResponse(BaseModel):
    """Schema de resposta para lista de certificados."""
    certificados: list[CertificadoResponse]
    total: int


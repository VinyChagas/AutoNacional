"""
Schemas Pydantic para empresas.

Este módulo define os schemas de entrada e saída para operações
de CRUD de empresas no banco de dados.
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, validator


class EmpresaBase(BaseModel):
    """Schema base para empresa."""
    cnpj: str = Field(..., description="CNPJ da empresa (14 dígitos)")
    razao_social: str = Field(..., description="Razão social da empresa")
    contabilidade_id: Optional[int] = Field(None, description="ID da contabilidade associada")
    
    @validator('cnpj')
    def validar_cnpj(cls, v):
        """Valida e limpa o CNPJ."""
        cnpj_limpo = v.replace(".", "").replace("/", "").replace("-", "").strip()
        if len(cnpj_limpo) != 14 or not cnpj_limpo.isdigit():
            raise ValueError("CNPJ deve conter exatamente 14 dígitos")
        return cnpj_limpo


class EmpresaCreate(EmpresaBase):
    """Schema para criação de empresa."""
    regime: Optional[str] = Field(None, description="Regime tributário (MEI, SIMPLES, PRESUMIDO, Real)")


class EmpresaUpdate(BaseModel):
    """Schema para atualização de empresa."""
    razao_social: Optional[str] = Field(None, description="Razão social da empresa")
    contabilidade_id: Optional[int] = Field(None, description="ID da contabilidade associada")
    regime: Optional[str] = Field(None, description="Regime tributário")


class EmpresaResponse(BaseModel):
    """Schema de resposta para empresa."""
    id: str = Field(..., description="ID da empresa (como string para compatibilidade com frontend)")
    cnpj: str = Field(..., description="CNPJ da empresa (14 dígitos)")
    razao_social: str = Field(..., description="Razão social da empresa")
    regime: Optional[str] = Field(None, description="Regime tributário")
    contabilidade_id: Optional[int] = Field(None, description="ID da contabilidade associada")
    created_at: datetime = Field(..., description="Data de criação")
    updated_at: datetime = Field(..., description="Data de atualização")
    
    class Config:
        from_attributes = True  # Permite conversão de ORM para Pydantic
        
    @classmethod
    def from_orm_with_id_string(cls, empresa):
        """Converte Empresa ORM para EmpresaResponse com id como string."""
        return cls(
            id=str(empresa.id),
            cnpj=empresa.cnpj,
            razao_social=empresa.razao_social,
            regime=getattr(empresa, 'regime', None),
            contabilidade_id=empresa.contabilidade_id,
            created_at=empresa.created_at,
            updated_at=empresa.updated_at
        )


class LimpezaContabilidadesOrfaosResponse(BaseModel):
    """Schema de resposta para limpeza de contabilidades órfãs."""
    total_empresas_verificadas: int = Field(..., description="Total de empresas verificadas")
    empresas_com_contabilidade: int = Field(..., description="Total de empresas com contabilidade vinculada")
    contabilidades_orfaos_encontradas: int = Field(..., description="Número de contabilidades órfãs encontradas")
    empresas_atualizadas: int = Field(..., description="Número de empresas atualizadas (desvinculadas)")
    empresas_afetadas: List[dict] = Field(default_factory=list, description="Lista de empresas afetadas pela limpeza")


class VerificacaoIntegridadeResponse(BaseModel):
    """Schema de resposta para verificação de integridade de vínculos."""
    total_empresas: int = Field(..., description="Total de empresas no banco")
    empresas_sem_contabilidade: int = Field(..., description="Empresas sem contabilidade vinculada")
    empresas_com_contabilidade: int = Field(..., description="Empresas com contabilidade vinculada")
    contabilidades_validas: int = Field(..., description="Número de contabilidades válidas vinculadas")
    contabilidades_orfaos: int = Field(..., description="Número de contabilidades órfãs encontradas")
    empresas_orfaos: List[dict] = Field(default_factory=list, description="Lista de empresas com contabilidades órfãs")
    status: str = Field(..., description="Status da verificação: 'ok' ou 'encontrados_orfaos'")


class EmpresaListResponse(BaseModel):
    """Schema de resposta para lista de empresas."""
    empresas: list[EmpresaResponse]
    total: int


class LimpezaCompletaResponse(BaseModel):
    """Schema de resposta para limpeza completa de empresas e credenciais."""
    empresas_deletadas: int = Field(..., description="Número de empresas deletadas")
    credenciais_deletadas: int = Field(..., description="Número de credenciais deletadas")
    sucesso: bool = Field(..., description="Indica se a operação foi bem-sucedida")


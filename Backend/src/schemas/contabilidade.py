from typing import Optional
from pydantic import BaseModel, Field, validator

class ContabilidadeBase(BaseModel):
    nome_contabilidade: str = Field(..., description="Nome fantasia ou razão social")
    cnpj: str = Field(..., description="CNPJ da contabilidade")
    email: Optional[str] = Field(None, description="E-mail de contato")
    telefone: Optional[str] = Field(None, description="Telefone ou celular de contato")
    responsavel: Optional[str] = Field(None, description="Responsável (tomador de decisão)")

    @validator('cnpj')
    def validar_cnpj(cls, v):
        cnpj_limpo = v.replace('.', '').replace('/', '').replace('-', '').strip()
        if len(cnpj_limpo) != 14 or not cnpj_limpo.isdigit():
            raise ValueError('CNPJ deve conter exatamente 14 dígitos')
        return cnpj_limpo

class ContabilidadeCreate(ContabilidadeBase):
    pass

class ContabilidadeUpdate(BaseModel):
    nome_contabilidade: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    responsavel: Optional[str] = None

class ContabilidadeResponse(ContabilidadeBase):
    id: int
    data_cadastro: Optional[str] = None
    certificados_vinculados: Optional[int] = 0

    class Config:
        orm_mode = True

class ContabilidadeListResponse(BaseModel):
    contabilidades: list[ContabilidadeResponse]
    total: int




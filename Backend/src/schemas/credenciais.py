"""
Schemas Pydantic para credenciais de login.

Este módulo define os schemas de entrada e saída para operações
de CRUD de credenciais de login no banco de dados.
"""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, validator
from ..db.models import TipoCredencialEnum, StatusCredencialEnum


class CredencialBase(BaseModel):
    """Schema base para credencial."""
    empresa_id: int = Field(..., description="ID da empresa proprietária")
    tipo_login: str = Field(..., description="Tipo: 'cnpj' ou 'cpf' (formato do frontend)")
    usuario: str = Field(..., description="CNPJ ou CPF (sem formatação)")
    senha: str = Field(..., description="Senha (será criptografada antes de salvar)")
    
    @validator('empresa_id', pre=True)
    def converter_empresa_id(cls, v):
        """Converte empresa_id de string para int se necessário."""
        if isinstance(v, str):
            try:
                return int(v)
            except ValueError:
                raise ValueError(f"empresa_id deve ser um número válido, recebido: {v}")
        return v
    
    @validator('usuario')
    def validar_usuario(cls, v, values):
        """Valida o usuário baseado no tipo."""
        usuario_limpo = v.replace(".", "").replace("/", "").replace("-", "").strip()
        
        # Se tipo_login está disponível nos values, valida
        tipo_login = values.get('tipo_login', '').lower()
        if tipo_login:
            if tipo_login in ['cnpj', 'cnpj_senha']:
                if len(usuario_limpo) != 14 or not usuario_limpo.isdigit():
                    raise ValueError("CNPJ deve conter exatamente 14 dígitos")
            elif tipo_login in ['cpf', 'cpf_senha']:
                if len(usuario_limpo) != 11 or not usuario_limpo.isdigit():
                    raise ValueError("CPF deve conter exatamente 11 dígitos")
        
        return usuario_limpo


class CredencialCreate(CredencialBase):
    """Schema para criação de credencial."""
    portal: Optional[str] = Field(default="nfse_nacional", description="Portal de automação")


class CredencialUpdate(BaseModel):
    """Schema para atualização de credencial."""
    senha: Optional[str] = Field(None, description="Nova senha (será criptografada)")


class CredencialResponse(BaseModel):
    """Schema de resposta para credencial (sem senha)."""
    id: int = Field(..., description="ID da credencial")
    empresa_id: int = Field(..., description="ID da empresa proprietária")
    tipo: str = Field(..., description="Tipo: CNPJ_SENHA ou CPF_SENHA")
    usuario: str = Field(..., description="CNPJ ou CPF (sem formatação)")
    status: str = Field(..., description="Status: NAO_TESTADO, OK, INVALIDA, BLOQUEADA")
    ultimo_teste_em: Optional[datetime] = Field(None, description="Data/hora do último teste")
    created_at: datetime = Field(..., description="Data de criação")
    updated_at: datetime = Field(..., description="Data de atualização")
    
    class Config:
        from_attributes = True  # Permite conversão de ORM para Pydantic
        
    @classmethod
    def from_orm_with_tipo(cls, credencial):
        """Converte CredencialLogin para CredencialResponse com tipo convertido."""
        return cls(
            id=credencial.id,
            empresa_id=credencial.empresa_id,
            tipo=credencial.tipo.value if hasattr(credencial.tipo, 'value') else str(credencial.tipo),
            usuario=credencial.usuario,
            status=credencial.status.value if hasattr(credencial.status, 'value') else str(credencial.status),
            ultimo_teste_em=credencial.ultimo_teste_em,
            created_at=credencial.created_at,
            updated_at=credencial.updated_at
        )


class CredencialListResponse(BaseModel):
    """Schema de resposta para lista de credenciais."""
    credenciais: list[CredencialResponse]
    total: int


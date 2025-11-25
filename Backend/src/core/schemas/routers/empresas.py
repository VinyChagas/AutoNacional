from fastapi import APIRouter, Depends
from ..core.security import get_current_user
from ..schemas.empresas import EmpresaCreate, EmpresaOut
from ..repositories.empresas_repo import list_empresas, create_empresa
from typing import List

router = APIRouter(prefix="/empresas", tags=["Empresas"])

@router.get("", response_model=List[EmpresaOut], summary="Listar empresas")
def get_empresas(user=Depends(get_current_user)):
    return list_empresas()

@router.post("", response_model=EmpresaOut, summary="Criar empresa")
def post_empresa(body: EmpresaCreate, user=Depends(get_current_user)):
    return create_empresa(body.cnpj, body.razao_social, body.regime)
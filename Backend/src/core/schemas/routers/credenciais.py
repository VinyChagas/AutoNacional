from fastapi import APIRouter, Depends, status
from ..core.security import require_api_key
from ..schemas.credenciais import CredencialCreate
from ..repositories.credenciais_repo import upsert_credencial

router = APIRouter(prefix="/credenciais", tags=["Credenciais"])

@router.post("", status_code=status.HTTP_201_CREATED, summary="Upsert credencial (API Key)")
def post_credencial(body: CredencialCreate, _=Depends(require_api_key)):
    # Atenção: não retornamos a senha!
    row = upsert_credencial(body.empresa_id, body.portal, body.usuario, body.senha)
    return {"id": row["id"], "empresa_id": row["empresa_id"], "portal": row["portal"], "usuario": row["usuario"], "atualizado_em": row["atualizado_em"]}
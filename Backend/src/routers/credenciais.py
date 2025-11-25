from fastapi import APIRouter
router = APIRouter(prefix="/credenciais", tags=["Credenciais"])

@router.post("")
def upsert_credencial():
    # stub: depois conecta no repo/pgcrypto
    return {"ok": True}
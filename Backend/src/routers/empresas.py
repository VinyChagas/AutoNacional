from fastapi import APIRouter
router = APIRouter(prefix="/empresas", tags=["Empresas"])

@router.get("")
def listar_empresas():
    # só pra subir a API: depois você liga no repositorio
    return [{"id": "demo", "razao_social": "Empresa Demo"}]
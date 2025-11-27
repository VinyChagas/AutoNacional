from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .infrastructure.config import CORS_ORIGINS
from routers import empresas, credenciais, nfse, execucao

app = FastAPI(
    title="AutoNacional API",
    version="1.0.0",
    description="""
API para automação NFSe (empresas, credenciais, jobs).
- **Segurança**: Bearer JWT (Supabase) e API Key (rotas internas).
- **Nunca** expõe senha.
""",
    contact={"name": "Equipe AutoNacional", "email": "devs@autonacional.local"},
)

# CORS para o Angular
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(empresas.router)
app.include_router(credenciais.router)
app.include_router(nfse.router)
app.include_router(execucao.router)

@app.get("/", tags=["Health"])
def health():
    return {"status": "ok"}
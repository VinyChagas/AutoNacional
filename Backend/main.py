"""
Ponto de entrada principal da aplicação FastAPI.

Este arquivo configura e inicializa o servidor FastAPI, registra os routers
e configura middlewares (CORS, tratamento de erros, etc.).
"""

# CRÍTICO: Configura event loop policy ANTES de qualquer import que use asyncio
# Isso é necessário porque o uvicorn com reload cria processos filhos que também precisam
# desta configuração. Deve ser a PRIMEIRA coisa no arquivo.
import sys
import platform

if platform.system() == "Windows":
    try:
        import asyncio
        # Configura ProactorEventLoop para suportar subprocessos no Windows
        # Isso é ESSENCIAL para o Playwright funcionar, mesmo em processos filhos do uvicorn reload
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        print(f"[main.py] ✅ ProactorEventLoop configurado para Windows (Python {sys.version_info.major}.{sys.version_info.minor})")
    except Exception as e:
        print(f"[main.py] ⚠️  Aviso ao configurar ProactorEventLoop: {e}")

# Importa fix adicional (backup)
try:
    import asyncio_windows_fix  # noqa: F401
except ImportError:
    pass

import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError

# IMPORTANTE: Carregar .env ANTES de importar qualquer módulo que use configurações
backend_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(backend_dir, ".env")
load_dotenv(env_path)
load_dotenv()  # Também tenta do diretório atual

# Adiciona src ao path para importar módulos
src_path = os.path.join(backend_dir, "src")
if src_path not in sys.path:
    sys.path.insert(0, src_path)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Importa configurações
from src.infrastructure.config import CORS_ORIGINS
from src.infrastructure.logger import get_logger

logger = get_logger(__name__)

# Inicializa banco de dados SQLite para certificados
try:
    from src.db.session import init_db
    init_db()
    logger.info("✅ Banco de dados de certificados inicializado")
except Exception as e:
    logger.warning(f"⚠️  Erro ao inicializar banco de dados de certificados: {e}")
    logger.warning("   A aplicação continuará, mas funcionalidades de persistência podem não funcionar")

# Cria a aplicação FastAPI
app = FastAPI(
    title="AutoNacional Certificados API",
    version="1.0.0",
    description="""
    API para automação NFSe (empresas, credenciais, execuções).
    - **Segurança**: Certificados digitais ICP-Brasil criptografados
    - **Automação**: Portal NFSe Nacional via Playwright
    """,
)

# Handler global para erros de validação do FastAPI
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Captura erros de validação do FastAPI e retorna mensagens mais claras.
    """
    errors = exc.errors()
    error_details = []
    for error in errors:
        error_details.append({
            "field": ".".join(str(loc) for loc in error.get("loc", [])),
            "message": error.get("msg"),
            "type": error.get("type"),
            "input": error.get("input")
        })
    
    logger.error(f"❌ ERRO DE VALIDAÇÃO:")
    logger.error(f"   URL: {request.url}")
    logger.error(f"   Method: {request.method}")
    logger.error(f"   Erros detalhados: {json.dumps(error_details, indent=2, default=str)}")
    
    # Tenta ler o body se possível (pode já ter sido consumido)
    try:
        if hasattr(request, '_body'):
            body_str = request._body.decode('utf-8') if isinstance(request._body, bytes) else str(request._body)
            logger.error(f"   Body recebido: {body_str[:500]}")  # Limita a 500 chars
    except:
        pass
    
    return JSONResponse(
        status_code=400,
        headers={
            "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
            "Access-Control-Allow-Credentials": "true",
        },
        content={
            "detail": "Erro de validação nos dados enviados",
            "errors": error_details
        }
    )

# Handler global para exceções não tratadas (exceto HTTPException que já é tratada pelo FastAPI)
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Captura todas as exceções não tratadas e retorna uma resposta JSON apropriada.
    HTTPException não é capturada aqui pois já é tratada pelo FastAPI.
    """
    # Não captura HTTPException - deixa o FastAPI tratar
    if isinstance(exc, HTTPException):
        raise exc
    
    import traceback
    error_trace = traceback.format_exc()
    logger.error(f"Erro não tratado: {str(exc)}", exc_info=True)
    logger.error(f"Traceback completo:\n{error_trace}")
    
    return JSONResponse(
        status_code=500,
        headers={
            "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
            "Access-Control-Allow-Credentials": "true",
        },
        content={
            "detail": f"Erro interno do servidor: {str(exc)}",
            "type": type(exc).__name__
        }
    )

# Configuração CORS para permitir requisições do frontend Angular
# Em desenvolvimento, permite qualquer porta do localhost para facilitar
# Para produção, use variável de ambiente CORS_ORIGINS para restringir

# Verifica se está em modo desenvolvimento (padrão) ou produção
is_production = os.getenv("ENVIRONMENT", "").lower() == "production"
cors_origins_env = os.getenv("CORS_ORIGINS", "").strip()

logger.info(f"Environment: {'production' if is_production else 'development'}")
logger.info(f"CORS_ORIGINS env: {cors_origins_env if cors_origins_env else 'não definido'}")

# Em desenvolvimento, sempre permite localhost em qualquer porta usando regex
# Isso resolve quando o Angular usa porta aleatória (ex: 53229, 60197 quando 1234 está ocupada)
# Em produção, só usa regex se CORS_ORIGINS não estiver definido explicitamente
if not is_production:
    # Permite localhost/127.0.0.1 em qualquer porta usando regex
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    logger.info("✅ CORS configurado para permitir localhost em qualquer porta (desenvolvimento)")
    logger.info("   Regex: http://(localhost|127.0.0.1):\\d+")
    logger.info("   Isso permite qualquer porta do localhost, incluindo portas aleatórias do Angular")
elif cors_origins_env:
    # Em produção, usa as origens específicas configuradas via variável de ambiente
    cors_origins = [
        origin.strip() 
        for origin in cors_origins_env.split(",") 
        if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    logger.info(f"✅ CORS configurado para produção com origens: {cors_origins}")
else:
    # Produção sem CORS_ORIGINS definido, usa regex como fallback (não recomendado)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    logger.warning("⚠️  CORS usando regex em produção (não recomendado). Defina CORS_ORIGINS.")

# O middleware CORS do FastAPI já lida automaticamente com requisições OPTIONS (preflight)
# Não precisamos de um handler manual

# Importa e registra routers
# IMPORTANTE: Usar imports absolutos a partir de src para que os imports relativos funcionem
try:
    logger.info("🔄 Tentando importar routers...")
    
    from src.routers.nfse import router as nfse_router
    logger.info("✅ Router NFSe importado")
    
    from src.routers.execucao import router as execucao_router
    logger.info("✅ Router Execução importado")
    logger.info(f"   Prefixo do router execucao: {execucao_router.prefix}")
    logger.info(f"   Rotas do router execucao: {[route.path for route in execucao_router.routes]}")
    
    from src.routers.empresas import router as empresas_router
    logger.info("✅ Router Empresas importado")
    
    from src.routers.credenciais import router as credenciais_router
    logger.info("✅ Router Credenciais importado")
    
    from src.routers.certificado import router as certificado_router
    logger.info("✅ Router Certificado importado")
    
    from src.routers.settings import router as settings_router
    logger.info("✅ Router Settings importado")
    
    from src.routers.contabilidade import router as contabilidade_router
    logger.info("✅ Router Contabilidade importado")
    
    # Registra routers
    logger.info("🔄 Registrando routers na aplicação...")
    app.include_router(nfse_router)
    app.include_router(execucao_router)
    app.include_router(empresas_router)
    app.include_router(credenciais_router)
    app.include_router(certificado_router)
    app.include_router(settings_router)
    app.include_router(contabilidade_router)
    
    # Lista todas as rotas registradas para debug
    logger.info("📋 Rotas registradas na aplicação:")
    for route in app.routes:
        if hasattr(route, 'path') and hasattr(route, 'methods'):
            methods = ', '.join(route.methods) if route.methods else 'N/A'
            logger.info(f"   {methods} {route.path}")
    
    logger.info("✅ Todos os routers foram registrados com sucesso!")
except Exception as e:
    logger.error(f"❌ ERRO ao carregar routers: {e}", exc_info=True)
    import traceback
    logger.error(f"Traceback completo:\n{traceback.format_exc()}")
    logger.warning("   Algumas funcionalidades podem não estar disponíveis")

# Endpoint de health check
@app.get("/", tags=["Health"])
def health():
    """Endpoint de health check."""
    return {"status": "ok", "message": "AutoNacional API está funcionando"}

# Endpoint de debug para listar todas as rotas
@app.get("/debug/routes", tags=["Debug"])
def list_routes():
    """Lista todas as rotas registradas na aplicação (apenas para debug)."""
    routes = []
    for route in app.routes:
        if hasattr(route, 'path') and hasattr(route, 'methods'):
            methods = list(route.methods) if route.methods else []
            routes.append({
                "path": route.path,
                "methods": methods,
                "name": getattr(route, 'name', 'N/A')
            })
    return {"routes": routes, "total": len(routes)}

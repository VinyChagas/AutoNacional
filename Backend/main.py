# backend/main.py
import os
from dotenv import load_dotenv  # pyright: ignore[reportMissingImports]

# IMPORTANTE: Carregar .env ANTES de importar cert_storage
# Isso garante que FERNET_KEY esteja disponível quando cert_storage for importado
backend_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(backend_dir, ".env")
load_dotenv(env_path)
load_dotenv()  # Também tenta do diretório atual

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request  # pyright: ignore[reportMissingImports]
from fastapi.responses import JSONResponse  # pyright: ignore[reportMissingImports]
from fastapi.middleware.cors import CORSMiddleware  # pyright: ignore[reportMissingImports]
from fastapi.exceptions import RequestValidationError  # pyright: ignore[reportMissingImports]
from cryptography.hazmat.primitives.serialization import pkcs12  # pyright: ignore[reportMissingImports]
from cryptography import x509  # pyright: ignore[reportMissingImports]
from cert_storage import salvar_certificado

app = FastAPI(title="AutoNacional Certificados API")

# Handler global para erros de validação do FastAPI
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Captura erros de validação do FastAPI e retorna mensagens mais claras
    """
    errors = exc.errors()
    error_details = []
    for error in errors:
        error_details.append({
            "field": ".".join(str(loc) for loc in error.get("loc", [])),
            "message": error.get("msg"),
            "type": error.get("type")
        })
    
    print(f"VALIDATION ERROR: {error_details}")
    return JSONResponse(
        status_code=400,
        content={
            "detail": "Erro de validação nos dados enviados",
            "errors": error_details
        }
    )

# Configuração CORS para permitir requisições do frontend Angular
# IMPORTANTE: CORS deve ser configurado ANTES dos endpoints
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",  # Angular dev server padrão
        "http://127.0.0.1:4200",
        "http://localhost:1234",  # Angular dev server alternativo
        "http://127.0.0.1:1234",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Endpoint OPTIONS para CORS preflight
@app.options("/api/{path:path}")
async def options_handler(path: str):
    return {"message": "OK"}

# Importa router NFSe (automação Playwright)
try:
    import sys
    import os
    # Adiciona src ao path para importar módulos
    src_path = os.path.join(os.path.dirname(__file__), "src")
    if src_path not in sys.path:
        sys.path.insert(0, src_path)
    from routers.nfse import router as nfse_router
    app.include_router(nfse_router)
    print("✅ Router NFSe carregado com sucesso")
except Exception as e:
    print(f"⚠️  Aviso: Não foi possível carregar router NFSe: {e}")
    print("   A automação NFSe pode não estar disponível")

def validar_pfx(conteudo_pfx: bytes, senha: str):
    """
    Confere se o .pfx e a senha são válidos usando cryptography.
    Se não for, levanta HTTPException 400.
    """
    try:
        # Usa cryptography para carregar PKCS12
        # pkcs12.load_key_and_certificates retorna (key, cert, additional_certs)
        senha_bytes = senha.encode('utf-8') if senha else None
        
        try:
            key, cert, additional_certs = pkcs12.load_key_and_certificates(
                conteudo_pfx, 
                senha_bytes
            )
        except ValueError as e:
            error_msg = str(e).lower()
            if "mac" in error_msg or "password" in error_msg or "bad decrypt" in error_msg:
                raise HTTPException(
                    status_code=400,
                    detail="Senha do certificado incorreta"
                )
            raise HTTPException(
                status_code=400,
                detail=f"Erro ao carregar certificado PKCS12: {str(e)}"
            )
        
        if cert is None:
            raise HTTPException(
                status_code=400,
                detail="Certificado não encontrado no arquivo PKCS12"
            )
        
        # Extrai informações do subject do certificado
        subject = cert.subject
        return subject
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"ERROR validar_pfx: {error_msg}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=400,
            detail=f"Certificado inválido ou senha incorreta: {error_msg}"
        )

@app.post("/api/certificados")
async def upload_certificado(
    cnpj: str = Form(...),
    senha: str = Form(...),
    certificado: UploadFile = File(...)
):
    """
    Endpoint para upload de certificado digital (.pfx ou .p12)
    """
    try:
        # Log para debug - primeiro log para garantir que chegou aqui
        print("=" * 50)
        print("DEBUG: Endpoint /api/certificados chamado")
        print(f"DEBUG: CNPJ recebido: {cnpj} (tipo: {type(cnpj)})")
        print(f"DEBUG: Senha recebida: {'***' if senha else 'VAZIA'} (tipo: {type(senha)})")
        print(f"DEBUG: Filename: {certificado.filename if certificado else 'None'}")
        print(f"DEBUG: Content-Type: {certificado.content_type if certificado else 'None'}")
        print("=" * 50)
        
        # Validação básica do arquivo (mais flexível)
        if not certificado.filename:
            raise HTTPException(
                status_code=400,
                detail="Nome do arquivo não fornecido"
            )
        
        filename_lower = certificado.filename.lower()
        if not (filename_lower.endswith('.pfx') or filename_lower.endswith('.p12')):
            raise HTTPException(
                status_code=400,
                detail=f"Arquivo deve ser um certificado .pfx ou .p12. Recebido: {certificado.filename}"
            )
        
        # Validação básica do CNPJ (mais flexível)
        cnpj_limpo = cnpj.strip().replace('.', '').replace('/', '').replace('-', '').replace(' ', '')
        if not cnpj_limpo:
            raise HTTPException(
                status_code=400,
                detail="CNPJ não pode estar vazio"
            )
        
        if len(cnpj_limpo) != 14:
            raise HTTPException(
                status_code=400,
                detail=f"CNPJ inválido. Deve conter 14 dígitos. Recebido: {len(cnpj_limpo)} dígitos ({cnpj_limpo})"
            )
        
        # Validação da senha
        if not senha or not senha.strip():
            raise HTTPException(
                status_code=400,
                detail="Senha não pode estar vazia"
            )
        
        conteudo = await certificado.read()
        
        if not conteudo:
            raise HTTPException(
                status_code=400,
                detail="Arquivo vazio ou não foi possível ler o conteúdo"
            )
        
        print(f"DEBUG: Arquivo lido com sucesso. Tamanho: {len(conteudo)} bytes")

        # valida o PFX
        subject = validar_pfx(conteudo, senha)

        # salva criptografado
        try:
            salvar_certificado(cnpj_limpo, conteudo, senha)
        except PermissionError as e:
            import traceback
            print(f"ERROR PermissionError: {str(e)}")
            print(traceback.format_exc())
            raise HTTPException(
                status_code=500,
                detail=f"Sem permissão para salvar certificado: {str(e)}"
            )
        except OSError as e:
            import traceback
            print(f"ERROR OSError: {str(e)}")
            print(traceback.format_exc())
            raise HTTPException(
                status_code=500,
                detail=f"Erro ao salvar certificado no disco: {str(e)}"
            )
        except Exception as e:
            import traceback
            print(f"ERROR ao salvar certificado: {str(e)}")
            print(traceback.format_exc())
            raise HTTPException(
                status_code=500,
                detail=f"Erro ao salvar certificado: {str(e)}"
            )

        # Extrai o CN (Common Name) do subject
        common_name = None
        try:
            # Tenta obter o Common Name do certificado
            for attr in subject:
                # Verifica se é o OID do Common Name (2.5.4.3)
                if attr.oid == x509.NameOID.COMMON_NAME:
                    common_name = attr.value
                    break
        except Exception as e:
            print(f"AVISO: Não foi possível extrair Common Name: {e}")
        
        resposta = {
            "message": "Certificado salvo com sucesso",
            "cnpj": cnpj_limpo,
            "subject_common_name": common_name,
            "success": True
        }
        
        print(f"✅ Retornando resposta de sucesso: {resposta}")
        return resposta
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"ERROR: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao processar certificado: {str(e)}"
        )
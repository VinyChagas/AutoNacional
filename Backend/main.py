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
import re
from datetime import datetime

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
    Retorna (key, cert, additional_certs) se válido.
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
        
        return key, cert, additional_certs
        
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


def extrair_cnpj_do_texto(texto: str):
    """
    Extrai CNPJ de um texto, tentando vários formatos.
    Retorna CNPJ apenas com números (14 dígitos) ou None.
    """
    if not texto:
        return None
    
    # Remove espaços e converte para maiúsculo
    texto_original = texto
    texto = texto.strip().upper()
    
    # Tenta encontrar padrão CNPJ em vários formatos
    # Ordem de prioridade: formatos mais específicos primeiro
    padroes = [
        # CNPJ: 00.000.000/0000-00 ou CNPJ 00.000.000/0000-00
        r'CNPJ[:\s\-]*(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})',
        # 00.000.000/0000-00 (formato completo com pontuação)
        r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})',
        # 00000000000000 (14 dígitos consecutivos - mais específico)
        r'\b(\d{14})\b',
        # 00.000.000/0000-00 (formato flexível)
        r'(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})',
        # Qualquer sequência de 14 dígitos (último recurso)
        r'(\d{14})',
    ]
    
    for padrao in padroes:
        match = re.search(padrao, texto)
        if match:
            cnpj = match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)
            # Remove formatação
            cnpj_limpo = re.sub(r'[^\d]', '', cnpj)
            # Valida que tem exatamente 14 dígitos
            if len(cnpj_limpo) == 14:
                # Validação básica: não pode ser tudo zeros
                # (permite CNPJs com dígitos repetidos, mas não tudo zeros)
                if cnpj_limpo != '0' * 14:
                    return cnpj_limpo
    
    return None


def extrair_informacoes_certificado(conteudo_pfx: bytes, senha: str, debug: bool = True) -> dict:
    """
    Extrai informações do certificado digital ICP-Brasil.
    Retorna dict com: empresa (nome), cnpj, dataVencimento.
    
    Args:
        conteudo_pfx: Conteúdo do arquivo .pfx em bytes
        senha: Senha do certificado
        debug: Se True, imprime logs de debug (padrão: True)
    """
    try:
        # Carrega o certificado
        key, cert, additional_certs = validar_pfx(conteudo_pfx, senha)
        
        # Extrai informações do subject
        subject = cert.subject
        nome_empresa = None
        cnpj = None
        
        # Debug: imprime todos os atributos do subject para análise
        if debug:
            print("=" * 60)
            print("DEBUG: Analisando atributos do certificado:")
            for attr in subject:
                print(f"  OID: {attr.oid}, Nome: {attr.oid._name}, Valor: {attr.value}")
            print("=" * 60)
        
        # Prioridade 1: Tenta extrair CNPJ do Common Name (CN)
        # Em certificados ICP-Brasil, o CNPJ geralmente vem após ":" no formato: "NOME DA EMPRESA:CNPJ"
        for attr in subject:
            if attr.oid == x509.NameOID.COMMON_NAME:
                nome_empresa_completo = attr.value
                if debug:
                    print(f"DEBUG: Common Name encontrado: {nome_empresa_completo}")
                
                # Verifica se tem ":" no Common Name (formato comum: "NOME:CNPJ")
                if ':' in nome_empresa_completo:
                    partes = nome_empresa_completo.split(':', 1)
                    nome_empresa = partes[0].strip()
                    parte_cnpj = partes[1].strip() if len(partes) > 1 else ''
                    
                    if debug:
                        print(f"DEBUG: Common Name dividido - Nome: '{nome_empresa}', Parte CNPJ: '{parte_cnpj}'")
                    
                    # Tenta extrair CNPJ da parte após ":"
                    cnpj_extraido = extrair_cnpj_do_texto(parte_cnpj)
                    if cnpj_extraido:
                        cnpj = cnpj_extraido
                        nome_empresa = nome_empresa  # Usa apenas a parte antes do ":"
                        if debug:
                            print(f"DEBUG: CNPJ extraído do Common Name (após ':'): {cnpj}")
                    else:
                        # Se não encontrou após ":", tenta no Common Name inteiro
                        nome_empresa = nome_empresa_completo
                        cnpj_extraido = extrair_cnpj_do_texto(nome_empresa_completo)
                        if cnpj_extraido:
                            cnpj = cnpj_extraido
                            if debug:
                                print(f"DEBUG: CNPJ extraído do Common Name completo: {cnpj}")
                else:
                    # Se não tem ":", usa o Common Name completo como nome
                    nome_empresa = nome_empresa_completo
                    # Tenta extrair CNPJ do CN também
                    if not cnpj:
                        cnpj = extrair_cnpj_do_texto(attr.value)
                        if cnpj and debug:
                            print(f"DEBUG: CNPJ extraído do CN: {cnpj}")
        
        # Prioridade 2: Tenta extrair CNPJ do Organizational Unit (OU) - pode ser CNPJ da empresa emissora
        # Só usa se não encontrou no Common Name
        if not cnpj:
            for attr in subject:
                if attr.oid == x509.NameOID.ORGANIZATIONAL_UNIT_NAME:
                    valor_ou = attr.value
                    if debug:
                        print(f"DEBUG: OU encontrado: {valor_ou}")
                    cnpj_extraido = extrair_cnpj_do_texto(valor_ou)
                    if cnpj_extraido:
                        cnpj = cnpj_extraido
                        if debug:
                            print(f"DEBUG: CNPJ extraído do OU: {cnpj}")
                        break
        
        # Prioridade 3: Verifica OID específico do ICP-Brasil para CNPJ (2.16.76.1.3.3)
        # Alguns certificados ICP-Brasil usam este OID customizado
        if not cnpj:
            try:
                # OID do CNPJ no ICP-Brasil: 2.16.76.1.3.3
                cnpj_oid = x509.ObjectIdentifier("2.16.76.1.3.3")
                for attr in subject:
                    if attr.oid == cnpj_oid:
                        cnpj = extrair_cnpj_do_texto(attr.value)
                        if cnpj:
                            if debug:
                                print(f"DEBUG: CNPJ extraído do OID ICP-Brasil (2.16.76.1.3.3): {cnpj}")
                            break
            except Exception as e:
                if debug:
                    print(f"DEBUG: Erro ao verificar OID ICP-Brasil: {e}")
        
        # Prioridade 4: Verifica todos os outros atributos do subject
        # Alguns certificados podem ter CNPJ em outros campos
        if not cnpj:
            for attr in subject:
                # Pula CN e OU que já foram verificados
                if attr.oid in [x509.NameOID.COMMON_NAME, x509.NameOID.ORGANIZATIONAL_UNIT_NAME]:
                    continue
                valor_attr = attr.value
                cnpj_extraido = extrair_cnpj_do_texto(valor_attr)
                if cnpj_extraido:
                    cnpj = cnpj_extraido
                    if debug:
                        print(f"DEBUG: CNPJ extraído do atributo {attr.oid._name}: {cnpj}")
                    break
        
        # Prioridade 5: Verifica o Issuer também (alguns certificados têm CNPJ no issuer)
        if not cnpj:
            issuer = cert.issuer
            if debug:
                print("DEBUG: Verificando atributos do Issuer:")
            for attr in issuer:
                if debug:
                    print(f"  Issuer OID: {attr.oid}, Valor: {attr.value}")
                if attr.oid == x509.NameOID.ORGANIZATIONAL_UNIT_NAME:
                    cnpj_extraido = extrair_cnpj_do_texto(attr.value)
                    if cnpj_extraido:
                        cnpj = cnpj_extraido
                        if debug:
                            print(f"DEBUG: CNPJ extraído do Issuer OU: {cnpj}")
                        break
        
        # Prioridade 6: Tenta extrair CNPJ do Serial Number se ainda não encontrou
        if not cnpj:
            serial_number = cert.serial_number
            if debug:
                print(f"DEBUG: Serial Number: {serial_number}")
            cnpj = extrair_cnpj_do_texto(str(serial_number))
            if cnpj and debug:
                print(f"DEBUG: CNPJ extraído do Serial Number: {cnpj}")
        
        # Prioridade 7: Tenta extrair CNPJ do Subject Alternative Name (SAN) se disponível
        if not cnpj:
            try:
                san_ext = cert.extensions.get_extension_for_oid(x509.ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
                if san_ext:
                    san = san_ext.value
                    if debug:
                        print(f"DEBUG: Subject Alternative Name encontrado")
                    for name in san:
                        if isinstance(name, x509.DirectoryName):
                            for attr in name.value:
                                cnpj_extraido = extrair_cnpj_do_texto(attr.value)
                                if cnpj_extraido:
                                    cnpj = cnpj_extraido
                                    if debug:
                                        print(f"DEBUG: CNPJ extraído do SAN: {cnpj}")
                                    break
                        if cnpj:
                            break
            except x509.ExtensionNotFound:
                if debug:
                    print("DEBUG: Subject Alternative Name não encontrado")
            except Exception as e:
                if debug:
                    print(f"DEBUG: Erro ao processar SAN: {e}")
        
        # Extrai data de vencimento
        data_vencimento = cert.not_valid_after
        
        # Formata CNPJ se encontrado
        cnpj_formatado = None
        if cnpj:
            cnpj_formatado = f"{cnpj[:2]}.{cnpj[2:5]}.{cnpj[5:8]}/{cnpj[8:12]}-{cnpj[12:14]}"
            if debug:
                print(f"DEBUG: CNPJ final formatado: {cnpj_formatado}")
        else:
            if debug:
                print("DEBUG: ⚠️ CNPJ não encontrado em nenhum campo!")
        
        resultado = {
            "empresa": nome_empresa or "Nome não encontrado",
            "cnpj": cnpj_formatado or cnpj,
            "cnpj_limpo": cnpj,
            "dataVencimento": data_vencimento.isoformat() if data_vencimento else None
        }
        
        if debug:
            print(f"DEBUG: Resultado final: {resultado}")
            print("=" * 60)
        
        return resultado
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"ERROR extrair_informacoes_certificado: {error_msg}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=400,
            detail=f"Erro ao extrair informações do certificado: {error_msg}"
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
        key, cert, additional_certs = validar_pfx(conteudo, senha)
        subject = cert.subject

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


@app.post("/api/certificados/importar")
async def importar_certificado(
    certificado: UploadFile = File(...),
    senha: str = Form(...)
):
    """
    Endpoint para importar certificado digital e extrair informações automaticamente.
    Recebe apenas o arquivo e a senha, retorna CNPJ, nome da empresa e data de vencimento.
    """
    try:
        # Validação do arquivo
        if not certificado.filename:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "message": "Nome do arquivo não fornecido"
                }
            )
        
        filename_lower = certificado.filename.lower()
        if not (filename_lower.endswith('.pfx') or filename_lower.endswith('.p12')):
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "message": f"Arquivo deve ser um certificado .pfx ou .p12. Recebido: {certificado.filename}"
                }
            )
        
        # Validação da senha
        if not senha or not senha.strip():
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "message": "Senha não pode estar vazia"
                }
            )
        
        # Lê o conteúdo do arquivo
        conteudo = await certificado.read()
        
        if not conteudo:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "message": "Arquivo vazio ou não foi possível ler o conteúdo"
                }
            )
        
        # Extrai informações do certificado
        try:
            informacoes = extrair_informacoes_certificado(conteudo, senha)
        except HTTPException as e:
            return JSONResponse(
                status_code=e.status_code,
                content={
                    "success": False,
                    "message": e.detail
                }
            )
        
        # Valida se CNPJ foi encontrado
        if not informacoes.get("cnpj_limpo"):
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "message": "Não foi possível extrair o CNPJ do certificado. Verifique se é um certificado ICP-Brasil válido."
                }
            )
        
        # Retorna informações extraídas
        return {
            "success": True,
            "empresa": informacoes["empresa"],
            "cnpj": informacoes["cnpj"],
            "dataVencimento": informacoes["dataVencimento"]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"ERROR importar_certificado: {error_msg}")
        print(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": f"Erro ao processar certificado: {error_msg}"
            }
        )
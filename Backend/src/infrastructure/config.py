"""
Configurações centralizadas da aplicação.

Este módulo centraliza todas as configurações da aplicação, incluindo
caminhos de arquivos, variáveis de ambiente e constantes.
"""

import os
from pathlib import Path
from dotenv import load_dotenv, set_key, find_dotenv
from cryptography.fernet import Fernet

# Carrega variáveis de ambiente
backend_dir = Path(__file__).parent.parent.parent
env_path = backend_dir / ".env"
load_dotenv(env_path)
load_dotenv()  # Também tenta do diretório atual

# ============================================================================
# Caminhos de arquivos e diretórios
# ============================================================================

# Diretório raiz do backend
BACKEND_DIR = backend_dir

# Diretório onde os certificados são armazenados
CERTIFICATES_DIR = backend_dir / "certificados_armazenados"

# Garante que o diretório de certificados existe
CERTIFICATES_DIR.mkdir(exist_ok=True)

# ============================================================================
# Configurações de certificado
# ============================================================================

# Chave Fernet para criptografia de certificados
# Se não existir, gera uma chave e salva no .env para uso permanente
env_key = os.getenv("FERNET_KEY")

if env_key:
    # Chave encontrada no ambiente/.env - usa ela
    FERNET_KEY = env_key
else:
    # Chave não encontrada - gera UMA chave e SALVA no .env permanentemente
    print("⚠️  FERNET_KEY não encontrada. Gerando chave permanente...")
    generated_key = Fernet.generate_key()
    FERNET_KEY = generated_key.decode()  # Converte bytes para string
    
    # Salva a chave no arquivo .env
    try:
        # Tenta encontrar o arquivo .env ou criar um novo
        env_file = str(find_dotenv(str(env_path)) or env_path)
        
        # Se o arquivo não existe, cria um novo
        if not os.path.exists(env_file):
            with open(env_file, 'w') as f:
                f.write("# Chave Fernet para criptografia de certificados\n")
                f.write("# Esta chave foi gerada automaticamente - NÃO altere ou perca esta chave!\n")
                f.write("# Se você perder esta chave, não conseguirá descriptografar os certificados salvos.\n")
                f.write(f"FERNET_KEY={FERNET_KEY}\n")
        else:
            # Adiciona ou atualiza a chave no arquivo existente
            set_key(env_file, "FERNET_KEY", FERNET_KEY)
        
        print(f"✅ Chave FERNET_KEY gerada e salva permanentemente em: {env_file}")
        print(f"   ⚠️  IMPORTANTE: Esta chave foi salva no arquivo .env")
        print(f"   ⚠️  NÃO delete ou altere esta chave, ou você perderá acesso aos certificados!")
        
        # Recarrega o .env para garantir que está disponível
        load_dotenv(env_file, override=True)
        
    except Exception as e:
        print(f"❌ ERRO ao salvar chave no .env: {str(e)}")
        print(f"   Usando chave temporária (NÃO RECOMENDADO)")
        print(f"   Para corrigir, adicione manualmente no arquivo {env_path}:")
        print(f"   FERNET_KEY={FERNET_KEY}")

# ============================================================================
# Configurações de banco de dados
# ============================================================================

DATABASE_URL = os.getenv("DATABASE_URL")
APP_CRED_KEY = os.getenv("APP_CRED_KEY")

# ============================================================================
# Configurações de segurança
# ============================================================================

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL")
SUPABASE_AUDIENCE = os.getenv("SUPABASE_AUDIENCE", "authenticated")
SUPABASE_ISSUER = os.getenv("SUPABASE_ISSUER")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")

# ============================================================================
# Configurações CORS
# ============================================================================

CORS_ORIGINS = [
    origin.strip() 
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200,http://localhost:1234,http://127.0.0.1:1234").split(",") 
    if origin.strip()
]

# ============================================================================
# Configurações de execução
# ============================================================================

# Timeout padrão para operações do Playwright (em milissegundos)
PLAYWRIGHT_TIMEOUT = int(os.getenv("PLAYWRIGHT_TIMEOUT", "30000"))

# Modo headless padrão para navegador
PLAYWRIGHT_HEADLESS = os.getenv("PLAYWRIGHT_HEADLESS", "false").lower() == "true"

# ============================================================================
# Configurações de fila de execução
# ============================================================================

# Timeout para aguardar próxima execução na fila (em segundos)
QUEUE_TIMEOUT = int(os.getenv("QUEUE_TIMEOUT", "60"))


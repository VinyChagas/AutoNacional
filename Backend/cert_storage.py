# backend/cert_storage.py
import os
from cryptography.fernet import Fernet  # pyright: ignore[reportMissingImports]
from dotenv import load_dotenv, set_key, find_dotenv  # pyright: ignore[reportMissingImports]

# Carrega variáveis de ambiente do arquivo .env
# Tenta carregar do diretório atual e do diretório Backend
backend_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(backend_dir, ".env")
load_dotenv(env_path)  # Carrega do diretório Backend
load_dotenv()  # Também tenta do diretório atual

# SEMPRE usa uma chave fixa persistente no arquivo .env
# Se não existir, gera UMA chave e salva no .env para uso permanente
env_key = os.getenv("FERNET_KEY")

if env_key:
    # Chave encontrada no ambiente/.env - usa ela
    FERNET_KEY = env_key
    print(f"✅ Usando chave FERNET_KEY do arquivo .env")
else:
    # Chave não encontrada - gera UMA chave e SALVA no .env permanentemente
    print("⚠️  FERNET_KEY não encontrada. Gerando chave permanente...")
    generated_key = Fernet.generate_key()
    FERNET_KEY = generated_key.decode()  # Converte bytes para string
    
    # Salva a chave no arquivo .env
    try:
        # Tenta encontrar o arquivo .env ou criar um novo
        env_file = find_dotenv(env_path) or env_path
        
        # Se o arquivo não existe, cria um novo
        if not os.path.exists(env_file):
            with open(env_file, 'w') as f:
                f.write(f"# Chave Fernet para criptografia de certificados\n")
                f.write(f"# Esta chave foi gerada automaticamente - NÃO altere ou perca esta chave!\n")
                f.write(f"# Se você perder esta chave, não conseguirá descriptografar os certificados salvos.\n")
                f.write(f"FERNET_KEY={FERNET_KEY}\n")
        else:
            # Adiciona ou atualiza a chave no arquivo existente
            set_key(env_file, "FERNET_KEY", FERNET_KEY)
        
        print(f"✅ Chave FERNET_KEY gerada e salva permanentemente em: {env_file}")
        print(f"   Chave: {FERNET_KEY[:40]}...")
        print(f"   ⚠️  IMPORTANTE: Esta chave foi salva no arquivo .env")
        print(f"   ⚠️  NÃO delete ou altere esta chave, ou você perderá acesso aos certificados!")
        
        # Recarrega o .env para garantir que está disponível
        load_dotenv(env_file, override=True)
        
    except Exception as e:
        print(f"❌ ERRO ao salvar chave no .env: {str(e)}")
        print(f"   Usando chave temporária (NÃO RECOMENDADO)")
        print(f"   Para corrigir, adicione manualmente no arquivo {env_path}:")
        print(f"   FERNET_KEY={FERNET_KEY}")

fernet = Fernet(FERNET_KEY)

# Pasta onde os certificados serão guardados
# Salva dentro da pasta Backend, funcionando em qualquer OS
# __file__ aponta para este arquivo (cert_storage.py), então dirname(__file__) é a pasta Backend
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.join(BACKEND_DIR, "certificados_armazenados")
os.makedirs(BASE_DIR, exist_ok=True)

# Log para debug - mostra onde está salvando
print(f"📁 Certificados serão salvos em: {BASE_DIR}")

def salvar_certificado(cnpj: str, conteudo_pfx: bytes, senha: str):
    """
    Criptografa e salva o certificado e a senha no disco.
    """
    try:
        encrypted_pfx = fernet.encrypt(conteudo_pfx)
        encrypted_pwd = fernet.encrypt(senha.encode())

        file_path = os.path.join(BASE_DIR, f"{cnpj}.pfx.enc")
        pwd_path = os.path.join(BASE_DIR, f"{cnpj}.pwd.enc")

        print(f"💾 Salvando certificado em: {file_path}")
        print(f"💾 Salvando senha em: {pwd_path}")

        with open(file_path, "wb") as f:
            f.write(encrypted_pfx)

        with open(pwd_path, "wb") as f:
            f.write(encrypted_pwd)
        
        print(f"✅ Certificado salvo com sucesso para CNPJ: {cnpj}")
    except PermissionError as e:
        error_msg = f"Sem permissão para escrever em {BASE_DIR}: {str(e)}"
        print(f"❌ {error_msg}")
        raise PermissionError(error_msg)
    except OSError as e:
        error_msg = f"Erro ao salvar arquivo em {BASE_DIR}: {str(e)}"
        print(f"❌ {error_msg}")
        raise OSError(error_msg)
    except Exception as e:
        import traceback
        error_msg = f"Erro inesperado ao salvar certificado: {str(e)}"
        print(f"❌ {error_msg}")
        print(traceback.format_exc())
        raise Exception(error_msg)

def carregar_certificado(cnpj: str):
    """
    Lê e descriptografa o certificado e a senha para uso na automação.
    """
    if not cnpj:
        raise ValueError("CNPJ não pode ser None ou vazio")
    
    cnpj_str = str(cnpj).strip()
    if not cnpj_str:
        raise ValueError(f"CNPJ inválido: {cnpj}")
    
    file_path = os.path.join(BASE_DIR, f"{cnpj_str}.pfx.enc")
    pwd_path = os.path.join(BASE_DIR, f"{cnpj_str}.pwd.enc")

    if not os.path.exists(file_path) or not os.path.exists(pwd_path):
        raise FileNotFoundError(f"Certificado ou senha não encontrados para CNPJ: {cnpj_str}")

    try:
        with open(file_path, "rb") as f:
            encrypted_pfx = f.read()
        with open(pwd_path, "rb") as f:
            encrypted_pwd = f.read()

        conteudo_pfx = fernet.decrypt(encrypted_pfx)
        senha_bytes = fernet.decrypt(encrypted_pwd)
        
        if senha_bytes is None:
            raise ValueError(f"Senha descriptografada está None para CNPJ: {cnpj_str}")
        
        senha = senha_bytes.decode('utf-8')
        
        if not senha:
            raise ValueError(f"Senha descriptografada está vazia para CNPJ: {cnpj_str}")

        return conteudo_pfx, senha
    except Exception as e:
        raise Exception(f"Erro ao carregar certificado para CNPJ {cnpj_str}: {str(e)}")
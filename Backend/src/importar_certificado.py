import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cert_storage import salvar_certificado

CNPJ = "00000000000011"
CAMINHO_PFX = "C:\\Users\\ryans\\Documents\\certificado\\00000000000011.pfx"  # coloque o caminho do seu arquivo .pfx aqui
SENHA = "scs"                 

with open(CAMINHO_PFX, "rb") as f:
    conteudo_pfx = f.read()

salvar_certificado(
    cnpj=CNPJ,
    conteudo_pfx=conteudo_pfx,
    senha=SENHA
)
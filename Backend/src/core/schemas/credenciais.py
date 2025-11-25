from pydantic import BaseModel

class CredencialCreate(BaseModel):
    empresa_id: str
    portal: str = "nfse_nacional"
    usuario: str
    senha: str  # nunca retorna em responses
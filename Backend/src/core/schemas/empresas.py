from pydantic import BaseModel, Field, constr
from typing import Literal
from datetime import datetime

RegimeTipo = Literal["MEI", "SIMPLES", "PRESUMIDO"]

class EmpresaCreate(BaseModel):
    cnpj: constr(min_length=14, max_length=14, pattern=r"^\d+$")
    razao_social: str
    regime: RegimeTipo

class EmpresaOut(BaseModel):
    id: str
    cnpj: str
    razao_social: str
    regime: RegimeTipo
    ativo: bool
    created_at: datetime
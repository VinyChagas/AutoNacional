from ..core.db import get_conn
from typing import List, Dict, Any

def list_empresas() -> list[dict]:
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            select id, cnpj, razao_social, regime, ativo, created_at
            from public.empresas
            order by razao_social asc
        """)
        return cur.fetchall()

def create_empresa(cnpj: str, razao_social: str, regime: str) -> dict:
    with get_conn() as c, c.cursor() as cur:
        cur.execute("""
            insert into public.empresas (cnpj, razao_social, regime)
            values (%s, %s, %s)
            returning id, cnpj, razao_social, regime, ativo, created_at
        """, (cnpj, razao_social, regime))
        row = cur.fetchone()
        c.commit()
        return row
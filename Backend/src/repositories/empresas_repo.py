from typing import List, Dict, Any, Optional
import sys
import os

# Garante que src está no path para imports funcionarem
_current_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_current_dir)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

try:
    from core.db import get_conn
except ImportError:
    # Fallback para import relativo
    from ..core.db import get_conn

def list_empresas() -> list[dict]:
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, cnpj, razao_social, regime, ativo, created_at
            FROM empresas
            ORDER BY razao_social ASC
        """)
        rows = cursor.fetchall()
        # Converte para lista de dicts
        if rows and isinstance(rows[0], dict):
            return list(rows)
        # Se for SQLite Row, converte manualmente
        return [dict(row) for row in rows]
    finally:
        conn.close()

def get_empresa_by_id(empresa_id: str) -> Optional[dict]:
    """Busca uma empresa pelo ID."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, cnpj, razao_social, regime, ativo, created_at
            FROM empresas
            WHERE id = ?
        """, (empresa_id,))
        row = cursor.fetchone()
        if row:
            return dict(row) if isinstance(row, dict) else dict(zip([col[0] for col in cursor.description], row))
        return None
    finally:
        conn.close()

def get_empresa_by_cnpj(cnpj: str) -> Optional[dict]:
    """Busca uma empresa pelo CNPJ."""
    # Remove formatação do CNPJ
    cnpj_limpo = cnpj.replace(".", "").replace("/", "").replace("-", "").strip()
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, cnpj, razao_social, regime, ativo, created_at
            FROM empresas
            WHERE cnpj = ?
        """, (cnpj_limpo,))
        row = cursor.fetchone()
        if row:
            return dict(row) if isinstance(row, dict) else dict(zip([col[0] for col in cursor.description], row))
        return None
    finally:
        conn.close()

def create_empresa(cnpj: str, razao_social: str, regime: str) -> dict:
    import uuid
    empresa_id = str(uuid.uuid4())
    
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO empresas (id, cnpj, razao_social, regime)
            VALUES (?, ?, ?, ?)
        """, (empresa_id, cnpj, razao_social, regime))
        conn.commit()
        
        # Retorna a empresa criada
        cursor.execute("""
            SELECT id, cnpj, razao_social, regime, ativo, created_at
            FROM empresas
            WHERE id = ?
        """, (empresa_id,))
        row = cursor.fetchone()
        if row:
            return dict(row) if isinstance(row, dict) else dict(zip([col[0] for col in cursor.description], row))
        return {"id": empresa_id, "cnpj": cnpj, "razao_social": razao_social, "regime": regime, "ativo": True}
    finally:
        conn.close()

from fastapi import APIRouter, HTTPException, Path, status, Query
from typing import List
from ..schemas.contabilidade import (
    ContabilidadeCreate, ContabilidadeUpdate, ContabilidadeResponse, ContabilidadeListResponse
)
from ..core.db import get_conn

router = APIRouter(prefix="/contabilidades", tags=["Contabilidades"])

def _row_to_dict(row, cursor):
    """Converte uma row para dict, compatível com SQLite e PostgreSQL."""
    if isinstance(row, dict):
        return row
    if hasattr(cursor, 'description') and cursor.description:
        return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}
    return dict(row)

@router.post("", response_model=ContabilidadeResponse, status_code=status.HTTP_201_CREATED)
def criar_contabilidade(body: ContabilidadeCreate):
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO contabilidades (nome_contabilidade, cnpj, email, telefone, responsavel)
            VALUES (?, ?, ?, ?, ?)
        """, (body.nome_contabilidade, body.cnpj, body.email, body.telefone, body.responsavel))
        conn.commit()
        
        # Obtém o ID do registro inserido
        contabilidade_id = None
        if hasattr(cursor, 'lastrowid') and cursor.lastrowid:
            contabilidade_id = cursor.lastrowid
        else:
            # Fallback para PostgreSQL ou outros bancos
            try:
                cursor.execute("SELECT last_insert_rowid()")
                result = cursor.fetchone()
                if result:
                    contabilidade_id = result[0] if isinstance(result, (tuple, list)) else result.get('last_insert_rowid()') if isinstance(result, dict) else None
            except:
                try:
                    cursor.execute("SELECT LASTVAL()")
                    result = cursor.fetchone()
                    if result:
                        contabilidade_id = result[0] if isinstance(result, (tuple, list)) else result.get('lastval') if isinstance(result, dict) else None
                except:
                    pass
        
        if not contabilidade_id:
            raise HTTPException(status_code=500, detail="Erro ao obter ID da contabilidade criada")
        
        cursor.execute("""
            SELECT *, 
            (SELECT COUNT(*) FROM certificados_digitais WHERE contabilidade_id = contabilidades.id) AS certificados_vinculados 
            FROM contabilidades WHERE id = ?
        """, (contabilidade_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="Erro ao buscar contabilidade recém-criada")
        
        row_dict = _row_to_dict(row, cursor)
        return ContabilidadeResponse(**row_dict)
    except Exception as e:
        import logging
        logging.error(f"Erro ao criar contabilidade: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao criar contabilidade: {str(e)}")
    finally:
        conn.close()

@router.get("", response_model=ContabilidadeListResponse)
def listar_contabilidades(skip: int = Query(0, ge=0), limit: int = Query(100, le=100), somente_ativas: bool = Query(True)):
    conn = get_conn()
    try:
        cursor = conn.cursor()
        sql = """
            SELECT *, 
            (SELECT COUNT(*) FROM certificados_digitais WHERE contabilidade_id = contabilidades.id) AS certificados_vinculados 
            FROM contabilidades
        """
        if somente_ativas:
            sql += " WHERE 1=1 "  # Caso queira expandir filtro no futuro
        sql += " ORDER BY nome_contabilidade ASC LIMIT ? OFFSET ?"
        cursor.execute(sql, (limit, skip))
        rows = cursor.fetchall()
        
        contabilidades = []
        for row in rows:
            row_dict = _row_to_dict(row, cursor)
            contabilidades.append(ContabilidadeResponse(**row_dict))
        
        return ContabilidadeListResponse(
            contabilidades=contabilidades,
            total=len(contabilidades)
        )
    except Exception as e:
        import logging
        logging.error(f"Erro ao listar contabilidades: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao listar contabilidades: {str(e)}")
    finally:
        conn.close()

@router.get("/{contabilidade_id}", response_model=ContabilidadeResponse)
def get_contabilidade(contabilidade_id: int = Path(..., ge=1)):
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT *, 
            (SELECT COUNT(*) FROM certificados_digitais WHERE contabilidade_id = contabilidades.id) AS certificados_vinculados 
            FROM contabilidades WHERE id = ?
        """, (contabilidade_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contabilidade não encontrada")
        
        row_dict = _row_to_dict(row, cursor)
        return ContabilidadeResponse(**row_dict)
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.error(f"Erro ao buscar contabilidade: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao buscar contabilidade: {str(e)}")
    finally:
        conn.close()

@router.put("/{contabilidade_id}", response_model=ContabilidadeResponse)
def atualizar_contabilidade(contabilidade_id: int, body: ContabilidadeUpdate):
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Não permite alteração de CNPJ
        fields = []
        values = []
        for attr in ["nome_contabilidade", "email", "telefone", "responsavel"]:
            val = getattr(body, attr)
            if val is not None:
                fields.append(f"{attr} = ?")
                values.append(val)
        if not fields:
            raise HTTPException(status_code=400, detail="Nenhuma alteração informada")
        values.append(contabilidade_id)
        sql = f"UPDATE contabilidades SET {', '.join(fields)} WHERE id = ?"
        cursor.execute(sql, tuple(values))
        conn.commit()
        
        cursor.execute("""
            SELECT *, 
            (SELECT COUNT(*) FROM certificados_digitais WHERE contabilidade_id = contabilidades.id) AS certificados_vinculados 
            FROM contabilidades WHERE id = ?
        """, (contabilidade_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contabilidade não encontrada após atualização")
        
        row_dict = _row_to_dict(row, cursor)
        return ContabilidadeResponse(**row_dict)
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.error(f"Erro ao atualizar contabilidade: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar contabilidade: {str(e)}")
    finally:
        conn.close()

@router.delete("/{contabilidade_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_contabilidade(contabilidade_id: int):
    conn = get_conn()
    try:
        cursor = conn.cursor()
        # Verifica se existe antes de excluir
        cursor.execute("SELECT id FROM contabilidades WHERE id = ?", (contabilidade_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contabilidade não encontrada")
        
        cursor.execute("SELECT COUNT(*) FROM certificados_digitais WHERE contabilidade_id = ?", (contabilidade_id,))
        row = cursor.fetchone()
        certificados_vinculados = row[0] if row and isinstance(row, (tuple, list)) else (row[0] if isinstance(row, dict) else 0)
        
        # Adotando a regra ON DELETE SET NULL: exclusão é permitida e certificados são desvinculados
        cursor.execute("DELETE FROM contabilidades WHERE id = ?", (contabilidade_id,))
        conn.commit()
        return None
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.error(f"Erro ao excluir contabilidade: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao excluir contabilidade: {str(e)}")
    finally:
        conn.close()


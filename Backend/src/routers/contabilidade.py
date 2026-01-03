from fastapi import APIRouter, HTTPException, Path, status, Query
from typing import List, Dict

from sqlalchemy import func

from ..schemas.contabilidade import (
    ContabilidadeCreate,
    ContabilidadeUpdate,
    ContabilidadeResponse,
    ContabilidadeListResponse,
)
from ..core.db import get_conn
from ..db.session import SessionLocal
from ..db import models

router = APIRouter(prefix="/contabilidades", tags=["Contabilidades"])


def _get_certificados_count_for_ids(contabilidade_ids: List[int]) -> Dict[int, int]:
    """
    Conta quantos certificados existem em certificados.db para cada contabilidade.

    Usa a tabela SQLAlchemy `certificados` (models.Certificado), que é onde os
    certificados são realmente persistidos pelo fluxo de importação.
    """
    if not contabilidade_ids:
        return {}

    db = SessionLocal()
    try:
        rows = (
            db.query(models.Certificado.contabilidade_id, func.count(models.Certificado.id))
            .filter(models.Certificado.contabilidade_id.in_(contabilidade_ids))
            .group_by(models.Certificado.contabilidade_id)
            .all()
        )
        return {cont_id: int(qtd or 0) for cont_id, qtd in rows if cont_id is not None}
    finally:
        db.close()


def _get_certificados_count(contabilidade_id: int) -> int:
    """Conta certificados para uma única contabilidade."""
    if not contabilidade_id:
        return 0

    db = SessionLocal()
    try:
        qtd = (
            db.query(func.count(models.Certificado.id))
            .filter(models.Certificado.contabilidade_id == contabilidade_id)
            .scalar()
        )
        return int(qtd or 0)
    finally:
        db.close()


def _get_empresas_count_for_ids(contabilidade_ids: List[int]) -> Dict[int, int]:
    """
    Conta quantas empresas existem vinculadas a cada contabilidade.

    Usa a tabela SQLAlchemy `empresas` (models.Empresa), que é onde as
    empresas são persistidas quando cadastradas na tela de credenciais.
    """
    if not contabilidade_ids:
        return {}

    db = SessionLocal()
    try:
        rows = (
            db.query(models.Empresa.contabilidade_id, func.count(models.Empresa.id))
            .filter(models.Empresa.contabilidade_id.in_(contabilidade_ids))
            .group_by(models.Empresa.contabilidade_id)
            .all()
        )
        return {cont_id: int(qtd or 0) for cont_id, qtd in rows if cont_id is not None}
    finally:
        db.close()


def _get_empresas_count(contabilidade_id: int) -> int:
    """Conta empresas para uma única contabilidade."""
    if not contabilidade_id:
        return 0

    db = SessionLocal()
    try:
        qtd = (
            db.query(func.count(models.Empresa.id))
            .filter(models.Empresa.contabilidade_id == contabilidade_id)
            .scalar()
        )
        return int(qtd or 0)
    finally:
        db.close()


def _get_total_empresas_vinculadas(contabilidade_id: int) -> int:
    """
    Retorna o total de empresas vinculadas a uma contabilidade.
    Soma certificados + empresas cadastradas na tela de credenciais.
    """
    certificados_count = _get_certificados_count(contabilidade_id)
    empresas_count = _get_empresas_count(contabilidade_id)
    return certificados_count + empresas_count


def _get_total_empresas_vinculadas_for_ids(contabilidade_ids: List[int]) -> Dict[int, int]:
    """
    Retorna o total de empresas vinculadas para cada contabilidade.
    Soma certificados + empresas cadastradas na tela de credenciais.
    """
    certificados_counts = _get_certificados_count_for_ids(contabilidade_ids)
    empresas_counts = _get_empresas_count_for_ids(contabilidade_ids)
    
    # Combina os dois dicionários somando os valores
    total_counts: Dict[int, int] = {}
    all_ids = set(certificados_counts.keys()) | set(empresas_counts.keys())
    
    for cont_id in all_ids:
        cert_count = certificados_counts.get(cont_id, 0)
        emp_count = empresas_counts.get(cont_id, 0)
        total_counts[cont_id] = cert_count + emp_count
    
    return total_counts

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
        
        cursor.execute(
            """
            SELECT *
            FROM contabilidades
            WHERE id = ?
        """,
            (contabilidade_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="Erro ao buscar contabilidade recém-criada")
        
        row_dict = _row_to_dict(row, cursor)
        row_dict["certificados_vinculados"] = _get_total_empresas_vinculadas(contabilidade_id)
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
            SELECT *
            FROM contabilidades
        """
        if somente_ativas:
            sql += " WHERE 1=1 "  # Caso queira expandir filtro no futuro
        sql += " ORDER BY nome_contabilidade ASC LIMIT ? OFFSET ?"
        cursor.execute(sql, (limit, skip))
        rows = cursor.fetchall()
        
        contabilidades_dicts = []
        contabilidade_ids: List[int] = []
        for row in rows:
            row_dict = _row_to_dict(row, cursor)
            # Garante que temos o ID numérico para fazer o mapeamento
            cont_id = row_dict.get("id")
            if isinstance(cont_id, int):
                contabilidade_ids.append(cont_id)
            contabilidades_dicts.append(row_dict)

        # Busca contagem total (certificados + empresas) no banco de certificados (certificados.db)
        total_por_contabilidade = _get_total_empresas_vinculadas_for_ids(contabilidade_ids)

        contabilidades = []
        for row_dict in contabilidades_dicts:
            cont_id = row_dict.get("id")
            row_dict["certificados_vinculados"] = total_por_contabilidade.get(cont_id, 0)
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
        cursor.execute(
            """
            SELECT *
            FROM contabilidades
            WHERE id = ?
        """,
            (contabilidade_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contabilidade não encontrada")
        
        row_dict = _row_to_dict(row, cursor)
        row_dict["certificados_vinculados"] = _get_total_empresas_vinculadas(contabilidade_id)
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
        
        cursor.execute(
            """
            SELECT *
            FROM contabilidades
            WHERE id = ?
        """,
            (contabilidade_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contabilidade não encontrada após atualização")
        row_dict = _row_to_dict(row, cursor)
        row_dict["certificados_vinculados"] = _get_total_empresas_vinculadas(contabilidade_id)
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
        
        # Busca apenas para log/consistência – atualmente não bloqueia a exclusão
        certificados_vinculados = _get_total_empresas_vinculadas(contabilidade_id)
        
        # Regra: exclusão da contabilidade não apaga certificados na base de certificados,
        # apenas os deixa "órfãos" em relação à contabilidade. Caso queira, podemos
        # futuramente limpar ou zerar o vínculo nesses registros.
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


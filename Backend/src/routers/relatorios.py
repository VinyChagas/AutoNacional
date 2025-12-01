"""
Endpoints FastAPI para relatórios de execuções.
"""

from fastapi import APIRouter, HTTPException, status, Query
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import csv
from io import StringIO

from ..db.session import SessionLocal
from ..db.models import Execucao
from ..repositories.empresas_repo import get_empresa_by_id
from ..infrastructure.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/relatorios", tags=["Relatórios"])


class EmpresaResumo(BaseModel):
    """Resumo de uma empresa no relatório."""
    cnpj: str
    nome: Optional[str] = None
    qtd_notas_emitidas: int = 0
    qtd_notas_recebidas: int = 0


class ResumoExecucoesResponse(BaseModel):
    """Resposta do endpoint de resumo de execuções."""
    competencia: Optional[str]
    total_empresas: int
    com_movimento: int
    sem_movimento: int
    empresas_com_movimento: List[EmpresaResumo]
    empresas_sem_movimento: List[EmpresaResumo]


@router.get("/execucoes/resumo", response_model=ResumoExecucoesResponse, summary="Obter resumo das execuções")
def obter_resumo_execucoes(
    competencia: Optional[str] = Query(None, description="Competência no formato MMAAAA (ex: 112025). Se não informado, retorna todas."),
    status_filtro: Optional[str] = Query("concluido", description="Status para filtrar: concluido, falhou, etc. Padrão: concluido")
) -> ResumoExecucoesResponse:
    """
    Gera um resumo das execuções, classificando empresas em:
    - Com movimento: empresas que baixaram pelo menos uma nota (emitida ou recebida)
    - Sem movimento: empresas que não baixaram nenhuma nota
    
    Args:
        competencia: Competência no formato MMAAAA (opcional)
        status_filtro: Status das execuções para incluir no relatório (padrão: concluido)
        
    Returns:
        ResumoExecucoesResponse com estatísticas e listas de empresas
    """
    try:
        db = SessionLocal()
        try:
            # Monta query base
            query = db.query(Execucao).filter(Execucao.status == status_filtro)
            
            # Filtra por competência se fornecida
            if competencia:
                query = query.filter(Execucao.competencia == competencia)
            
            # Busca execuções
            execucoes = query.all()
            
            empresas_com_movimento = []
            empresas_sem_movimento = []
            
            for execucao in execucoes:
                # Determina se teve movimento
                qtd_emitidas = execucao.qtd_notas_emitidas or 0
                qtd_recebidas = execucao.qtd_notas_recebidas or 0
                
                # Busca nome da empresa se disponível
                nome_empresa = None
                if execucao.empresa_id:
                    try:
                        empresa = get_empresa_by_id(execucao.empresa_id)
                        if empresa:
                            nome_empresa = empresa.get("nome") or empresa.get("razao_social")
                    except:
                        pass
                
                empresa_resumo = EmpresaResumo(
                    cnpj=execucao.cnpj or execucao.empresa_id,
                    nome=nome_empresa,
                    qtd_notas_emitidas=qtd_emitidas,
                    qtd_notas_recebidas=qtd_recebidas
                )
                
                if qtd_emitidas > 0 or qtd_recebidas > 0:
                    empresas_com_movimento.append(empresa_resumo)
                else:
                    empresas_sem_movimento.append(empresa_resumo)
            
            return ResumoExecucoesResponse(
                competencia=competencia,
                total_empresas=len(execucoes),
                com_movimento=len(empresas_com_movimento),
                sem_movimento=len(empresas_sem_movimento),
                empresas_com_movimento=empresas_com_movimento,
                empresas_sem_movimento=empresas_sem_movimento
            )
            
        finally:
            db.close()
            
    except Exception as e:
        logger.error(f"Erro ao gerar resumo de execuções: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao gerar resumo: {str(e)}"
        )


@router.get("/execucoes/resumo/csv", summary="Baixar resumo das execuções em CSV")
def baixar_resumo_csv(
    competencia: Optional[str] = Query(None, description="Competência no formato MMAAAA (ex: 112025)"),
    status_filtro: Optional[str] = Query("concluido", description="Status para filtrar")
):
    """
    Gera e retorna um arquivo CSV com o resumo das execuções.
    
    Args:
        competencia: Competência no formato MMAAAA (opcional)
        status_filtro: Status das execuções para incluir no relatório
        
    Returns:
        Arquivo CSV para download
    """
    try:
        # Obtém resumo
        resumo = obter_resumo_execucoes(competencia=competencia, status_filtro=status_filtro)
        
        # Cria CSV em memória
        output = StringIO()
        writer = csv.writer(output)
        
        # Cabeçalho
        writer.writerow([
            "CNPJ",
            "Nome",
            "Total Notas Emitidas",
            "Total Notas Recebidas",
            "Total Notas",
            "Status"
        ])
        
        # Empresas com movimento
        for empresa in resumo.empresas_com_movimento:
            total_notas = empresa.qtd_notas_emitidas + empresa.qtd_notas_recebidas
            writer.writerow([
                empresa.cnpj,
                empresa.nome or "",
                empresa.qtd_notas_emitidas,
                empresa.qtd_notas_recebidas,
                total_notas,
                "Com movimento"
            ])
        
        # Empresas sem movimento
        for empresa in resumo.empresas_sem_movimento:
            writer.writerow([
                empresa.cnpj,
                empresa.nome or "",
                empresa.qtd_notas_emitidas,
                empresa.qtd_notas_recebidas,
                0,
                "Sem movimento"
            ])
        
        csv_content = output.getvalue()
        output.close()
        
        # Retorna como resposta de download
        from fastapi.responses import Response
        filename = f"resumo_execucoes_{competencia or 'todas'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
        
    except Exception as e:
        logger.error(f"Erro ao gerar CSV de resumo: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao gerar CSV: {str(e)}"
        )


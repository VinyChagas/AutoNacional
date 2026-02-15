/**
 * Router de relatórios de execuções.
 * Rotas de relatórios.
 */
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import { prisma } from '../db/client';
import * as empresasRepo from '../repositories/empresas';

const logger = getLogger('relatorios');
const router = Router();

interface EmpresaResumo {
  cnpj: string;
  nome: string | null;
  qtd_notas_emitidas: number;
  qtd_notas_recebidas: number;
}

interface ResumoExecucoes {
  competencia: string | null;
  total_empresas: number;
  com_movimento: number;
  sem_movimento: number;
  empresas_com_movimento: EmpresaResumo[];
  empresas_sem_movimento: EmpresaResumo[];
}

// GET /execucoes/resumo - Resumo das execuções
router.get('/execucoes/resumo', async (req: Request, res: Response) => {
  try {
    const competencia = (req.query.competencia as string) || null;
    const statusFiltro = (req.query.status_filtro as string) || 'concluido';

    const where: { status: string; periodoInicio?: { contains: string } } = {
      status: statusFiltro,
    };

    if (competencia && competencia.length === 6 && /^\d+$/.test(competencia)) {
      const mes = competencia.slice(0, 2);
      const ano = competencia.slice(2, 6);
      where.periodoInicio = { contains: `/${mes}/${ano}` };
    }

    const execucoes = await prisma.execucao.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const empresasComMovimento: EmpresaResumo[] = [];
    const empresasSemMovimento: EmpresaResumo[] = [];

    for (const exec of execucoes) {
      const qtdEmitidas = exec.qtdNotasEmitidas ?? 0;
      const qtdRecebidas = exec.qtdNotasRecebidas ?? 0;

      let nomeEmpresa: string | null = null;
      if (exec.empresaId) {
        try {
          const empresa = await empresasRepo.obterEmpresaPorId(exec.empresaId);
          nomeEmpresa = empresa?.razaoSocial ?? null;
        } catch {
          /* ignore */
        }
      }

      const resumo: EmpresaResumo = {
        cnpj: exec.cnpj ?? String(exec.empresaId),
        nome: nomeEmpresa,
        qtd_notas_emitidas: qtdEmitidas,
        qtd_notas_recebidas: qtdRecebidas,
      };

      if (qtdEmitidas > 0 || qtdRecebidas > 0) {
        empresasComMovimento.push(resumo);
      } else {
        empresasSemMovimento.push(resumo);
      }
    }

    const resultado: ResumoExecucoes = {
      competencia: competencia ?? null,
      total_empresas: execucoes.length,
      com_movimento: empresasComMovimento.length,
      sem_movimento: empresasSemMovimento.length,
      empresas_com_movimento: empresasComMovimento,
      empresas_sem_movimento: empresasSemMovimento,
    };

    res.json(resultado);
  } catch (error) {
    logger.error({ err: error }, 'Erro ao gerar resumo de execuções');
    res.status(500).json({ detail: 'Erro ao gerar resumo de execuções' });
  }
});

// GET /execucoes/resumo/csv - Download CSV do resumo
router.get('/execucoes/resumo/csv', async (req: Request, res: Response) => {
  try {
    const competencia = (req.query.competencia as string) || null;
    const statusFiltro = (req.query.status_filtro as string) || 'concluido';

    const where: { status: string; periodoInicio?: { contains: string } } = {
      status: statusFiltro,
    };

    if (competencia && competencia.length === 6 && /^\d+$/.test(competencia)) {
      const mes = competencia.slice(0, 2);
      const ano = competencia.slice(2, 6);
      where.periodoInicio = { contains: `/${mes}/${ano}` };
    }

    const execucoes = await prisma.execucao.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const empresasComMovimento: EmpresaResumo[] = [];
    const empresasSemMovimento: EmpresaResumo[] = [];

    for (const exec of execucoes) {
      const qtdEmitidas = exec.qtdNotasEmitidas ?? 0;
      const qtdRecebidas = exec.qtdNotasRecebidas ?? 0;

      let nomeEmpresa: string | null = null;
      if (exec.empresaId) {
        try {
          const empresa = await empresasRepo.obterEmpresaPorId(exec.empresaId);
          nomeEmpresa = empresa?.razaoSocial ?? null;
        } catch {
          /* ignore */
        }
      }

      const resumo: EmpresaResumo = {
        cnpj: exec.cnpj ?? String(exec.empresaId),
        nome: nomeEmpresa,
        qtd_notas_emitidas: qtdEmitidas,
        qtd_notas_recebidas: qtdRecebidas,
      };

      if (qtdEmitidas > 0 || qtdRecebidas > 0) {
        empresasComMovimento.push(resumo);
      } else {
        empresasSemMovimento.push(resumo);
      }
    }

    const linhas: string[] = [];
    const enc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    linhas.push(['CNPJ', 'Nome', 'Total Notas Emitidas', 'Total Notas Recebidas', 'Total Notas', 'Status'].map(enc).join(','));

    for (const emp of empresasComMovimento) {
      const total = emp.qtd_notas_emitidas + emp.qtd_notas_recebidas;
      linhas.push([emp.cnpj, emp.nome ?? '', emp.qtd_notas_emitidas, emp.qtd_notas_recebidas, total, 'Com movimento'].map(enc).join(','));
    }
    for (const emp of empresasSemMovimento) {
      linhas.push([emp.cnpj, emp.nome ?? '', emp.qtd_notas_emitidas, emp.qtd_notas_recebidas, 0, 'Sem movimento'].map(enc).join(','));
    }

    const csv = linhas.join('\n');
    const filename = `resumo_execucoes_${competencia ?? 'todas'}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error({ err: error }, 'Erro ao gerar CSV de resumo');
    res.status(500).json({ detail: 'Erro ao gerar CSV de resumo' });
  }
});

export default router;

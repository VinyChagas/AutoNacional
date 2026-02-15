/**
 * Router de dashboard - KPIs e gráficos para a Home
 */
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import { prisma } from '../db/client';

const logger = getLogger('dashboard');
const router = Router();

function parseValidade(dataValidade: string | null): Date | null {
  if (!dataValidade) return null;
  // Formato DD/MM/YYYY ou ISO
  const iso = dataValidade.includes('T') || dataValidade.includes('-');
  if (iso) return new Date(dataValidade);
  const [d, m, y] = dataValidade.split(/[/\-]/);
  if (d && m && y) return new Date(+y, +m - 1, +d);
  return null;
}

function diasParaVencer(data: Date | null): number | null {
  if (!data) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const val = new Date(data);
  val.setHours(0, 0, 0, 0);
  return Math.ceil((val.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * GET /api/dashboard/resumo?period=30d
 */
router.get('/resumo', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || '30d';
    const dias = period === '7d' ? 7 : period === '30d' ? 30 : 30;

    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - dias);
    dataInicio.setHours(0, 0, 0, 0);

    // Total de empresas
    const empresasTotal = await prisma.empresa.count({ where: { ativo: true } });

    // Empresas com certificado válido (por CNPJ)
    const certs = await prisma.certificado.findMany({
      select: { cnpj: true, dataValidade: true },
    });
    const cnpsComCert = new Set(certs.map((c) => c.cnpj.replace(/[.\/\-\s]/g, '')));

    // Empresas com credencial OK
    const credsOk = await prisma.credencial.findMany({
      where: { status: 'OK' },
      select: { empresaId: true },
    });
    const empresaIdsComCredOk = new Set(credsOk.map((c) => c.empresaId));

    // Empresas com certificado (por empresa)
    const empresas = await prisma.empresa.findMany({
      where: { ativo: true },
      select: { id: true, cnpj: true },
    });
    let empresasOperacionais = 0;
    for (const e of empresas) {
      const cnpjLimpo = e.cnpj.replace(/[.\/\-\s]/g, '');
      const temCert = cnpsComCert.has(cnpjLimpo);
      const temCredOk = empresaIdsComCredOk.has(e.id);
      if (temCert || temCredOk) empresasOperacionais++;
    }

    // Certificados vencendo (< 30 dias)
    const hoje30 = new Date();
    hoje30.setDate(hoje30.getDate() + 30);
    let certificadosVencendo = 0;
    for (const c of certs) {
      const val = parseValidade(c.dataValidade);
      const diasRest = diasParaVencer(val);
      if (diasRest != null && diasRest >= 0 && diasRest <= 30) certificadosVencendo++;
    }

    // Credenciais inválidas (status != OK e != NAO_TESTADO)
    const credenciaisInvalidas = await prisma.credencial.count({
      where: {
        status: { notIn: ['OK', 'NAO_TESTADO'] },
      },
    });

    // Execuções no período
    const execucoesMes = await prisma.execucao.count({
      where: { dataInicio: { gte: dataInicio } },
    });

    // Execuções com sucesso vs erro
    const execs = await prisma.execucao.findMany({
      where: { dataInicio: { gte: dataInicio } },
      select: { status: true, mensagemErro: true },
    });
    const ok = execs.filter((e) => e.status === 'finalizado' && !e.mensagemErro).length;
    const taxaSucesso = execucoesMes > 0 ? Math.round((ok / execucoesMes) * 1000) / 10 : 0;

    // Notas encontradas
    const notas = await prisma.execucao.aggregate({
      where: { dataInicio: { gte: dataInicio } },
      _sum: {
        qtdNotasEmitidas: true,
        qtdNotasRecebidas: true,
      },
    });
    const notasEncontradas =
      (notas._sum.qtdNotasEmitidas ?? 0) + (notas._sum.qtdNotasRecebidas ?? 0);

    // Erros no mês
    const errosMes = execs.filter((e) => !!e.mensagemErro || e.status === 'falhou').length;

    // Empresas sem método (sem cert e sem cred OK)
    let empresasSemMetodo = 0;
    for (const e of empresas) {
      const cnpjLimpo = e.cnpj.replace(/[.\/\-\s]/g, '');
      const temCert = cnpsComCert.has(cnpjLimpo);
      const temCredOk = empresaIdsComCredOk.has(e.id);
      if (!temCert && !temCredOk) empresasSemMetodo++;
    }

    // Certificados vencidos (já passou)
    let certificadosVencidos = 0;
    for (const c of certs) {
      const val = parseValidade(c.dataValidade);
      const diasRest = diasParaVencer(val);
      if (diasRest != null && diasRest < 0) certificadosVencidos++;
    }

    res.json({
      empresas_total: empresasTotal,
      empresas_operacionais: empresasOperacionais,
      certificados_vencendo: certificadosVencendo,
      credenciais_invalidas: credenciaisInvalidas,
      execucoes_mes: execucoesMes,
      taxa_sucesso: taxaSucesso,
      notas_encontradas: notasEncontradas,
      erros_mes: errosMes,
      empresas_sem_metodo: empresasSemMetodo,
      certificados_vencidos: certificadosVencidos,
      empresas_nao_validadas: 0, // TODO: integrar com validacoes quando houver
    });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter resumo do dashboard');
    res.status(500).json({ detail: 'Erro ao obter resumo' });
  }
});

/**
 * GET /api/dashboard/execucoes?period=7d
 */
router.get('/execucoes', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || '7d';
    const dias = period === '7d' ? 7 : 14;

    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - dias);
    dataInicio.setHours(0, 0, 0, 0);

    const execucoes = await prisma.execucao.findMany({
      where: { dataInicio: { gte: dataInicio } },
      select: {
        dataInicio: true,
        status: true,
        mensagemErro: true,
      },
    });

    const porDia = new Map<string, { total: number; sucesso: number; erro: number }>();
    for (let i = 0; i < dias; i++) {
      const d = new Date(dataInicio);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      porDia.set(key, { total: 0, sucesso: 0, erro: 0 });
    }

    for (const e of execucoes) {
      if (!e.dataInicio) continue;
      const key = e.dataInicio.toISOString().slice(0, 10);
      if (!porDia.has(key)) porDia.set(key, { total: 0, sucesso: 0, erro: 0 });
      const cell = porDia.get(key)!;
      cell.total++;
      if (e.status === 'finalizado' && !e.mensagemErro) cell.sucesso++;
      else cell.erro++;
    }

    const resultado = Array.from(porDia.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([data, v]) => ({
        data,
        total: v.total,
        sucesso: v.sucesso,
        erro: v.erro,
      }));

    res.json(resultado);
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter execuções por dia');
    res.status(500).json({ detail: 'Erro ao obter execuções' });
  }
});

/**
 * GET /api/dashboard/distribuicao-regime
 */
router.get('/distribuicao-regime', async (req: Request, res: Response) => {
  try {
    const grupos = await prisma.empresa.groupBy({
      by: ['regime'],
      where: { ativo: true },
      _count: { id: true },
    });

    const labels: Record<string, string> = {
      'Simples Nacional': 'Simples Nacional',
      'Lucro Presumido': 'Lucro Presumido',
      'Lucro Real': 'Lucro Real',
      MEI: 'MEI',
      null: 'Outros',
      '': 'Outros',
    };

    const resultado = grupos.map((g) => ({
      regime: labels[g.regime ?? ''] ?? g.regime ?? 'Outros',
      quantidade: g._count.id,
    }));

    res.json(resultado);
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter distribuição por regime');
    res.status(500).json({ detail: 'Erro ao obter distribuição' });
  }
});

export default router;

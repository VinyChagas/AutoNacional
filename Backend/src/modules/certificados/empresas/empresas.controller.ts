/**
 * Controller de empresas - trata request/response.
 */
import { Request, Response } from 'express';
import * as service from './empresas.service';
import * as repo from './empresas.repo';
import * as repoLegacy from '../../../repositories/empresas';
import * as cadastroCertificadoService from './cadastro-certificado.service';
import * as cadastroCredencialService from './cadastro-credencial.service';
import { jsonSuccess, jsonError, jsonCreated } from '../../../middleware/response';
import { normalizeCnpj } from '../../../utils/cnpj';

function toListagemItem(row: {
  id: number;
  cnpj: string;
  razao_social: string;
  regime: string | null;
  contabilidade_id: number | null;
  contabilidade_nome?: string | null;
  ativo: boolean;
  created_at: Date;
  updated_at: Date;
  has_certificado: boolean;
  cert_validade: string | null;
  has_credenciais: boolean;
  cred_status: string | null;
  cred_ultimo_teste_em?: string | null;
  cred_ultima_mensagem?: string | null;
  status_geral: string;
  status_geral_motivo?: string | null;
  certificate_status?: string;
  credential_status?: string;
  credential_requires_revalidation?: boolean;
  credential_revalidation_reason?: string | null;
  automation_eligibility?: string;
  issue_codes?: string[];
  issue_messages?: string[];
  recommended_action?: string | null;
  certificate_days_delta?: number | null;
}) {
  return {
    id: String(row.id),
    cnpj: row.cnpj,
    razao_social: row.razao_social,
    regime: row.regime,
    contabilidade_id: row.contabilidade_id,
    contabilidade_nome: row.contabilidade_nome ?? null,
    ativo: row.ativo,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    has_certificado: Boolean(row.has_certificado),
    cert_validade: row.cert_validade ?? null,
    has_credenciais: Boolean(row.has_credenciais),
    cred_status: row.cred_status ?? null,
    cred_ultimo_teste_em: row.cred_ultimo_teste_em ?? null,
    cred_ultima_mensagem: row.cred_ultima_mensagem ?? null,
    status_geral: row.status_geral ?? null,
    status_geral_motivo: row.status_geral_motivo ?? null,
    certificate_status: row.certificate_status ?? null,
    credential_status: row.credential_status ?? null,
    credential_requires_revalidation: Boolean(row.credential_requires_revalidation),
    credential_revalidation_reason: row.credential_revalidation_reason ?? null,
    automation_eligibility: row.automation_eligibility ?? null,
    issue_codes: row.issue_codes ?? [],
    issue_messages: row.issue_messages ?? [],
    recommended_action: row.recommended_action ?? null,
    certificate_days_delta: row.certificate_days_delta ?? null,
  };
}

export async function listar(req: Request, res: Response): Promise<void> {
  const params = service.parseListarParams(req.query as service.ListarEmpresasQuery);
  const conflito = service.validarFiltrosConflitantes(params);
  if (conflito) {
    jsonError(res, conflito, 400);
    return;
  }
  const result = await service.listarEmpresas(params);

  jsonSuccess(res, {
    items: result.items.map(toListagemItem),
    total: result.total,
    page: result.page,
    limit: result.limit,
  });
}

export async function obterPorId(req: Request, res: Response): Promise<void> {
  const id = parseInt(String(req.params.id ?? ''), 10);
  if (isNaN(id) || id < 1) {
    jsonError(res, 'ID de empresa inválido', 400);
    return;
  }

  const data = await service.obterEmpresaPorId(id);
  if (!data) {
    jsonError(res, `Empresa com ID ${id} não encontrada`, 404);
    return;
  }

  jsonSuccess(res, data);
}

export async function listarPorContabilidade(req: Request, res: Response): Promise<void> {
  const contabilidadeId = parseInt(String(req.params.contabilidade_id ?? ''), 10);
  if (isNaN(contabilidadeId) || contabilidadeId < 1) {
    jsonError(res, 'ID de contabilidade inválido', 400);
    return;
  }
  const params = service.parseListarParams({ ...req.query, contabilidade_id: String(contabilidadeId) });
  const result = await service.listarEmpresas(params);
  jsonSuccess(res, {
    items: result.items.map(toListagemItem),
    total: result.total,
    page: result.page,
    limit: result.limit,
  });
}

export async function obterPorCnpj(req: Request, res: Response): Promise<void> {
  const cnpj = normalizeCnpj(String(req.params.cnpj ?? ''));
  const empresa = await repoLegacy.obterEmpresaPorCnpj(cnpj);
  if (!empresa) {
    jsonError(res, `Empresa com CNPJ ${cnpj} não encontrada`, 404);
    return;
  }
  const data = await service.obterEmpresaPorId(empresa.id);
  jsonSuccess(res, data!);
}

export async function cadastroCertificado(req: Request, res: Response): Promise<void> {
  const file = req.file as Express.Multer.File | undefined;
  const senha = (req.body?.senha ?? '').trim();
  const contabilidadeIdRaw = req.body?.contabilidade_id;
  const contabilidadeId =
    contabilidadeIdRaw != null && contabilidadeIdRaw !== ''
      ? parseInt(String(contabilidadeIdRaw), 10)
      : undefined;

  if (!file?.buffer?.length) {
    jsonError(res, 'Arquivo do certificado (.pfx ou .p12) é obrigatório', 400);
    return;
  }
  if (!senha) {
    jsonError(res, 'Senha do certificado é obrigatória', 400);
    return;
  }
  if (contabilidadeId == null || isNaN(contabilidadeId) || contabilidadeId < 1) {
    jsonError(res, 'contabilidade_id é obrigatório e deve ser um número positivo', 400);
    return;
  }
  const ext = (file.originalname || '').toLowerCase();
  if (!ext.endsWith('.pfx') && !ext.endsWith('.p12')) {
    jsonError(res, 'Arquivo deve ser .pfx ou .p12', 400);
    return;
  }

  try {
    const result = await cadastroCertificadoService.cadastrarPorCertificado({
      buffer: file.buffer,
      senha,
      contabilidade_id: contabilidadeId,
    });
    jsonCreated(res, result, 'Certificado cadastrado com sucesso');
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Senha') || msg.includes('password') || msg.includes('decrypt')) {
      jsonError(res, msg, 400);
      return;
    }
    if (msg.includes('CNPJ') || msg.includes('ICP-Brasil')) {
      jsonError(res, msg, 400);
      return;
    }
    throw err;
  }
}

export async function excluirEmMassa(req: Request, res: Response): Promise<void> {
  const body = req.body as { ids?: unknown };
  const rawIds = Array.isArray(body?.ids) ? body.ids : [];
  const ids = rawIds
    .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
    .filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) {
    jsonError(res, 'ids deve ser um array não vazio de IDs válidos', 400);
    return;
  }

  const deleted = await repo.deletarEmMassa(ids);
  jsonSuccess(res, { deleted });
}

export async function summary(req: Request, res: Response): Promise<void> {
  const queryParams = service.parseListarParams(req.query as service.ListarEmpresasQuery);
  const conflito = service.validarFiltrosConflitantes(queryParams);
  if (conflito) {
    jsonError(res, conflito, 400);
    return;
  }
  const summaryParams = {
    search: queryParams.search,
    contabilidade_id: queryParams.contabilidade_id,
    has_cert: queryParams.has_cert,
    has_cred: queryParams.has_cred,
    sem_cert: queryParams.sem_cert,
    sem_cred: queryParams.sem_cred,
    sem_metodo: queryParams.sem_metodo,
  };
  const data = await service.obterSummary(summaryParams);
  jsonSuccess(res, data);
}

export async function exportar(req: Request, res: Response): Promise<void> {
  const result = await service.exportarEmpresas(
    req.query as service.ListarEmpresasQuery
  );
  if ('error' in result) {
    jsonError(res, result.error, result.status);
    return;
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${result.filename}"`
  );
  res.setHeader('X-Export-Total', String(result.total));
  res.setHeader('X-Export-Report', result.report);
  res.send(result.buffer);
}

export async function cadastroCredencial(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const cnpj = typeof body.cnpj === 'string' ? body.cnpj.trim() : '';
  const razao_social = typeof body.razao_social === 'string' ? body.razao_social : undefined;
  const senha = typeof body.senha === 'string' ? body.senha : '';
  let tipo: 'CNPJ_SENHA' | 'CPF_SENHA' =
    typeof body.tipo === 'string' && (body.tipo === 'CNPJ_SENHA' || body.tipo === 'CPF_SENHA')
      ? body.tipo
      : 'CNPJ_SENHA';
  const docDigitos = cnpj.replace(/\D/g, '').length;
  if (docDigitos === 11 && tipo === 'CNPJ_SENHA') {
    tipo = 'CPF_SENHA';
  }
  const usuario = typeof body.usuario === 'string' ? body.usuario : undefined;
  const contabilidade_idRaw = body.contabilidade_id;

  if (!cnpj) {
    jsonError(res, 'cnpj é obrigatório', 400);
    return;
  }
  if (!senha) {
    jsonError(res, 'senha é obrigatória', 400);
    return;
  }
  const contabilidade_id =
    contabilidade_idRaw != null && contabilidade_idRaw !== ''
      ? parseInt(String(contabilidade_idRaw), 10)
      : undefined;
  if (contabilidade_id != null && (isNaN(contabilidade_id) || contabilidade_id < 0)) {
    jsonError(res, 'contabilidade_id deve ser um número positivo', 400);
    return;
  }

  try {
    const result = await cadastroCredencialService.cadastrarPorCredencial({
      cnpj,
      razao_social,
      senha,
      tipo,
      usuario,
      contabilidade_id: contabilidade_id ?? null,
    });
    jsonCreated(res, result, 'Credencial cadastrada com sucesso');
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg.includes('CNPJ') ||
      msg.includes('CPF') ||
      msg.includes('obrigatório') ||
      msg.includes('razao_social') ||
      msg.includes('14 dígitos') ||
      msg.includes('11 dígitos')
    ) {
      jsonError(res, msg, 400);
      return;
    }
    throw err;
  }
}

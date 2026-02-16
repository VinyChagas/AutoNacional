/**
 * Serviço de importação em lote de credenciais via planilha.
 * Fluxo: Preview (session) → Commit (linhas selecionadas + contabilidade).
 */
import { randomUUID } from 'crypto';
import { prisma } from '../../db/client';
import { encryptPassword } from '../../infrastructure/crypto';
import {
  normalizarDocumento,
  validarCNPJ,
  validarCPF,
  cnpjParaEmpresa,
} from '../../utils/documento.utils';
import { formatarDocumento } from '../../utils/documento.utils';
import { parsePlanilhaCredenciais, type LinhaCredencial } from '../../utils/planilha.parser';

export type AcaoPreview =
  | 'CRIAR_EMPRESA'
  | 'CRIAR_CREDENCIAL'
  | 'ATUALIZAR_CREDENCIAL'
  | 'ERRO';

export interface PreviewRowCred {
  rowIndex: number;
  linha: number;
  razao_social: string;
  tipo_login: 'CNPJ' | 'CPF';
  documento_raw: string;
  documento_digits: string;
  documento_formatado: string;
  regime: string | null;
  senha_masked: true;
  exists: boolean;
  valid: boolean;
  errors: string[];
  duplicado_na_planilha?: boolean;
}

export interface PreviewItemCred {
  linha: number;
  razao_social: string;
  documento: string;
  tipo: string;
  existe_empresa: boolean;
  existe_credencial: boolean;
  acao: AcaoPreview;
  erro?: string;
}

export interface PreviewCredenciaisResult {
  session_id: string;
  total: number;
  validos: number;
  erros: number;
  items: PreviewItemCred[];
  rows: PreviewRowCred[];
}

interface SessionData {
  linhas: LinhaCredencial[];
  items: PreviewItemCred[];
  rows: PreviewRowCred[];
  createdAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const sessions = new Map<string, SessionData>();

function limparSessionsExpiradas(): void {
  const agora = Date.now();
  for (const [id, data] of sessions.entries()) {
    if (agora - data.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

function getSession(sessionId: string): SessionData | null {
  limparSessionsExpiradas();
  const data = sessions.get(sessionId);
  if (!data) return null;
  if (Date.now() - data.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return data;
}

export async function previewCredenciais(
  buffer: Buffer
): Promise<PreviewCredenciaisResult> {
  const linhas = parsePlanilhaCredenciais(buffer);
  const items: PreviewItemCred[] = [];
  const rows: PreviewRowCred[] = [];
  let validos = 0;
  let erros = 0;

  const docsNaPlanilha = new Map<string, number>();
  const cnpjEmpresas = linhas.map((r) => {
    const t = r.tipo_login === 'CPF' ? 'CPF' : 'CNPJ';
    return cnpjParaEmpresa(r.cnpj_ou_cpf, t);
  });
  const empresasExistentes = await prisma.empresa.findMany({
    where: { cnpj: { in: [...new Set(cnpjEmpresas)] } },
    select: { cnpj: true },
  });
  const cnpjExists = new Set(empresasExistentes.map((e) => e.cnpj));

  for (let idx = 0; idx < linhas.length; idx++) {
    const row = linhas[idx];
    const doc = normalizarDocumento(row.cnpj_ou_cpf);
    const tipoRaw = String(row.tipo_login ?? 'CNPJ').toUpperCase().trim();
    const tipo: 'CNPJ' | 'CPF' =
      tipoRaw === 'CPF' ? 'CPF' : tipoRaw === 'CNPJ' ? 'CNPJ' : 'CNPJ';
    const cnpjEmp = cnpjParaEmpresa(row.cnpj_ou_cpf, tipo);
    const errors: string[] = [];
    let valid = true;

    const firstLinha = docsNaPlanilha.get(cnpjEmp);
    const duplicadoNaPlanilha = firstLinha !== undefined;
    if (!duplicadoNaPlanilha) docsNaPlanilha.set(cnpjEmp, row.linha);
    else errors.push('Documento duplicado na planilha');

    if (tipoRaw !== 'CNPJ' && tipoRaw !== 'CPF') {
      errors.push('Tipo de Login deve ser CNPJ ou CPF');
      valid = false;
    }
    if (!row.razao_social?.trim()) {
      errors.push('Razão Social é obrigatória');
      valid = false;
    }
    if (tipo === 'CNPJ' && !validarCNPJ(row.cnpj_ou_cpf)) {
      errors.push('CNPJ deve conter 14 dígitos');
      valid = false;
    }
    if (tipo === 'CPF' && !validarCPF(row.cnpj_ou_cpf)) {
      errors.push('CPF deve conter 11 dígitos');
      valid = false;
    }
    if (!row.senha?.trim()) {
      errors.push('Senha é obrigatória');
      valid = false;
    } else if (row.senha.trim().length < 3) {
      errors.push('Senha deve ter no mínimo 3 caracteres');
      valid = false;
    }

    const exists = cnpjExists.has(cnpjEmp);
    const finalValid = valid && !duplicadoNaPlanilha;
    if (finalValid) validos++;
    else erros++;

    let acao: AcaoPreview = finalValid ? (exists ? 'ATUALIZAR_CREDENCIAL' : 'CRIAR_EMPRESA') : 'ERRO';

    items.push({
      linha: row.linha,
      razao_social: row.razao_social,
      documento: doc,
      tipo,
      existe_empresa: exists,
      existe_credencial: false,
      acao,
      erro: errors[0],
    });

    rows.push({
      rowIndex: idx,
      linha: row.linha,
      razao_social: row.razao_social,
      tipo_login: tipo,
      documento_raw: row.cnpj_ou_cpf,
      documento_digits: doc,
      documento_formatado: formatarDocumento(row.cnpj_ou_cpf, tipo),
      regime: row.regime?.trim() || null,
      senha_masked: true,
      exists,
      valid: finalValid,
      errors,
      duplicado_na_planilha: duplicadoNaPlanilha,
    });
  }

  const session_id = randomUUID();
  sessions.set(session_id, {
    linhas,
    items,
    rows,
    createdAt: Date.now(),
  });

  return {
    session_id,
    total: linhas.length,
    validos,
    erros,
    items,
    rows,
  };
}

export interface CommitRowInput {
  rowIndex: number;
  contabilidade_id?: number;
}

export interface ConfirmarCredenciaisInput {
  session_id: string;
  linhas_aprovadas?: number[];
  contabilidade_id_default: number;
  updateExisting: boolean;
  rows?: CommitRowInput[];
}

export interface CommitResultItem {
  rowIndex: number;
  status: 'IMPORTED' | 'UPDATED' | 'SKIPPED_EXISTS' | 'ERROR';
  message?: string;
}

export interface ConfirmarCredenciaisResult {
  success: true;
  criadas: number;
  atualizadas: number;
  erros: number;
  skipped: number;
  results: CommitResultItem[];
}

export async function confirmarCredenciais(
  input: ConfirmarCredenciaisInput
): Promise<ConfirmarCredenciaisResult> {
  const session = getSession(input.session_id);
  if (!session) {
    throw new Error('Sessão inválida ou expirada. Faça o preview novamente.');
  }

  const contabDefault = input.contabilidade_id_default;
  if (!contabDefault || contabDefault < 1) {
    throw new Error('Contabilidade é obrigatória para importar.');
  }

  const rowOverrides = new Map<number, number>();
  if (Array.isArray(input.rows)) {
    for (const r of input.rows) {
      if (r.contabilidade_id != null && r.contabilidade_id > 0) {
        rowOverrides.set(r.rowIndex, r.contabilidade_id);
      }
    }
  }

  const indicesAprovados = new Set<number>(
    Array.isArray(input.rows) && input.rows.length > 0
      ? input.rows.map((r) => r.rowIndex)
      : (input.linhas_aprovadas ?? []).map((linha) =>
          session.linhas.findIndex((l) => l.linha === linha)
        ).filter((i) => i >= 0)
  );

  const results: CommitResultItem[] = [];
  let criadas = 0;
  let atualizadas = 0;
  let erros = 0;
  let skipped = 0;

  for (let idx = 0; idx < session.linhas.length; idx++) {
    if (!indicesAprovados.has(idx)) continue;

    const row = session.linhas[idx];
    const rowPreview = session.rows?.[idx];
    const contabId = rowOverrides.get(idx) ?? contabDefault;

    if (!row) {
      results.push({ rowIndex: idx, status: 'ERROR', message: 'Linha não encontrada' });
      erros++;
      continue;
    }

    if (rowPreview && !rowPreview.valid) {
      results.push({
        rowIndex: idx,
        status: 'ERROR',
        message: rowPreview.errors?.[0] ?? 'Linha inválida',
      });
      erros++;
      continue;
    }

    try {
      const doc = normalizarDocumento(row.cnpj_ou_cpf);
      const tipo = row.tipo_login;
      const cnpjEmp = cnpjParaEmpresa(row.cnpj_ou_cpf, tipo);
      const tipoCred = tipo === 'CPF' ? 'CPF_SENHA' : 'CNPJ_SENHA';

      let empresa = await prisma.empresa.findUnique({
        where: { cnpj: cnpjEmp },
      });

      if (empresa && !input.updateExisting) {
        const credExist = await prisma.credencial.findUnique({
          where: { empresaId_tipo: { empresaId: empresa.id, tipo: tipoCred } },
        });
        if (credExist) {
          results.push({
            rowIndex: idx,
            status: 'SKIPPED_EXISTS',
            message: 'Empresa já possui credenciais cadastradas',
          });
          skipped++;
          continue;
        }
      }

      if (!empresa) {
        empresa = await prisma.empresa.create({
          data: {
            cnpj: cnpjEmp,
            razaoSocial: row.razao_social.trim(),
            regime: row.regime?.trim() || null,
            contabilidadeId: contabId,
          },
        });
        // Não incrementar aqui - contamos por linha/credencial, não por operação de empresa
      } else {
        const updates: { razaoSocial?: string; regime?: string | null; contabilidadeId?: number } = {};
        const razaoNova = row.razao_social?.trim();
        const regimeNovo = row.regime?.trim() || null;
        if (razaoNova && razaoNova !== empresa.razaoSocial) {
          updates.razaoSocial = razaoNova;
        }
        if (regimeNovo !== (empresa.regime ?? null)) {
          updates.regime = regimeNovo;
        }
        if (contabId && contabId !== (empresa.contabilidadeId ?? null)) {
          updates.contabilidadeId = contabId;
        }
        if (Object.keys(updates).length > 0) {
          await prisma.empresa.update({
            where: { id: empresa.id },
            data: updates,
          });
        }
      }

      const senhaCriptografada = encryptPassword(row.senha);
      const credencial = await prisma.credencial.findUnique({
        where: { empresaId_tipo: { empresaId: empresa!.id, tipo: tipoCred } },
      });

      if (credencial) {
        await prisma.credencial.update({
          where: { id: credencial.id },
          data: { usuario: doc, senhaCriptografada },
        });
        atualizadas++; // 1 linha atualizada
        results.push({ rowIndex: idx, status: 'UPDATED', message: 'Credenciais atualizadas' });
      } else {
        await prisma.credencial.create({
          data: {
            empresaId: empresa!.id,
            tipo: tipoCred,
            usuario: doc,
            senhaCriptografada,
          },
        });
        criadas++; // 1 linha importada (empresa nova ou credencial nova)
        results.push({ rowIndex: idx, status: 'IMPORTED', message: 'Importado com sucesso' });
      }
    } catch (e) {
      const msg = (e as Error).message;
      results.push({ rowIndex: idx, status: 'ERROR', message: msg });
      erros++;
    }
  }

  sessions.delete(input.session_id);

  return {
    success: true,
    criadas,
    atualizadas,
    erros,
    skipped,
    results,
  };
}

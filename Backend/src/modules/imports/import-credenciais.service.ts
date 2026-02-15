/**
 * Serviço de importação em lote de credenciais via planilha.
 * Fluxo: Preview (session) → Confirmar (linhas aprovadas).
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
import { parsePlanilhaCredenciais, type LinhaCredencial } from '../../utils/planilha.parser';

export type AcaoPreview =
  | 'CRIAR_EMPRESA'
  | 'CRIAR_CREDENCIAL'
  | 'ATUALIZAR_CREDENCIAL'
  | 'ERRO';

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
}

interface SessionData {
  linhas: LinhaCredencial[];
  items: PreviewItemCred[];
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
  let validos = 0;
  let erros = 0;

  for (const row of linhas) {
    const doc = normalizarDocumento(row.cnpj_ou_cpf);
    const tipoRaw = String(row.tipo_login ?? 'CNPJ').toUpperCase().trim();
    const tipo: 'CNPJ' | 'CPF' =
      tipoRaw === 'CPF' ? 'CPF' : tipoRaw === 'CNPJ' ? 'CNPJ' : 'CNPJ';

    // Validar Tipo de Login
    if (tipoRaw !== 'CNPJ' && tipoRaw !== 'CPF') {
      items.push({
        linha: row.linha,
        razao_social: row.razao_social,
        documento: row.cnpj_ou_cpf,
        tipo: tipoRaw || '(vazio)',
        existe_empresa: false,
        existe_credencial: false,
        acao: 'ERRO',
        erro: 'Tipo de Login deve ser CNPJ ou CPF',
      });
      erros++;
      continue;
    }

    // Validar Razão Social
    if (!row.razao_social?.trim()) {
      items.push({
        linha: row.linha,
        razao_social: row.razao_social || '',
        documento: doc,
        tipo,
        existe_empresa: false,
        existe_credencial: false,
        acao: 'ERRO',
        erro: 'Razão Social é obrigatória',
      });
      erros++;
      continue;
    }

    // Validar documento
    if (tipo === 'CNPJ' && !validarCNPJ(row.cnpj_ou_cpf)) {
      items.push({
        linha: row.linha,
        razao_social: row.razao_social,
        documento: doc || '(vazio)',
        tipo,
        existe_empresa: false,
        existe_credencial: false,
        acao: 'ERRO',
        erro: 'CNPJ deve conter 14 dígitos',
      });
      erros++;
      continue;
    }
    if (tipo === 'CPF' && !validarCPF(row.cnpj_ou_cpf)) {
      items.push({
        linha: row.linha,
        razao_social: row.razao_social,
        documento: doc || '(vazio)',
        tipo,
        existe_empresa: false,
        existe_credencial: false,
        acao: 'ERRO',
        erro: 'CPF deve conter 11 dígitos',
      });
      erros++;
      continue;
    }

    // Validar Senha
    if (!row.senha?.trim()) {
      items.push({
        linha: row.linha,
        razao_social: row.razao_social,
        documento: doc,
        tipo,
        existe_empresa: false,
        existe_credencial: false,
        acao: 'ERRO',
        erro: 'Senha é obrigatória',
      });
      erros++;
      continue;
    }

    const cnpjEmp = cnpjParaEmpresa(row.cnpj_ou_cpf, tipo);
    const tipoCred = tipo === 'CPF' ? 'CPF_SENHA' : 'CNPJ_SENHA';

    const empresa = await prisma.empresa.findUnique({
      where: { cnpj: cnpjEmp },
    });
    const credencial =
      empresa &&
      (await prisma.credencial.findUnique({
        where: { empresaId_tipo: { empresaId: empresa.id, tipo: tipoCred } },
      }));

    const existe_empresa = !!empresa;
    const existe_credencial = !!credencial;

    let acao: AcaoPreview;
    if (!empresa) {
      acao = 'CRIAR_EMPRESA';
    } else if (!credencial) {
      acao = 'CRIAR_CREDENCIAL';
    } else {
      acao = 'ATUALIZAR_CREDENCIAL';
    }

    items.push({
      linha: row.linha,
      razao_social: row.razao_social,
      documento: doc,
      tipo,
      existe_empresa,
      existe_credencial,
      acao,
    });
    validos++;
  }

  const session_id = randomUUID();
  sessions.set(session_id, {
    linhas,
    items,
    createdAt: Date.now(),
  });

  return {
    session_id,
    total: linhas.length,
    validos,
    erros,
    items,
  };
}

export interface ConfirmarCredenciaisInput {
  session_id: string;
  linhas_aprovadas: number[];
}

export interface ConfirmarCredenciaisResult {
  success: true;
  criadas: number;
  atualizadas: number;
  erros: number;
}

export async function confirmarCredenciais(
  input: ConfirmarCredenciaisInput
): Promise<ConfirmarCredenciaisResult> {
  const session = getSession(input.session_id);
  if (!session) {
    throw new Error('Sessão inválida ou expirada. Faça o preview novamente.');
  }

  const linhasAprovadas = new Set(input.linhas_aprovadas);
  const linhasParaProcessar = session.linhas.filter((l) =>
    linhasAprovadas.has(l.linha)
  );

  // Validar que as linhas aprovadas não têm ERRO
  const itensValidos = session.items.filter(
    (i) => linhasAprovadas.has(i.linha) && i.acao !== 'ERRO'
  );
  if (itensValidos.length !== linhasParaProcessar.length) {
    throw new Error('Algumas linhas aprovadas contêm erro. Faça o preview novamente.');
  }

  let criadas = 0;
  let atualizadas = 0;
  let erros = 0;

  for (const row of linhasParaProcessar) {
    try {
      const doc = normalizarDocumento(row.cnpj_ou_cpf);
      const tipo = row.tipo_login;
      const cnpjEmp = cnpjParaEmpresa(row.cnpj_ou_cpf, tipo);
      const tipoCred = tipo === 'CPF' ? 'CPF_SENHA' : 'CNPJ_SENHA';

      let empresa = await prisma.empresa.findUnique({
        where: { cnpj: cnpjEmp },
      });

      if (!empresa) {
        empresa = await prisma.empresa.create({
          data: {
            cnpj: cnpjEmp,
            razaoSocial: row.razao_social.trim(),
            regime: row.regime?.trim() || null,
          },
        });
        criadas++;
      } else {
        const updates: { razaoSocial?: string; regime?: string | null } = {};
        const razaoNova = row.razao_social?.trim();
        const regimeNovo = row.regime?.trim() || null;
        if (razaoNova && razaoNova !== empresa.razaoSocial) {
          updates.razaoSocial = razaoNova;
        }
        if (regimeNovo !== (empresa.regime ?? null)) {
          updates.regime = regimeNovo;
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
        where: { empresaId_tipo: { empresaId: empresa.id, tipo: tipoCred } },
      });

      if (credencial) {
        await prisma.credencial.update({
          where: { id: credencial.id },
          data: { usuario: doc, senhaCriptografada },
        });
        atualizadas++;
      } else {
        await prisma.credencial.create({
          data: {
            empresaId: empresa.id,
            tipo: tipoCred,
            usuario: doc,
            senhaCriptografada,
          },
        });
        criadas++;
      }
    } catch (e) {
      erros++;
      // Não interrompe o processamento
    }
  }

  sessions.delete(input.session_id);

  return {
    success: true,
    criadas,
    atualizadas,
    erros,
  };
}

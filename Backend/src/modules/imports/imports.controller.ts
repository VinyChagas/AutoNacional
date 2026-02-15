/**
 * Controller de importações (Preview + Confirmar).
 */
import { Request, Response } from 'express';
import { jsonSuccess, jsonError, jsonCreated } from '../../middleware/response';
import * as certService from './import-certificados.service';
import * as credService from './import-credenciais.service';

// --- Certificados em lote ---

export async function previewCertificados(
  req: Request,
  res: Response
): Promise<void> {
  const files = (req.files ?? []) as Express.Multer.File[];
  const senha = (req.body?.senha ?? '').trim();

  if (!senha) {
    jsonError(res, 'Campo "senha" é obrigatório', 400);
    return;
  }
  if (!files?.length) {
    jsonError(
      res,
      'Envie um ou mais arquivos .pfx ou .p12 no campo "files"',
      400
    );
    return;
  }

  try {
    const result = await certService.previewCertificados(files, senha);
    jsonSuccess(res, result);
  } catch (e) {
    jsonError(res, (e as Error).message, 400);
  }
}

export async function confirmarCertificados(
  req: Request,
  res: Response
): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const session_id =
    typeof body.session_id === 'string' ? body.session_id.trim() : '';
  const senha = typeof body.senha === 'string' ? body.senha.trim() : '';
  const itensRaw = Array.isArray(body.itens) ? body.itens : [];
  const contabilidade_id =
    body.contabilidade_id != null && body.contabilidade_id !== ''
      ? parseInt(String(body.contabilidade_id), 10)
      : undefined;

  if (!session_id) {
    jsonError(res, 'session_id é obrigatório', 400);
    return;
  }
  if (!senha) {
    jsonError(res, 'senha é obrigatória no confirmar', 400);
    return;
  }
  const itens = itensRaw
    .filter(
      (x): x is Record<string, number> =>
        x != null && typeof x === 'object' && 'indice' in x
    )
    .map((x) => ({ indice: Number(x.indice) }))
    .filter((x) => !isNaN(x.indice));

  if (itens.length === 0) {
    jsonError(res, 'Envie ao menos um item em itens com { indice }', 400);
    return;
  }

  try {
    const result = await certService.confirmarCertificados({
      session_id,
      senha,
      itens,
      contabilidade_id:
        contabilidade_id != null && !isNaN(contabilidade_id) && contabilidade_id > 0
          ? contabilidade_id
          : undefined,
    });
    jsonCreated(res, result, 'Importação de certificados concluída');
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('expirada') || msg.includes('inválida')) {
      jsonError(res, msg, 400);
      return;
    }
    throw e;
  }
}

// --- Credenciais via planilha ---

export async function previewCredenciais(
  req: Request,
  res: Response
): Promise<void> {
  const file = req.file as Express.Multer.File | undefined;
  if (!file?.buffer?.length) {
    jsonError(res, 'Envie um arquivo .xlsx ou .csv no campo "arquivo"', 400);
    return;
  }
  const ext = (file.originalname || '').toLowerCase();
  if (
    !ext.endsWith('.xlsx') &&
    !ext.endsWith('.xls') &&
    !ext.endsWith('.csv')
  ) {
    jsonError(res, 'Arquivo deve ser .xlsx, .xls ou .csv', 400);
    return;
  }

  try {
    const result = await credService.previewCredenciais(file.buffer);
    jsonSuccess(res, result);
  } catch (e) {
    jsonError(res, (e as Error).message, 400);
  }
}

export async function confirmarCredenciais(
  req: Request,
  res: Response
): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const session_id =
    typeof body.session_id === 'string' ? body.session_id.trim() : '';
  const linhasRaw = Array.isArray(body.linhas_aprovadas)
    ? body.linhas_aprovadas
    : [];

  const linhas_aprovadas = linhasRaw
    .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
    .filter((n) => !isNaN(n) && n > 0);

  if (!session_id) {
    jsonError(res, 'session_id é obrigatório', 400);
    return;
  }
  if (linhas_aprovadas.length === 0) {
    jsonError(res, 'Envie ao menos uma linha em linhas_aprovadas', 400);
    return;
  }

  try {
    const result = await credService.confirmarCredenciais({
      session_id,
      linhas_aprovadas,
    });
    jsonCreated(res, result, 'Importação de credenciais concluída');
  } catch (e) {
    jsonError(res, (e as Error).message, 400);
  }
}

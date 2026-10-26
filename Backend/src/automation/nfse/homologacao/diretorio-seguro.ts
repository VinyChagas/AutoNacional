/**
 * Validação de diretório fiscal autorizado (H2.2.1).
 * Absoluto, sem path traversal, sem escape por symlink.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { HomologacaoNfseError } from './types';

/**
 * Resolve e valida caminho absoluto autorizado.
 * Se `raizPermitida` for informada, o destino deve permanecer dentro dela (realpath).
 */
export async function validarDiretorioFiscalSeguro(entrada: {
  diretorioFiscal: string;
  raizPermitida?: string;
  criarSeAusente?: boolean;
}): Promise<string> {
  const bruto = entrada.diretorioFiscal?.trim() ?? '';
  if (!bruto) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Diretório fiscal ausente.');
  }
  if (bruto.includes('\0')) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Diretório fiscal contém byte nulo.');
  }
  if (pathHasTraversal(bruto)) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Path traversal detectado no diretório fiscal.');
  }

  const absoluto = path.resolve(bruto);
  if (!path.isAbsolute(absoluto)) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Diretório fiscal deve ser absoluto.');
  }

  if (entrada.criarSeAusente) {
    await fs.mkdir(absoluto, { recursive: true });
  }

  let real: string;
  try {
    real = await fs.realpath(absoluto);
  } catch {
    // Ainda não existe: valida o caminho resolvido sem realpath.
    real = absoluto;
  }

  if (entrada.raizPermitida) {
    const raizAbs = path.resolve(entrada.raizPermitida.trim());
    let raizReal = raizAbs;
    try {
      raizReal = await fs.realpath(raizAbs);
    } catch {
      raizReal = raizAbs;
    }
    const relativo = path.relative(raizReal, real);
    if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
      throw new HomologacaoNfseError(
        'DIRETORIO_INSEGURO',
        'Diretório fiscal escapa da raiz autorizada (possível symlink).'
      );
    }
  }

  return real;
}

/** Garante que `candidato` permanece sob `diretorioAutorizado` após resolve/realpath. */
export async function garantirDentroDoDiretorioAutorizado(
  diretorioAutorizado: string,
  candidato: string
): Promise<string> {
  const raiz = await validarDiretorioFiscalSeguro({ diretorioFiscal: diretorioAutorizado });
  if (pathHasTraversal(candidato)) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Path traversal no caminho candidato.');
  }
  const destino = path.resolve(raiz, candidato);
  let realDestino = destino;
  try {
    realDestino = await fs.realpath(destino);
  } catch {
    realDestino = destino;
  }
  const relativo = path.relative(raiz, realDestino);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Escrita fora do diretório autorizado recusada.'
    );
  }
  return realDestino;
}

function pathHasTraversal(valor: string): boolean {
  const normalizado = valor.replace(/\\/g, '/');
  return normalizado.split('/').some((seg) => seg === '..');
}

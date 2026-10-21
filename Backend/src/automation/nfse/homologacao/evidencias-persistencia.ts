/**
 * Persistência atômica de evidências de homologação no diretório autorizado.
 * Append-only: nunca sobrescreve arquivos existentes.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { raizFiscalDistintaDeDownloads } from '../infrastructure/storage-resolver';
import { evidenciaContemSegredo } from './evidencias';
import {
  HomologacaoNfseError,
  type EvidenciaHomologacaoSegura,
  type ResultadoDiscoveryOnlyHomologacao,
} from './types';

export interface PersistenciaEvidenciasHomologacao {
  readonly caminho: string;
  readonly bytes: number;
}

/**
 * Grava um pacote JSON de evidências + resumo do resultado.
 * Escrita: arquivo.tmp → rename atômico. Falha se o destino já existir.
 */
export async function persistirEvidenciasHomologacao(entrada: {
  diretorioFiscal: string;
  execucaoId: string;
  evidencias: readonly EvidenciaHomologacaoSegura[];
  resultado: Pick<
    ResultadoDiscoveryOnlyHomologacao,
    | 'veredito'
    | 'totais'
    | 'estadoInventario'
    | 'diagnosticos'
    | 'limitesAplicados'
    | 'codigoErro'
    | 'cnpjMascarado'
    | 'periodoConsulta'
    | 'efeitosProibidos'
  >;
  agora?: Date;
}): Promise<PersistenciaEvidenciasHomologacao> {
  const diretorio = entrada.diretorioFiscal.trim();
  if (!diretorio) {
    throw new HomologacaoNfseError('FALHA_EVIDENCIA', 'Diretório fiscal ausente para evidências.');
  }
  if (!raizFiscalDistintaDeDownloads(diretorio, './downloads')) {
    throw new HomologacaoNfseError(
      'FALHA_EVIDENCIA',
      'Diretório de evidências não pode coincidir com downloads operacionais.'
    );
  }

  for (const ev of entrada.evidencias) {
    if (evidenciaContemSegredo(ev)) {
      throw new HomologacaoNfseError(
        'FALHA_EVIDENCIA',
        'Evidência contém campo proibido; persistência recusada.'
      );
    }
  }

  const agora = entrada.agora ?? new Date();
  const stamp = agora.toISOString().replace(/[:.]/g, '-');
  const nome = `evidencia-h2-${sanitizeId(entrada.execucaoId)}-${stamp}.json`;
  const destino = path.join(diretorio, 'homologacao', nome);
  const temporario = `${destino}.tmp-${process.pid}`;

  const pacote = {
    versao: 1 as const,
    execucaoId: entrada.execucaoId,
    cnpjMascarado: entrada.resultado.cnpjMascarado,
    periodoConsulta: entrada.resultado.periodoConsulta,
    registradoEm: agora.toISOString(),
    veredito: entrada.resultado.veredito,
    estadoInventario: entrada.resultado.estadoInventario,
    totais: entrada.resultado.totais,
    diagnosticos: entrada.resultado.diagnosticos,
    limitesAplicados: entrada.resultado.limitesAplicados,
    codigoErro: entrada.resultado.codigoErro,
    efeitosProibidos: entrada.resultado.efeitosProibidos,
    evidencias: entrada.evidencias,
  };

  const corpo = `${JSON.stringify(pacote, null, 2)}\n`;

  try {
    await fs.mkdir(path.dirname(destino), { recursive: true });
    try {
      await fs.access(destino);
      throw new HomologacaoNfseError(
        'FALHA_EVIDENCIA',
        'Arquivo de evidência já existe; sobrescrita recusada.'
      );
    } catch (erro) {
      if (erro instanceof HomologacaoNfseError) throw erro;
      // ENOENT esperado — destino livre.
    }

    await fs.writeFile(temporario, corpo, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporario, destino);
    return { caminho: destino, bytes: Buffer.byteLength(corpo, 'utf8') };
  } catch (erro) {
    await fs.unlink(temporario).catch(() => undefined);
    if (erro instanceof HomologacaoNfseError) throw erro;
    const msg = erro instanceof Error ? erro.message : 'Falha ao persistir evidências.';
    throw new HomologacaoNfseError('FALHA_EVIDENCIA', sanitizarErroEscrita(msg));
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'exec';
}

function sanitizarErroEscrita(mensagem: string): string {
  return mensagem
    .replace(/senha[=:\s]\S+/gi, 'senha=***')
    .replace(/\b\d{50}\b/g, '[chave-omitida]')
    .slice(0, 200);
}

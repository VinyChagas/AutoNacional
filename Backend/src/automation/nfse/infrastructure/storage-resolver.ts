/**
 * Resolução da raiz fiscal isolada.
 * Não usa o diretório operacional de downloads (`./downloads`).
 * Não há variável de ambiente dedicada nesta etapa: a raiz é injetada.
 */
import path from 'node:path';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import { resolverCaminhoSeguro, segmentoPeriodo } from '../checkpoint/types';
import { InfraestruturaNfseError } from './types';

export interface ResolvedorArmazenamentoFiscal {
  /** Raiz absoluta do repositório fiscal isolado. */
  raiz(): string;
  raizCheckpoints(): string;
  raizXml(): string;
  raizAuditoria(): string;
  diretorioPeriodo(cnpj: string, periodo: PeriodoConsultaPortal): string;
}

/**
 * Resolvedor com raiz injetada.
 * Recusa raiz vazia, relativa sem normalização e caminhos com `..`.
 */
export function criarResolvedorRaizInjetada(raizInformada: string): ResolvedorArmazenamentoFiscal {
  const raiz = validarRaiz(raizInformada);
  return {
    raiz: () => raiz,
    raizCheckpoints: () => path.join(raiz, 'checkpoints'),
    raizXml: () => path.join(raiz, 'xml'),
    raizAuditoria: () => path.join(raiz, 'auditoria'),
    diretorioPeriodo(cnpj: string, periodo: PeriodoConsultaPortal) {
      if (!/^\d{14}$/.test(cnpj)) {
        throw new InfraestruturaNfseError('CNPJ_INVALIDO', 'CNPJ inválido para resolver armazenamento.');
      }
      return resolverCaminhoSeguro(raiz, [cnpj, segmentoPeriodo(periodo)]);
    },
  };
}

/**
 * Confirma que a raiz fiscal não é o download operacional.
 * Comparação por path.resolve, sem criar diretórios.
 */
export function raizFiscalDistintaDeDownloads(
  raizFiscal: string,
  downloadsBasePath: string
): boolean {
  const fiscal = path.resolve(raizFiscal);
  const downloads = path.resolve(downloadsBasePath);
  if (fiscal === downloads) return false;
  const relativo = path.relative(downloads, fiscal);
  if (relativo === '' || (!relativo.startsWith('..') && !path.isAbsolute(relativo))) {
    return false;
  }
  return true;
}

function validarRaiz(raizInformada: string): string {
  if (typeof raizInformada !== 'string' || !raizInformada.trim()) {
    throw new InfraestruturaNfseError('RAIZ_INVALIDA', 'Raiz fiscal ausente.');
  }
  const raiz = path.resolve(raizInformada.trim());
  if (raiz.includes('\0')) {
    throw new InfraestruturaNfseError('RAIZ_INVALIDA', 'Raiz fiscal inválida.');
  }
  const base = path.basename(raiz);
  if (base === '..' || base === '.') {
    throw new InfraestruturaNfseError('RAIZ_INVALIDA', 'Raiz fiscal inválida.');
  }
  return raiz;
}

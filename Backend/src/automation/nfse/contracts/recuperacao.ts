/**
 * Recuperação do XML de cada documento do inventário.
 * Nesta etapa o plano só aplica a regra fiscal: não há chamada SEFIN.
 */
import { validarChaveNacional, entraNaRecuperacaoSefin } from './documento-fiscal';
import { ContratoNfseError } from './erros';
import type { InventarioNfse } from './inventario';

export const RESULTADOS_RECUPERACAO = [
  'RECUPERADO',
  'REUTILIZADO',
  'PENDENTE',
  'FALHOU',
  'BLOQUEADO',
] as const;
export type ResultadoRecuperacaoXml = (typeof RESULTADOS_RECUPERACAO)[number];

export interface RecuperacaoDocumento {
  chaveNacional: string;
  resultado: ResultadoRecuperacaoXml;
  caminhoXml?: string;
  hashSha256?: string;
  motivoFalha?: string;
}

export interface NovaRecuperacaoInput {
  chaveNacional: string;
  resultado: ResultadoRecuperacaoXml;
  caminhoXml?: string;
  hashSha256?: string;
  motivoFalha?: string;
}

const HASH_SHA256 = /^[a-f0-9]{64}$/;

export function xmlRecuperadoUtilizavel(item: RecuperacaoDocumento): boolean {
  return (
    (item.resultado === 'RECUPERADO' || item.resultado === 'REUTILIZADO') &&
    Boolean(item.caminhoXml) &&
    Boolean(item.hashSha256 && HASH_SHA256.test(item.hashSha256))
  );
}

export function criarRecuperacaoDocumento(input: NovaRecuperacaoInput): RecuperacaoDocumento {
  if (!(RESULTADOS_RECUPERACAO as readonly string[]).includes(input.resultado)) {
    throw new ContratoNfseError(`Resultado de recuperação não permitido: ${input.resultado}.`);
  }

  const caminhoXml = input.caminhoXml?.trim() || undefined;
  const hashSha256 = input.hashSha256?.trim().toLowerCase() || undefined;
  const motivoFalha = input.motivoFalha?.trim() || undefined;

  if (hashSha256 && !HASH_SHA256.test(hashSha256)) {
    throw new ContratoNfseError('Hash SHA-256 inválido: esperado 64 caracteres hexadecimais.');
  }

  const comArquivo = Boolean(caminhoXml && hashSha256);
  if (input.resultado === 'RECUPERADO' || input.resultado === 'REUTILIZADO') {
    if (!comArquivo) {
      throw new ContratoNfseError(
        `${input.resultado} exige caminho do XML e hash SHA-256.`
      );
    }
    if (motivoFalha) {
      throw new ContratoNfseError(`${input.resultado} não registra motivo de falha.`);
    }
  }

  if (input.resultado === 'PENDENTE') {
    if (caminhoXml || hashSha256 || motivoFalha) {
      throw new ContratoNfseError('PENDENTE ainda não possui XML nem motivo de falha.');
    }
  }

  if (input.resultado === 'FALHOU' || input.resultado === 'BLOQUEADO') {
    if (caminhoXml || hashSha256) {
      throw new ContratoNfseError(`${input.resultado} não entrega XML utilizável.`);
    }
    if (!motivoFalha) {
      throw new ContratoNfseError(`${input.resultado} exige motivo.`);
    }
  }

  return {
    chaveNacional: validarChaveNacional(input.chaveNacional),
    resultado: input.resultado,
    caminhoXml,
    hashSha256,
    motivoFalha,
  };
}

/**
 * Plano inicial, antes de qualquer download.
 * API-03M — vigente e indeterminada ficam PENDENTE (SEFIN).
 * Cancelada sai do plano (não entra em entraNaRecuperacaoSefin).
 */
export function montarPlanoRecuperacao(inventario: InventarioNfse): RecuperacaoDocumento[] {
  const plano: RecuperacaoDocumento[] = [];

  for (const documento of inventario.documentos) {
    if (!entraNaRecuperacaoSefin(documento)) {
      continue;
    }

    plano.push(
      criarRecuperacaoDocumento({
        chaveNacional: documento.chaveNacional,
        resultado: 'PENDENTE',
      })
    );
  }

  return plano;
}

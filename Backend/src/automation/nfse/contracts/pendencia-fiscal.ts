/**
 * API-03M — pendência fiscal estruturada (distinta da validade documental).
 * Sem credenciais / cookies / tokens.
 */
export const CODIGOS_PENDENCIA_FISCAL = [
  'ATENCAO_SITUACAO_NAO_CONFIRMADA',
  'XML_INDETERMINADA_NAO_RECUPERADO',
  'BLOQUEIO_VALIDACAO_DOCUMENTAL',
] as const;

export type CodigoPendenciaFiscal = (typeof CODIGOS_PENDENCIA_FISCAL)[number];

export interface PendenciaFiscalNfse {
  chaveAcesso: string;
  numeroNota: string | null;
  direcao: 'EMITIDA' | 'RECEBIDA' | null;
  codigo: CodigoPendenciaFiscal;
  motivo: string;
  xmlRecuperado: boolean;
  documentoExportado: boolean;
}

export function rotuloCodigoPendenciaFiscal(codigo: CodigoPendenciaFiscal): string {
  switch (codigo) {
    case 'ATENCAO_SITUACAO_NAO_CONFIRMADA':
      return 'Atenção — situação fiscal não confirmada (XML recuperado)';
    case 'XML_INDETERMINADA_NAO_RECUPERADO':
      return 'Situação indeterminada — XML não recuperado';
    case 'BLOQUEIO_VALIDACAO_DOCUMENTAL':
      return 'Bloqueio — validação documental falhou';
    default:
      return codigo;
  }
}

export function serializarPendenciaFiscalParaApi(p: PendenciaFiscalNfse): {
  chave_acesso: string;
  numero_nota: string | null;
  direcao: string | null;
  codigo: CodigoPendenciaFiscal;
  motivo: string;
  xml_recuperado: boolean;
  documento_exportado: boolean;
} {
  return {
    chave_acesso: p.chaveAcesso,
    numero_nota: p.numeroNota,
    direcao: p.direcao,
    codigo: p.codigo,
    motivo: p.motivo,
    xml_recuperado: p.xmlRecuperado,
    documento_exportado: p.documentoExportado,
  };
}

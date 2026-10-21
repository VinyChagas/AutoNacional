/**
 * Adaptador puro: Resultado Discovery-Only (+ metadados da ponte)
 * → ProgressoFiscalNfse.
 *
 * Sem SEFIN, sem percentuais artificiais, sem inferir sucesso por ausência de erro.
 */
import type { EstadoCompletudeInventario } from '../contracts/inventario';
import type { CodigoErroHomologacao, ResultadoDiscoveryOnlyHomologacao } from '../homologacao/types';
import type { EstadoOperacionalHomologacao } from '../homologacao/estados-operacionais';
import type {
  EstadoFaseFiscal,
  ProgressoFiscalNfse,
  TotaisProgressoFiscal,
} from './types';
import { REVISAO_FISCAL_NAO_PUBLICADA } from './revisao';

export interface IdentidadeProgressoFiscal {
  /** UUID do lote SSE; null se fluxo admin sem lote. */
  batchId: string | null;
  empresaId: string;
  /** ID Prisma da execução (canônico = execucaoId da homologação). */
  execucaoId: string;
  cnpj: string;
}

export interface EntradaAdaptadorDiscoveryOnly {
  identidade: IdentidadeProgressoFiscal;
  resultado: ResultadoDiscoveryOnlyHomologacao | null;
  estadoOperacional?: EstadoOperacionalHomologacao | null;
  codigoErroPonte?: CodigoErroHomologacao | string | null;
  motivo?: string | null;
}

const TOTAIS_ZEROS: TotaisProgressoFiscal = {
  emitidas: 0,
  recebidas: 0,
  canceladas: 0,
  vigentes: 0,
  indeterminadas: 0,
  descobertos: 0,
  paginas: 0,
};

function totaisDe(resultado: ResultadoDiscoveryOnlyHomologacao | null): TotaisProgressoFiscal {
  if (!resultado) return { ...TOTAIS_ZEROS };
  const t = resultado.totais;
  return {
    emitidas: t.emitidas,
    recebidas: t.recebidas,
    canceladas: t.canceladas,
    vigentes: t.vigentes,
    indeterminadas: t.indeterminadas,
    descobertos: t.emitidas + t.recebidas,
    paginas: t.paginas,
  };
}

function estadoPorCodigoErro(codigo: string | null | undefined): EstadoFaseFiscal | null {
  if (!codigo) return null;
  if (codigo === 'TIMEOUT') return 'timeout';
  if (
    codigo === 'LIMITE_PAGINAS' ||
    codigo === 'LIMITE_DOCUMENTOS' ||
    codigo === 'LIMITE_REQUISICOES'
  ) {
    return 'limite';
  }
  if (codigo === 'INTERRUPCAO') return 'cancelada';
  return null;
}

function mapearEstadoInventario(
  resultado: ResultadoDiscoveryOnlyHomologacao | null,
  estadoOperacional: EstadoOperacionalHomologacao | null | undefined,
  codigoErro: string | null
): { estado: EstadoFaseFiscal; completude: EstadoCompletudeInventario | null; confiavel: boolean } {
  const porCodigo = estadoPorCodigoErro(codigoErro);
  if (porCodigo === 'timeout' || porCodigo === 'limite' || porCodigo === 'cancelada') {
    return {
      estado: porCodigo,
      completude: resultado?.estadoInventario ?? null,
      confiavel: false,
    };
  }

  if (estadoOperacional === 'CANCELADA') {
    return {
      estado: 'cancelada',
      completude: resultado?.estadoInventario ?? null,
      confiavel: false,
    };
  }
  if (estadoOperacional === 'BLOQUEADA' || estadoOperacional === 'FALHA') {
    return {
      estado: 'falha',
      completude: resultado?.estadoInventario ?? null,
      confiavel: false,
    };
  }

  if (!resultado) {
    return { estado: 'indisponivel', completude: null, confiavel: false };
  }

  const completude = resultado.estadoInventario;
  const veredito = resultado.veredito;

  if (veredito === 'FAIL' && completude !== 'COMPLETO') {
    return { estado: 'falha', completude, confiavel: false };
  }
  if (veredito === 'FAIL') {
    return { estado: 'falha', completude, confiavel: false };
  }
  if (completude === 'PARCIAL' || veredito === 'INCOMPLETO' || estadoOperacional === 'INCOMPLETA') {
    return { estado: 'parcial', completude, confiavel: false };
  }
  if (completude === 'INDETERMINADO') {
    return { estado: 'parcial', completude, confiavel: false };
  }
  if (completude === 'COMPLETO' && veredito === 'PASS') {
    return { estado: 'completa', completude, confiavel: true };
  }
  // Não inferir sucesso só por ausência de erro.
  return { estado: 'parcial', completude, confiavel: false };
}

/**
 * Validação = totais de classificação do inventário.
 * Inventário incompleto ⇒ classificação parcial (nunca “completa”).
 */
function mapearValidacao(
  resultado: ResultadoDiscoveryOnlyHomologacao | null,
  inventarioEstado: EstadoFaseFiscal,
  inventarioConfiavel: boolean
): ProgressoFiscalNfse['validacao'] {
  if (!resultado) {
    return {
      estado: 'indisponivel',
      origem: 'indisponivel',
      vigentes: 0,
      canceladas: 0,
      indeterminadas: 0,
      conclusao_confiavel: false,
    };
  }

  const vigentes = resultado.totais.vigentes;
  const canceladas = resultado.totais.canceladas;
  const indeterminadas = resultado.totais.indeterminadas;

  if (
    inventarioEstado === 'falha' ||
    inventarioEstado === 'cancelada' ||
    inventarioEstado === 'timeout' ||
    inventarioEstado === 'limite'
  ) {
    return {
      estado: inventarioEstado,
      origem: 'PORTAL',
      vigentes,
      canceladas,
      indeterminadas,
      conclusao_confiavel: false,
    };
  }

  if (!inventarioConfiavel || inventarioEstado === 'parcial') {
    return {
      estado: 'parcial',
      origem: 'PORTAL',
      vigentes,
      canceladas,
      indeterminadas,
      conclusao_confiavel: false,
    };
  }

  return {
    estado: 'completa',
    origem: 'PORTAL',
    vigentes,
    canceladas,
    indeterminadas,
    conclusao_confiavel: true,
  };
}

/**
 * Converte resultado Discovery-Only (e metadados da ponte) em progresso fiscal.
 */
export function progressoFiscalDeDiscoveryOnly(
  entrada: EntradaAdaptadorDiscoveryOnly
): ProgressoFiscalNfse {
  const { identidade, resultado } = entrada;
  const codigo =
    entrada.codigoErroPonte ??
    resultado?.codigoErro ??
    null;
  const codigoStr = codigo ? String(codigo) : null;
  const estadoOp = entrada.estadoOperacional ?? null;

  const inv = mapearEstadoInventario(resultado, estadoOp, codigoStr);
  const totais = totaisDe(resultado);
  const validacao = mapearValidacao(resultado, inv.estado, inv.confiavel);

  return {
    versao: 1,
    batch_id: identidade.batchId,
    empresa_id: identidade.empresaId,
    execucao_id: identidade.execucaoId,
    cnpj: identidade.cnpj,
    /** Publicação atribui revisão monotônica — adaptador não incrementa. */
    revisao: REVISAO_FISCAL_NAO_PUBLICADA,
    inventario: {
      estado: inv.estado,
      completude: inv.completude,
      conclusao_confiavel: inv.confiavel,
      totais,
    },
    validacao,
    recuperacao: {
      estado: 'nao_executada',
      conclusao_confiavel: false,
    },
    codigo: codigoStr,
    message: entrada.motivo?.trim() || null,
    estado_operacional: estadoOp,
    veredito_discovery: resultado?.veredito ?? null,
  };
}

/** True se o payload não contém chaves sensíveis óbvias (teste de sanidade). */
export function progressoFiscalSemDadosSensiveis(p: ProgressoFiscalNfse): boolean {
  const raw = JSON.stringify(p).toLowerCase();
  const proibidos = [
    'senha',
    'password',
    'passphrase',
    'pfx',
    'cookie',
    'authorization',
    '-----begin',
    '<nfe',
    '<nfse',
    'twocaptcha',
  ];
  return !proibidos.some((k) => raw.includes(k));
}

/**
 * Executor do fluxo Iniciar A1 → ADN.
 * Sem Playwright, sem hCaptcha, sem SEFIN.
 * Após sync, consolida inventário persistido por competência (não só a sessão).
 * Falha tipada — o chamador NÃO deve fazer fallback silencioso para o legado.
 */
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import {
  adaptarSyncAdnParaInventarioParcial,
  criarPeriodoReferenciaAdn,
  type ResultadoAdaptacaoInventarioAdn,
} from './inventory-adapter';
import {
  consolidarInventarioPersistidoAdn,
  decidirResultadoFinalAdnIniciar,
  formatarMotivoConsolidacaoAdn,
  type ConsolidacaoInventarioPersistidoAdn,
  type FonteInventarioPersistidoAdn,
  type ResultadoFinalAdnIniciar,
} from './inventario-persistido';
import { avaliarGateLiveAdn } from './live-gate';
import type { ResultadoSyncAdn } from './types';
import type { DecisaoRoteamentoAdnIniciar } from './iniciar-routing';
import { progressoFiscalDeSyncAdn } from '../progresso-fiscal/from-adn-sync';
import type { ProgressoFiscalNfse } from '../progresso-fiscal/types';
import type { IdentidadeProgressoFiscal } from '../progresso-fiscal/from-discovery-only';

export interface EntradaFluxoAdnIniciar {
  cnpj: string;
  dataInicio: string;
  dataFim: string;
  ambiente?: AmbienteAdn;
  identidade: IdentidadeProgressoFiscal;
  decisao: DecisaoRoteamentoAdnIniciar;
  /** Interrupção cooperativa (ex.: encerrandoFila). */
  deveInterromper?: () => boolean;
  env?: NodeJS.ProcessEnv;
}

export interface DependenciasFluxoAdnIniciar {
  /**
   * Sync ADN injetável (obrigatório em produção via factory; testes usam transporte fake).
   * Nunca deve abrir Chromium.
   */
  executarSync: (params: {
    cnpj: string;
    ambiente: AmbienteAdn;
    deveInterromper?: () => boolean;
  }) => Promise<ResultadoSyncAdn>;
  /** Consulta índice/arquivos persistidos por CNPJ+ambiente. */
  fonteInventarioPersistido?: FonteInventarioPersistidoAdn | null;
  /**
   * Se true, exige gate live (NFSE_ALLOW_LIVE) antes do sync.
   * Default true em produção; testes offline passam false.
   */
  exigirGateLive?: boolean;
}

export interface ResultadoFluxoAdnIniciar {
  ok: boolean;
  chromiumAberto: false;
  sefinChamado: false;
  playwrightUsado: false;
  hcaptchaUsado: false;
  sync: ResultadoSyncAdn | null;
  adaptacao: ResultadoAdaptacaoInventarioAdn | null;
  consolidacao: ConsolidacaoInventarioPersistidoAdn | null;
  fiscal: ProgressoFiscalNfse | null;
  codigoErro: string | null;
  motivo: string;
  /** Contagens para finalizarExecucao / métricas / Angular. */
  contagens: { emitidas: number; recebidas: number; canceladas: number };
  /** Resultado final tipado (SEM_MOVIMENTO só com evidência na competência). */
  resultadoFinal: ResultadoFinalAdnIniciar | 'ERRO';
}

/** Normaliza para DD/MM/YYYY (contrato PeriodoConsultaPortal). */
function normalizarDataPortal(data: string): string {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.trim());
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return data.trim();
}

function falhaBase(
  parcial: Partial<ResultadoFluxoAdnIniciar> & Pick<ResultadoFluxoAdnIniciar, 'codigoErro' | 'motivo'>
): ResultadoFluxoAdnIniciar {
  return {
    ok: false,
    chromiumAberto: false,
    sefinChamado: false,
    playwrightUsado: false,
    hcaptchaUsado: false,
    sync: null,
    adaptacao: null,
    consolidacao: null,
    fiscal: null,
    contagens: { emitidas: 0, recebidas: 0, canceladas: 0 },
    resultadoFinal: 'ERRO',
    ...parcial,
  };
}

/**
 * Executa distribuição ADN após decisão ADN_SOLICITADO.
 * Consolida inventário persistido por competência após o sync.
 * Retorna chromiumAberto=false sempre.
 */
export async function executarFluxoAdnIniciar(
  entrada: EntradaFluxoAdnIniciar,
  deps: DependenciasFluxoAdnIniciar
): Promise<ResultadoFluxoAdnIniciar> {
  if (!entrada.decisao.executarAdn || entrada.decisao.abrirChromium) {
    return falhaBase({
      codigoErro: 'ROTEAMENTO_INVALIDO',
      motivo: 'executarFluxoAdnIniciar chamado sem decisão ADN_SOLICITADO.',
    });
  }

  const ambiente: AmbienteAdn = entrada.ambiente ?? 'producao';
  const cnpj = entrada.cnpj.replace(/\D/g, '');
  const exigirGate = deps.exigirGateLive !== false;
  const env = entrada.env ?? process.env;
  const dataInicio = normalizarDataPortal(entrada.dataInicio);
  const dataFim = normalizarDataPortal(entrada.dataFim);

  if (exigirGate) {
    const gate = avaliarGateLiveAdn({ confirmLive: true, env });
    if (!gate.ok) {
      return falhaBase({
        codigoErro: gate.codigo,
        motivo: `${gate.motivo} Sem fallback para Playwright.`,
      });
    }
  }

  if (entrada.deveInterromper?.()) {
    return falhaBase({
      codigoErro: 'INTERRUPCAO',
      motivo: 'Execução ADN interrompida antes do sync (sem Chromium).',
    });
  }

  let sync: ResultadoSyncAdn;
  try {
    sync = await deps.executarSync({
      cnpj,
      ambiente,
      deveInterromper: entrada.deveInterromper,
    });
  } catch (e) {
    const codigo = e instanceof ErroAdn ? e.codigo : 'ADN_SYNC_FALHOU';
    const motivo =
      e instanceof Error
        ? `${e.message} Sem fallback para Playwright.`
        : 'Falha ADN desconhecida. Sem fallback para Playwright.';
    return falhaBase({ codigoErro: codigo, motivo });
  }

  const periodo = criarPeriodoReferenciaAdn(dataInicio, dataFim);
  const adaptacao = adaptarSyncAdnParaInventarioParcial({
    sync,
    periodoConsulta: periodo,
    inventarioId: `adn-iniciar-${cnpj}-${entrada.identidade.execucaoId}`,
  });

  let consolidacao: ConsolidacaoInventarioPersistidoAdn | null = null;
  if (deps.fonteInventarioPersistido) {
    consolidacao = await consolidarInventarioPersistidoAdn({
      cnpj,
      ambiente,
      dataInicio,
      dataFim,
      sync,
      fonte: deps.fonteInventarioPersistido,
    });
  }

  const interrompido =
    Boolean(entrada.deveInterromper?.()) || /interrompid/i.test(sync.motivoParada);

  const codigoErro =
    sync.status === 'ERRO' ? 'ADN_SYNC_ERRO' : interrompido ? 'INTERRUPCAO' : null;

  const resultadoFinal: ResultadoFinalAdnIniciar | 'ERRO' = codigoErro
    ? 'ERRO'
    : consolidacao
      ? decidirResultadoFinalAdnIniciar(consolidacao)
      : sync.documentos.length > 0
        ? 'NFS_ENCONTRADAS'
        : 'ADN_INVENTARIO_INDETERMINADO';

  const motivo = consolidacao
    ? formatarMotivoConsolidacaoAdn(sync, consolidacao, resultadoFinal === 'ERRO' ? 'ADN_INVENTARIO_INDETERMINADO' : resultadoFinal)
    : `Distribuição ADN ${sync.status}; documentos sessão=${adaptacao.inventario.documentos.length}; ` +
      `fim NSU=${sync.fimDistribuicaoConfirmado}; inventário persistido indisponível; ` +
      `completude mensal NÃO comprovada.`;

  const fiscal = progressoFiscalDeSyncAdn({
    identidade: entrada.identidade,
    sync,
    adaptacao,
    consolidacao,
    motivo,
    codigoErro,
    interrompido,
  });

  const ok = sync.status !== 'ERRO' && !interrompido;

  return {
    ok,
    chromiumAberto: false,
    sefinChamado: false,
    playwrightUsado: false,
    hcaptchaUsado: false,
    sync,
    adaptacao,
    consolidacao,
    fiscal,
    codigoErro,
    motivo: fiscal.message ?? motivo,
    contagens: {
      emitidas: fiscal.inventario.totais.emitidas,
      recebidas: fiscal.inventario.totais.recebidas,
      canceladas: fiscal.inventario.totais.canceladas,
    },
    resultadoFinal: ok ? resultadoFinal : 'ERRO',
  };
}

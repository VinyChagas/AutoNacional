/**
 * Executor do fluxo Iniciar A1 → ADN.
 * Sem Playwright, sem hCaptcha, sem SEFIN.
 * Reutiliza SyncServiceAdn + inventário parcial + progresso fiscal.
 * Falha tipada — o chamador NÃO deve fazer fallback silencioso para o legado.
 */
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import {
  adaptarSyncAdnParaInventarioParcial,
  criarPeriodoReferenciaAdn,
  type ResultadoAdaptacaoInventarioAdn,
} from './inventory-adapter';
import { avaliarGateLiveAdn } from './live-gate';
import type { ResultadoSyncAdn } from './types';
import type { DecisaoRoteamentoAdnIniciar } from './iniciar-routing';
import {
  progressoFiscalDeSyncAdn,
} from '../progresso-fiscal/from-adn-sync';
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
  fiscal: ProgressoFiscalNfse | null;
  codigoErro: string | null;
  motivo: string;
  /** Contagens para finalizarExecucao / métricas. */
  contagens: { emitidas: number; recebidas: number; canceladas: number };
}

/** Normaliza para DD/MM/YYYY (contrato PeriodoConsultaPortal). */
function normalizarDataPortal(data: string): string {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.trim());
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return data.trim();
}

/**
 * Executa distribuição ADN após decisão ADN_SOLICITADO.
 * Retorna chromiumAberto=false sempre.
 */
export async function executarFluxoAdnIniciar(
  entrada: EntradaFluxoAdnIniciar,
  deps: DependenciasFluxoAdnIniciar
): Promise<ResultadoFluxoAdnIniciar> {
  if (!entrada.decisao.executarAdn || entrada.decisao.abrirChromium) {
    return {
      ok: false,
      chromiumAberto: false,
      sefinChamado: false,
      playwrightUsado: false,
      hcaptchaUsado: false,
      sync: null,
      adaptacao: null,
      fiscal: null,
      codigoErro: 'ROTEAMENTO_INVALIDO',
      motivo: 'executarFluxoAdnIniciar chamado sem decisão ADN_SOLICITADO.',
      contagens: { emitidas: 0, recebidas: 0, canceladas: 0 },
    };
  }

  const ambiente: AmbienteAdn = entrada.ambiente ?? 'producao';
  const cnpj = entrada.cnpj.replace(/\D/g, '');
  const exigirGate = deps.exigirGateLive !== false;
  const env = entrada.env ?? process.env;

  if (exigirGate) {
    const gate = avaliarGateLiveAdn({ confirmLive: true, env });
    if (!gate.ok) {
      return {
        ok: false,
        chromiumAberto: false,
        sefinChamado: false,
        playwrightUsado: false,
        hcaptchaUsado: false,
        sync: null,
        adaptacao: null,
        fiscal: null,
        codigoErro: gate.codigo,
        motivo: `${gate.motivo} Sem fallback para Playwright.`,
        contagens: { emitidas: 0, recebidas: 0, canceladas: 0 },
      };
    }
  }

  if (entrada.deveInterromper?.()) {
    return {
      ok: false,
      chromiumAberto: false,
      sefinChamado: false,
      playwrightUsado: false,
      hcaptchaUsado: false,
      sync: null,
      adaptacao: null,
      fiscal: null,
      codigoErro: 'INTERRUPCAO',
      motivo: 'Execução ADN interrompida antes do sync (sem Chromium).',
      contagens: { emitidas: 0, recebidas: 0, canceladas: 0 },
    };
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
    return {
      ok: false,
      chromiumAberto: false,
      sefinChamado: false,
      playwrightUsado: false,
      hcaptchaUsado: false,
      sync: null,
      adaptacao: null,
      fiscal: null,
      codigoErro: codigo,
      motivo,
      contagens: { emitidas: 0, recebidas: 0, canceladas: 0 },
    };
  }

  const periodo = criarPeriodoReferenciaAdn(
    normalizarDataPortal(entrada.dataInicio),
    normalizarDataPortal(entrada.dataFim)
  );
  const adaptacao = adaptarSyncAdnParaInventarioParcial({
    sync,
    periodoConsulta: periodo,
    inventarioId: `adn-iniciar-${cnpj}-${entrada.identidade.execucaoId}`,
  });

  const interrompido =
    Boolean(entrada.deveInterromper?.()) ||
    /interrompid/i.test(sync.motivoParada);

  const codigoErro =
    sync.status === 'ERRO'
      ? 'ADN_SYNC_ERRO'
      : interrompido
        ? 'INTERRUPCAO'
        : null;

  const fiscal = progressoFiscalDeSyncAdn({
    identidade: entrada.identidade,
    sync,
    adaptacao,
    motivo:
      `Distribuição ADN ${sync.status}; documentos inventário=${adaptacao.inventario.documentos.length}; ` +
      `fim NSU=${sync.fimDistribuicaoConfirmado}; completude mensal NÃO comprovada.`,
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
    fiscal,
    codigoErro,
    motivo: fiscal.message ?? entrada.decisao.motivo,
    contagens: {
      emitidas: fiscal.inventario.totais.emitidas,
      recebidas: fiscal.inventario.totais.recebidas,
      canceladas: fiscal.inventario.totais.canceladas,
    },
  };
}

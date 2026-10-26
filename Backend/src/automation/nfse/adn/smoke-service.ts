/**
 * Smoke ADN: exatamente 1 GET /DFe/{NSU}, sem checkpoint, sem SEFIN, sem Playwright.
 * Saída sanitizada — sem XML, PFX, senha ou rawBody.
 */
import type { CredencialMtls } from '../recovery/types';
import { criarProvedorA1DoCadastro } from '../infrastructure/a1-adapter';
import { AdnClient } from './adn-client';
import { assertCnpjCompativelComCertificado } from './cert-identity';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { avaliarGateLiveAdn } from './live-gate';
import { criarTransporteHttpsMtlsAdn } from './mtls-transport';
import type { LimitesAdn, TransporteHttpAdn } from './types';

export const LIMITES_SMOKE_ADN: LimitesAdn = {
  timeoutMs: 20_000,
  maxBytesResposta: 4_000_000,
  maxBytesGzip: 1_500_000,
  maxBytesXml: 4_000_000,
  rateLimitMs: 0,
  maxRequests: 1,
  maxBytesArmazenamentoCnpj: 512 * 1024 * 1024,
};

/** Resumo operacional — campos permitidos na saída do smoke. */
export interface ResumoSmokeAdn {
  httpStatus: number | null;
  statusProcessamento: string | null;
  quantidadeDocumentos: number | null;
  duracaoMs: number | null;
  mtlsAutenticado: boolean | null;
  ok: boolean;
  codigoErro: string | null;
  motivo: string | null;
  /** Contador de tentativas de GET (deve ser 0 ou 1). */
  requisicoesHttp: number;
  checkpointGravado: false;
}

export interface EntradaSmokeAdn {
  cnpj: string;
  nsu: number;
  ambiente: AmbienteAdn;
  confirmLive: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface DependenciasSmokeAdn {
  obterCredencial?: (cnpj: string) => Promise<CredencialMtls>;
  /** Transporte injetável (testes). Em live, default mTLS real. */
  criarTransporte?: () => TransporteHttpAdn;
}

/**
 * Transporte que limita o número absoluto de GETs HTTP.
 * Smoke usa max=1; harness multi-lote usa o mesmo teto de maxRequests.
 */
export class TransporteLimiteRequisicoesAdn implements TransporteHttpAdn {
  private contagem = 0;

  constructor(
    private readonly inner: TransporteHttpAdn,
    private readonly maxRequisicoes = 1,
    private readonly codigoLimite = 'LIMITE_SMOKE',
    private readonly mensagemLimite = 'Limite absoluto de requisições HTTP ADN atingido.'
  ) {
    if (!Number.isInteger(maxRequisicoes) || maxRequisicoes < 1) {
      throw new ErroAdn('LIMITE_INVALIDO', 'PERMANENTE', 'maxRequisicoes deve ser >= 1.');
    }
  }

  get requisicoes(): number {
    return this.contagem;
  }

  async get(
    url: URL,
    credencial: CredencialMtls,
    limites: Pick<LimitesAdn, 'timeoutMs' | 'maxBytesResposta'>
  ) {
    this.contagem += 1;
    if (this.contagem > this.maxRequisicoes) {
      throw new ErroAdn(this.codigoLimite, 'BLOQUEANTE', this.mensagemLimite);
    }
    return this.inner.get(url, credencial, limites);
  }
}

/** Alias histórico do smoke (exatamente 1 GET). */
export class TransporteUmaRequisicaoAdn extends TransporteLimiteRequisicoesAdn {
  constructor(inner: TransporteHttpAdn) {
    super(
      inner,
      1,
      'LIMITE_SMOKE',
      'Smoke ADN permite exatamente 1 requisição HTTP.'
    );
  }
}

function resumoFalha(
  codigo: string,
  motivo: string,
  parcial: Partial<ResumoSmokeAdn> = {}
): ResumoSmokeAdn {
  return {
    httpStatus: parcial.httpStatus ?? null,
    statusProcessamento: parcial.statusProcessamento ?? null,
    quantidadeDocumentos: parcial.quantidadeDocumentos ?? null,
    duracaoMs: parcial.duracaoMs ?? null,
    mtlsAutenticado: parcial.mtlsAutenticado ?? null,
    ok: false,
    codigoErro: codigo,
    motivo,
    requisicoesHttp: parcial.requisicoesHttp ?? 0,
    checkpointGravado: false,
  };
}

/**
 * Executa o smoke ADN isolado.
 * Não grava checkpoint. Não chama SEFIN. Não abre navegador.
 */
export async function executarSmokeAdn(
  entrada: EntradaSmokeAdn,
  deps: DependenciasSmokeAdn = {}
): Promise<ResumoSmokeAdn> {
  const gate = avaliarGateLiveAdn({
    confirmLive: entrada.confirmLive,
    env: entrada.env,
  });
  if (!gate.ok) {
    return resumoFalha(gate.codigo, gate.motivo);
  }

  if (!Number.isInteger(entrada.nsu) || entrada.nsu < 0) {
    return resumoFalha('NSU_INVALIDO', 'NSU inválido para o smoke ADN.');
  }

  const obterCredencial =
    deps.obterCredencial ??
    (async (cnpj: string) => criarProvedorA1DoCadastro().obter(cnpj));

  let credencial: CredencialMtls;
  try {
    credencial = await obterCredencial(entrada.cnpj);
  } catch (erro) {
    const codigo =
      erro && typeof erro === 'object' && 'codigo' in erro
        ? String((erro as { codigo: string }).codigo)
        : 'CERTIFICADO_INDISPONIVEL';
    const motivo = erro instanceof Error ? erro.message : 'Falha ao carregar certificado A1.';
    return resumoFalha(codigo, motivo);
  }

  try {
    assertCnpjCompativelComCertificado(entrada.cnpj, credencial);
  } catch (erro) {
    if (erro instanceof ErroAdn) {
      return resumoFalha(erro.codigo, erro.message);
    }
    return resumoFalha('CNPJ_INCOMPATIVEL', 'CNPJ incompatível com o certificado.');
  }

  const inner =
    deps.criarTransporte?.() ?? criarTransporteHttpsMtlsAdn();
  const transporte = new TransporteUmaRequisicaoAdn(inner);
  const client = new AdnClient(transporte, credencial, LIMITES_SMOKE_ADN);

  try {
    const resultado = await client.consultarDFe({
      nsu: entrada.nsu,
      cnpjConsulta: entrada.cnpj.replace(/\D/g, ''),
      lote: true,
      ambiente: entrada.ambiente,
    });

    // Sanitização: NÃO propagar rawBody / data.LoteDFe / ArquivoXml.
    const quantidade = resultado.data?.LoteDFe?.length ?? 0;
    return {
      httpStatus: resultado.statusHttp,
      statusProcessamento: resultado.data?.StatusProcessamento ?? null,
      quantidadeDocumentos: quantidade,
      duracaoMs: resultado.durationMs,
      mtlsAutenticado: resultado.interpretacao.autenticacaoOk,
      ok: true,
      codigoErro: null,
      motivo: null,
      requisicoesHttp: transporte.requisicoes,
      checkpointGravado: false,
    };
  } catch (erro) {
    if (erro instanceof ErroAdn) {
      const mtls =
        erro.codigo === 'HANDSHAKE_TLS' || erro.codigo === 'NAO_AUTORIZADO'
          ? false
          : erro.codigo === 'RATE_LIMIT' || erro.codigo === 'ERRO_SERVIDOR'
            ? true
            : null;
      return resumoFalha(erro.codigo, erro.message, {
        mtlsAutenticado: mtls,
        requisicoesHttp: transporte.requisicoes,
      });
    }
    return resumoFalha(
      'FALHA_SMOKE',
      erro instanceof Error ? erro.message : 'Falha no smoke ADN.',
      { requisicoesHttp: transporte.requisicoes }
    );
  }
}

/** Formata saída permitida para stdout (sem segredos). */
export function formatarResumoSmokeAdn(resumo: ResumoSmokeAdn): string {
  const linhas = [
    '=== Smoke ADN (sanitizado) ===',
    `ok: ${resumo.ok}`,
    `httpStatus: ${resumo.httpStatus ?? 'n/a'}`,
    `statusProcessamento: ${resumo.statusProcessamento ?? 'n/a'}`,
    `quantidadeDocumentos: ${resumo.quantidadeDocumentos ?? 'n/a'}`,
    `duracaoMs: ${resumo.duracaoMs ?? 'n/a'}`,
    `mtlsAutenticado: ${resumo.mtlsAutenticado ?? 'n/a'}`,
    `requisicoesHttp: ${resumo.requisicoesHttp}`,
    `checkpointGravado: ${resumo.checkpointGravado}`,
  ];
  if (resumo.codigoErro) {
    linhas.push(`codigoErro: ${resumo.codigoErro}`);
    linhas.push(`motivo: ${resumo.motivo ?? ''}`);
  }
  const texto = linhas.join('\n');
  // Guarda-corpo: nunca imprimir padrões óbvios de material sensível.
  if (/ArquivoXml|nfseXmlGZip|BEGIN |password|passphrase|pfx/i.test(texto)) {
    return '=== Smoke ADN ===\nerro: saída bloqueada por sanitização.';
  }
  return texto;
}

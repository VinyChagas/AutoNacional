/**
 * API-03G — classificação de falhas e política de retry por empresa.
 * Não toca fila, Playwright nem checkpoint; só decide se a falha é retriável.
 */

export type AcaoRetryEmpresa = 'RETRY' | 'FALHA_DEFINITIVA' | 'SUSPENDER_ACESSO';

export interface ClassificacaoErroEmpresa {
  acao: AcaoRetryEmpresa;
  motivo: string;
  codigo: string;
}

export interface PoliticaRetryEmpresa {
  /** Quantas novas tentativas após a 1ª falha (padrão 3 → até 4 corridas). */
  maxNovasTentativas: number;
  /** Delays em ms entre tentativas (índice 0 = após 1ª falha). */
  intervalosMs: number[];
}

const DEFAULT_INTERVALOS_MS = [5_000, 15_000, 30_000] as const;

/**
 * Padrões de falha transitória (navegação / portal / conexão).
 * API-03I — inclui FILTRO_NAO_APLICADO, DATA_CHAVE_NAO_VERIFICAVEL,
 * TOTALIZADOR_DIVERGENTE e LISTA_VAZIA_NAO_CONFIRMADA (renderização/filtro instável).
 * Nunca inclui SITUACAO_INDETERMINADA nem conflitos de XML (permanentes).
 */
const RETRYAVEL: ReadonlyArray<{ codigo: string; re: RegExp }> = [
  { codigo: 'NAV_TIMEOUT', re: /Timeout\s*\d+ms\s*exceeded/i },
  { codigo: 'NAV_TIMEOUT', re: /locator\.(click|fill|waitFor).*Timeout/i },
  { codigo: 'NAV_TIMEOUT', re: /page\.(goto|waitFor|click).*Timeout/i },
  { codigo: 'NAV_FALHA', re: /\bNAV_FALHA\b/i },
  { codigo: 'NAV_FALHA', re: /Falha ao (aplicar|abrir|aplicar o período)/i },
  { codigo: 'NAV_FALHA', re: /Menu de notas .*(não encontrado|nao encontrado)/i },
  { codigo: 'NAV_FALHA', re: /Inventário incompleto:.*NAV_FALHA/i },
  { codigo: 'NAV_FALHA', re: /#datainicio|#datafim|#searchbar/i },
  { codigo: 'CONEXAO', re: /net::ERR_(TIMED_OUT|CONNECTION_|NAME_NOT_RESOLVED|NETWORK_CHANGED|INTERNET_DISCONNECTED|SOCKS_CONNECTION_FAILED|ABORTED)/i },
  { codigo: 'CONEXAO', re: /Navigation interrupted/i },
  { codigo: 'CONEXAO', re: /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i },
  { codigo: 'PORTAL_INSTAVEL', re: /carregamento incompleto|listagem (não|nao) estabilizou|DISCOVERY_FAILED/i },
  { codigo: 'PORTAL_INSTAVEL', re: /DESCOBERTA_INCOMPLETA/i },
  {
    codigo: 'FILTRO_NAO_APLICADO',
    re: /\bFILTRO_NAO_APLICADO\b|Portal não confirmou a listagem|filtro (não|nao) (foi )?aplicado|listagem após filtro/i,
  },
  {
    codigo: 'DATA_CHAVE_NAO_VERIFICAVEL',
    re: /\bDATA_CHAVE_NAO_VERIFICAVEL\b|sem chave nacional confirmada/i,
  },
  {
    codigo: 'TOTALIZADOR_DIVERGENTE',
    re: /\bTOTALIZADOR_DIVERGENTE\b|portal indica \d+ registros/i,
  },
  {
    codigo: 'LISTA_VAZIA_NAO_CONFIRMADA',
    re: /\bLISTA_VAZIA_NAO_CONFIRMADA\b|não trouxe linhas nem a mensagem de ausência|nao trouxe linhas nem a mensagem/i,
  },
];

/** Proteção de acesso — suspende retries até reavaliação. */
const SUSPENSAO: ReadonlyArray<{ codigo: string; re: RegExp }> = [
  { codigo: 'HTTP_403', re: /\b403\b|Forbidden|acesso (negado|bloqueado)/i },
  { codigo: 'HTTP_429', re: /\b429\b|Too Many Requests|rate.?limit/i },
  { codigo: 'WAF', re: /\bcaptcha\b.*bloque|cloudflare|access denied|proteção de acesso/i },
];

/** Erros permanentes — nunca retry automático. */
const PERMANENTE: ReadonlyArray<{ codigo: string; re: RegExp }> = [
  { codigo: 'SITUACAO_INDETERMINADA', re: /SITUACAO_INDETERMINADA|Nota indeterminada/i },
  { codigo: 'XML_INCONSISTENTE', re: /XML_INCONSISTENTE|Hash divergente|CONFLITO_HASH/i },
  { codigo: 'CHECKPOINT', re: /CHAVES_AUSENTES|DIRECAO_DIVERGENTE|TRANSICAO_SITUACAO_INVALIDA|CHECKPOINT_CORROMPIDO|VERSAO_INCOMPATIVEL/i },
  { codigo: 'IDENTIDADE', re: /IDENTIDADE_DIVERGENTE|Fingerprint do inventário diverge/i },
  { codigo: 'CREDENTIAL', re: /senha (incorreta|inválida)|credencial|NFSeAutenticacaoError|login (inválido|falhou)/i },
  { codigo: 'CERTIFICADO', re: /certificado.*(inválido|ausente|expirad|indisponível)|CERTIFICADO_INDISPONIVEL|PFX/i },
  { codigo: 'CONFIG', re: /FAIL_CONFIGURATION|CertificateService não configurado|RAIZ_FISCAL_AUSENTE|CONTEXTO_INVALIDO/i },
];

/**
 * Lê política de retry (env).
 * EMPRESA_RETRY_MAX=3
 * EMPRESA_RETRY_INTERVALS_MS=5000,15000,30000
 */
export function obterPoliticaRetryEmpresa(
  env: NodeJS.ProcessEnv = process.env
): PoliticaRetryEmpresa {
  const maxRaw = parseInt(env.EMPRESA_RETRY_MAX ?? '3', 10);
  const maxNovasTentativas = Number.isFinite(maxRaw) && maxRaw >= 0 ? Math.min(maxRaw, 10) : 3;

  const bruto = (env.EMPRESA_RETRY_INTERVALS_MS ?? DEFAULT_INTERVALOS_MS.join(',')).trim();
  const parseados = bruto
    .split(',')
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const intervalosMs =
    parseados.length > 0 ? parseados : [...DEFAULT_INTERVALOS_MS];

  return { maxNovasTentativas, intervalosMs };
}

export function intervaloRetryMs(
  politica: PoliticaRetryEmpresa,
  /** Tentativa que acabou de falhar (1 = primeira corrida). */
  tentativaFalhou: number
): number {
  const idx = Math.max(0, tentativaFalhou - 1);
  if (idx < politica.intervalosMs.length) return politica.intervalosMs[idx]!;
  return politica.intervalosMs[politica.intervalosMs.length - 1] ?? 30_000;
}

export function podeAgendarNovaTentativa(
  politica: PoliticaRetryEmpresa,
  tentativaAtual: number
): boolean {
  const maxTotal = 1 + politica.maxNovasTentativas;
  return tentativaAtual < maxTotal;
}

/**
 * Classifica mensagem/código de erro da execução da empresa.
 * Ordem: permanente → suspensão → retryável → definitiva (default).
 */
export function classificarErroEmpresa(
  mensagem: string,
  opcoes?: { codigo?: string | null }
): ClassificacaoErroEmpresa {
  const texto = `${opcoes?.codigo ?? ''} ${mensagem ?? ''}`.trim();
  if (!texto) {
    return {
      acao: 'FALHA_DEFINITIVA',
      motivo: 'Erro sem mensagem classificável.',
      codigo: 'DESCONHECIDO',
    };
  }

  for (const regra of PERMANENTE) {
    if (regra.re.test(texto)) {
      return {
        acao: 'FALHA_DEFINITIVA',
        motivo: 'Erro permanente — retry automático não aplicável.',
        codigo: regra.codigo,
      };
    }
  }

  for (const regra of SUSPENSAO) {
    if (regra.re.test(texto)) {
      return {
        acao: 'SUSPENDER_ACESSO',
        motivo: 'Proteção de acesso / rate limit — exige reavaliação.',
        codigo: regra.codigo,
      };
    }
  }

  for (const regra of RETRYAVEL) {
    if (regra.re.test(texto)) {
      return {
        acao: 'RETRY',
        motivo: 'Falha transitória de navegação/conexão.',
        codigo: regra.codigo,
      };
    }
  }

  return {
    acao: 'FALHA_DEFINITIVA',
    motivo: 'Erro não classificado como transitório.',
    codigo: 'NAO_CLASSIFICADO',
  };
}

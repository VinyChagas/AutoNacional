/**
 * Roteamento Iniciar: A1 → ADN (antes do Chromium) vs usuário/senha → Playwright.
 * Sem fallback silencioso: se ADN for selecionado e falhar, não abre Playwright.
 * SEFIN nunca é chamado por este caminho.
 */
import {
  cnpjNaAllowlistAdnIniciar,
  flagAdnIniciarAtiva,
  lerFlagAdnIniciar,
} from './iniciar-feature-flag';

export type TipoAutenticacaoIniciar = 'certificado' | 'credenciais';

export type SituacaoRoteamentoAdnIniciar =
  | 'ADN_SOLICITADO'
  | 'LEGADO_CREDENCIAIS'
  | 'LEGADO_FLAG_OFF'
  | 'LEGADO_EMPRESA_NAO_AUTORIZADA'
  | 'LEGADO_CONTEXTO';

export interface AutorizacaoAdnIniciar {
  /** Autorização explícita por execução/empresa (testes ou ativação pontual). */
  ativa: boolean;
  cnpj?: string;
}

export interface ContextoRoteamentoAdnIniciar {
  tipoAutenticacao: TipoAutenticacaoIniciar;
  cnpj: string;
  env?: NodeJS.ProcessEnv;
  /** Se presente e ativa, autoriza a empresa mesmo fora da allowlist (desde que a flag global esteja on). */
  autorizacaoAdnIniciar?: AutorizacaoAdnIniciar | null;
}

export interface DecisaoRoteamentoAdnIniciar {
  modo: 'ADN' | 'PLAYWRIGHT';
  situacao: SituacaoRoteamentoAdnIniciar;
  executarAdn: boolean;
  abrirChromium: boolean;
  motivo: string;
  flagAtiva: boolean;
  empresaAutorizada: boolean;
}

function autorizacaoExplicitaAtiva(
  auth: AutorizacaoAdnIniciar | null | undefined,
  cnpj: string
): boolean {
  if (!auth || !auth.ativa) return false;
  if (auth.cnpj) {
    const a = auth.cnpj.replace(/\D/g, '');
    const b = cnpj.replace(/\D/g, '');
    return a === b;
  }
  return true;
}

/**
 * Decide o motor ANTES de qualquer launch Playwright.
 * Credenciais → sempre Playwright.
 * Flag off / empresa fora da allowlist → Playwright (legado preservado).
 * Flag on + A1 + empresa autorizada → ADN (sem Chromium).
 */
export function decidirAdnIniciar(ctx: ContextoRoteamentoAdnIniciar): DecisaoRoteamentoAdnIniciar {
  const env = ctx.env ?? process.env;
  const leitura = lerFlagAdnIniciar(env);
  const flagAtiva = leitura.ativa;
  const cnpj = String(ctx.cnpj ?? '').replace(/\D/g, '');
  const naAllowlist = cnpjNaAllowlistAdnIniciar(cnpj, env);
  const authExplicita = autorizacaoExplicitaAtiva(ctx.autorizacaoAdnIniciar, cnpj);
  const empresaAutorizada = naAllowlist || authExplicita;

  if (ctx.tipoAutenticacao === 'credenciais') {
    return {
      modo: 'PLAYWRIGHT',
      situacao: 'LEGADO_CREDENCIAIS',
      executarAdn: false,
      abrirChromium: true,
      motivo: 'Autenticação usuário/senha: fluxo Playwright legado preservado (ADN não aplicável).',
      flagAtiva,
      empresaAutorizada: false,
    };
  }

  if (ctx.tipoAutenticacao !== 'certificado') {
    return {
      modo: 'PLAYWRIGHT',
      situacao: 'LEGADO_CONTEXTO',
      executarAdn: false,
      abrirChromium: true,
      motivo: 'Tipo de autenticação não suportado para ADN; Playwright preservado.',
      flagAtiva,
      empresaAutorizada: false,
    };
  }

  if (!flagAtiva) {
    return {
      modo: 'PLAYWRIGHT',
      situacao: 'LEGADO_FLAG_OFF',
      executarAdn: false,
      abrirChromium: true,
      motivo:
        leitura.motivo === 'INVALIDA'
          ? 'Flag ADN Iniciar inválida; fluxo Playwright legado preservado.'
          : 'Flag ADN Iniciar desativada; fluxo Playwright legado preservado.',
      flagAtiva: false,
      empresaAutorizada,
    };
  }

  if (!empresaAutorizada) {
    return {
      modo: 'PLAYWRIGHT',
      situacao: 'LEGADO_EMPRESA_NAO_AUTORIZADA',
      executarAdn: false,
      abrirChromium: true,
      motivo:
        'Flag ADN Iniciar ativa sem autorização desta empresa (allowlist/explícita); Playwright preservado.',
      flagAtiva: true,
      empresaAutorizada: false,
    };
  }

  return {
    modo: 'ADN',
    situacao: 'ADN_SOLICITADO',
    executarAdn: true,
    abrirChromium: false,
    motivo:
      'Flag ativa, certificado A1 e empresa autorizada: distribuição ADN sem Chromium/hCaptcha/SEFIN.',
    flagAtiva: true,
    empresaAutorizada: true,
  };
}

export function flagAdnIniciarLidaComoAtiva(env?: NodeJS.ProcessEnv): boolean {
  return flagAdnIniciarAtiva(env);
}

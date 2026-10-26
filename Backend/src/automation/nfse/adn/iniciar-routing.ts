/**
 * Roteamento ADN complementar (API-02K).
 * ADN NÃO é mais o padrão do Iniciar A1 — use decidirMotorIniciar (Portal+SEFIN).
 * Este módulo só ativa ADN com autorização explícita por empresa.
 * Sem fallback silencioso: se ADN for selecionado e falhar, não abre Playwright.
 * SEFIN nunca é chamado por este caminho.
 *
 * Config: exceções Playwright ainda usadas por decidirMotorIniciar.
 * Kill-switch env: NFSE_ADN_INICIAR_ENABLED=false bloqueia ADN complementar.
 */
import { lerFlagAdnIniciar } from './iniciar-feature-flag';
import {
  cnpjNaExcecaoPlaywrightAdn,
  lerConfigAdnIniciarMemoria,
  type ConfigAdnIniciarProduto,
} from './iniciar-config';

export type TipoAutenticacaoIniciar = 'certificado' | 'credenciais';

export type SituacaoRoteamentoAdnIniciar =
  | 'ADN_SOLICITADO'
  | 'LEGADO_CREDENCIAIS'
  | 'LEGADO_KILL_SWITCH'
  | 'LEGADO_PRODUTO_DESLIGADO'
  | 'LEGADO_EXCECAO_PLAYWRIGHT'
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
  /** Se presente e ativa, autoriza ADN mesmo com exceção Playwright / produto off (testes). */
  autorizacaoAdnIniciar?: AutorizacaoAdnIniciar | null;
  /** Injeta config de produto (testes). Default: memória/disco. */
  configProduto?: ConfigAdnIniciarProduto | null;
}

export interface DecisaoRoteamentoAdnIniciar {
  modo: 'ADN' | 'PLAYWRIGHT';
  situacao: SituacaoRoteamentoAdnIniciar;
  executarAdn: boolean;
  abrirChromium: boolean;
  motivo: string;
  /** true quando o motor ADN de produto está habilitado (antes de exceções). */
  adnPadraoA1: boolean;
  /** true quando a empresa está na lista de exceção Playwright. */
  excecaoPlaywright: boolean;
  /** Compat: kill-switch env não está forçando off. */
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
 * Decide se ADN complementar deve rodar (só com autorização explícita).
 * A1 padrão do Iniciar é Portal+SEFIN (`decidirMotorIniciar`) — não este módulo.
 */
export function decidirAdnIniciar(ctx: ContextoRoteamentoAdnIniciar): DecisaoRoteamentoAdnIniciar {
  const env = ctx.env ?? process.env;
  const kill = lerFlagAdnIniciar(env);
  /** Ausente = não força off. false/inválida = kill-switch. */
  const killSwitchOff =
    kill.motivo === 'FALSE' || kill.motivo === 'INVALIDA';
  const cfg = ctx.configProduto ?? lerConfigAdnIniciarMemoria();
  const cnpj = String(ctx.cnpj ?? '').replace(/\D/g, '');
  const excecaoPlaywright = cnpjNaExcecaoPlaywrightAdn(cnpj, cfg);
  const authExplicita = autorizacaoExplicitaAtiva(ctx.autorizacaoAdnIniciar, cnpj);
  const adnPadraoA1 = cfg.adnPadraoA1 === true;

  const base = {
    adnPadraoA1,
    excecaoPlaywright,
    flagAtiva: !killSwitchOff,
  };

  if (ctx.tipoAutenticacao === 'credenciais') {
    return {
      modo: 'PLAYWRIGHT',
      situacao: 'LEGADO_CREDENCIAIS',
      executarAdn: false,
      abrirChromium: true,
      motivo: 'Autenticação usuário/senha: fluxo Playwright legado preservado (ADN não aplicável).',
      empresaAutorizada: false,
      ...base,
    };
  }

  if (ctx.tipoAutenticacao !== 'certificado') {
    return {
      modo: 'PLAYWRIGHT',
      situacao: 'LEGADO_CONTEXTO',
      executarAdn: false,
      abrirChromium: true,
      motivo: 'Tipo de autenticação não suportado para ADN; Playwright preservado.',
      empresaAutorizada: false,
      ...base,
    };
  }

  if (killSwitchOff) {
    return {
      modo: 'PLAYWRIGHT',
      situacao: 'LEGADO_KILL_SWITCH',
      executarAdn: false,
      abrirChromium: true,
      motivo:
        kill.motivo === 'INVALIDA'
          ? 'Kill-switch ADN Iniciar inválido; ADN complementar bloqueado.'
          : 'Kill-switch NFSE_ADN_INICIAR_ENABLED=false; ADN complementar bloqueado.',
      empresaAutorizada: false,
      ...base,
      flagAtiva: false,
    };
  }

  // API-02K — ADN só com autorização explícita (complementar).
  if (authExplicita) {
    return {
      modo: 'ADN',
      situacao: 'ADN_SOLICITADO',
      executarAdn: true,
      abrirChromium: false,
      motivo:
        'ADN complementar autorizado explicitamente: distribuição sem Chromium/hCaptcha/SEFIN.',
      empresaAutorizada: true,
      ...base,
      flagAtiva: true,
    };
  }

  if (excecaoPlaywright) {
    return {
      modo: 'PLAYWRIGHT',
      situacao: 'LEGADO_EXCECAO_PLAYWRIGHT',
      executarAdn: false,
      abrirChromium: true,
      motivo:
        'Empresa na lista de exceção Playwright (config persistente); Chromium preservado.',
      empresaAutorizada: false,
      ...base,
    };
  }

  return {
    modo: 'PLAYWRIGHT',
    situacao: 'LEGADO_PRODUTO_DESLIGADO',
    executarAdn: false,
    abrirChromium: true,
    motivo:
      'ADN não é automático no Iniciar (API-02K); use Portal+SEFIN ou autorização ADN explícita.',
    empresaAutorizada: false,
    ...base,
    flagAtiva: false,
  };
}

/** @deprecated Use config de produto; mantido para compat de imports. */
export function flagAdnIniciarLidaComoAtiva(env?: NodeJS.ProcessEnv): boolean {
  const kill = lerFlagAdnIniciar(env);
  if (kill.motivo === 'FALSE' || kill.motivo === 'INVALIDA') return false;
  return lerConfigAdnIniciarMemoria().adnPadraoA1;
}

/**
 * API-02K — Roteamento de produto do botão Iniciar.
 *
 * A1 → Portal + SEFIN (padrão; sem flags nem autorização manual).
 * Credenciais → Playwright legado.
 * Exceção Playwright por CNPJ → Playwright legado.
 * ADN → complementar (só com autorização explícita por empresa).
 */
import {
  cnpjNaExcecaoPlaywrightAdn,
  lerConfigAdnIniciarMemoria,
  type ConfigAdnIniciarProduto,
} from '../adn/iniciar-config';
import type { AutorizacaoAdnIniciar } from '../adn/iniciar-routing';

export type TipoAutenticacaoMotorIniciar = 'certificado' | 'credenciais';

/** Motor exibido na UI / SSE após o roteamento. */
export type MotorProcessamentoIniciar = 'PORTAL_SEFIN' | 'PLAYWRIGHT' | 'ADN';

export type SituacaoMotorIniciar =
  | 'PORTAL_SEFIN_PADRAO_A1'
  | 'LEGADO_CREDENCIAIS'
  | 'LEGADO_EXCECAO_PLAYWRIGHT'
  | 'ADN_COMPLEMENTAR_EXPLICITO'
  | 'LEGADO_CONTEXTO';

export interface ContextoMotorIniciar {
  tipoAutenticacao: TipoAutenticacaoMotorIniciar;
  cnpj: string;
  /** Autorização pontual ADN (complementar). Ausente = não executa ADN. */
  autorizacaoAdnIniciar?: AutorizacaoAdnIniciar | null;
  configProduto?: ConfigAdnIniciarProduto | null;
}

export interface DecisaoMotorIniciar {
  motor: MotorProcessamentoIniciar;
  situacao: SituacaoMotorIniciar;
  /** Abre Chromium para login A1 (listagem) ou legado. */
  abrirChromium: boolean;
  /** Distribuição ADN/NSU — nunca automática no Iniciar. */
  executarAdn: boolean;
  /** Fluxo nativo Portal → chaves → SEFIN. */
  executarPortalSefin: boolean;
  motivo: string;
  excecaoPlaywright: boolean;
}

function autorizacaoAdnExplicita(
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
 * Decide o motor do Iniciar ANTES de efeitos colaterais.
 * ADN só entra com autorização explícita (complementar).
 */
export function decidirMotorIniciar(ctx: ContextoMotorIniciar): DecisaoMotorIniciar {
  const cfg = ctx.configProduto ?? lerConfigAdnIniciarMemoria();
  const cnpj = String(ctx.cnpj ?? '').replace(/\D/g, '');
  const excecaoPlaywright = cnpjNaExcecaoPlaywrightAdn(cnpj, cfg);
  const adnExplicito = autorizacaoAdnExplicita(ctx.autorizacaoAdnIniciar, cnpj);

  if (ctx.tipoAutenticacao === 'credenciais') {
    return {
      motor: 'PLAYWRIGHT',
      situacao: 'LEGADO_CREDENCIAIS',
      abrirChromium: true,
      executarAdn: false,
      executarPortalSefin: false,
      motivo:
        'Autenticação usuário/senha: fluxo Playwright legado (CAPTCHA quando necessário).',
      excecaoPlaywright,
    };
  }

  if (ctx.tipoAutenticacao !== 'certificado') {
    return {
      motor: 'PLAYWRIGHT',
      situacao: 'LEGADO_CONTEXTO',
      abrirChromium: true,
      executarAdn: false,
      executarPortalSefin: false,
      motivo: 'Tipo de autenticação não suportado para Portal+SEFIN; Playwright preservado.',
      excecaoPlaywright,
    };
  }

  // ADN complementar: só com autorização explícita (não usa adnPadraoA1 automático).
  if (adnExplicito) {
    return {
      motor: 'ADN',
      situacao: 'ADN_COMPLEMENTAR_EXPLICITO',
      abrirChromium: false,
      executarAdn: true,
      executarPortalSefin: false,
      motivo:
        'ADN complementar autorizado explicitamente (sem Chromium/SEFIN nesta execução).',
      excecaoPlaywright,
    };
  }

  if (excecaoPlaywright) {
    return {
      motor: 'PLAYWRIGHT',
      situacao: 'LEGADO_EXCECAO_PLAYWRIGHT',
      abrirChromium: true,
      executarAdn: false,
      executarPortalSefin: false,
      motivo:
        'Empresa na lista de exceção Playwright; download legado pelo Portal preservado.',
      excecaoPlaywright: true,
    };
  }

  return {
    motor: 'PORTAL_SEFIN',
    situacao: 'PORTAL_SEFIN_PADRAO_A1',
    abrirChromium: true,
    executarAdn: false,
    executarPortalSefin: true,
    motivo:
      'Certificado A1: descoberta Portal por competência + recuperação SEFIN (XML-only).',
    excecaoPlaywright: false,
  };
}

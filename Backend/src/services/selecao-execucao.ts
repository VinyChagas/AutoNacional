/**
 * API-03B — validação da seleção de empresas para POST /multiplas.
 * Não altera credenciais/certificados; apenas rejeita seleção inválida.
 */
export type FiltroAutenticacaoSelecao = 'todas' | 'certificado' | 'credenciais';

export interface EmpresaSelecaoEntrada {
  empresa_id: string;
  cnpj: string;
  tipo_autenticacao?: string;
}

export interface EmpresaSelecaoValidada {
  empresaId: number;
  cnpj: string;
  tipoAuth: 'certificado' | 'credenciais';
  contabilidadeId: number | null;
}

export interface ErroSelecaoEmpresa {
  empresa_id: string;
  cnpj: string;
  erro: string;
}

export function normalizarFiltroAutenticacao(
  raw: string | null | undefined
): FiltroAutenticacaoSelecao {
  const v = String(raw ?? 'todas').toLowerCase().trim();
  if (v === 'certificado' || v === 'a1' || v === 'certificado_a1') return 'certificado';
  if (v === 'credenciais' || v === 'usuario_senha' || v === 'senha') return 'credenciais';
  return 'todas';
}

export function tipoAuthDaSelecao(
  tipo?: string
): 'certificado' | 'credenciais' {
  return tipo === 'credenciais' ? 'credenciais' : 'certificado';
}

/**
 * Valida se o tipo de autenticação da empresa respeita o filtro da UI.
 * Exceções de roteamento (motor ADN/Playwright) continuam no worker — aqui só o filtro de seleção.
 */
export function respeitaFiltroAutenticacao(
  filtro: FiltroAutenticacaoSelecao,
  tipoAuth: 'certificado' | 'credenciais'
): boolean {
  if (filtro === 'todas') return true;
  return filtro === tipoAuth;
}

/**
 * Valida vínculo com a contabilidade do lote (quando informada).
 */
export function pertenceAContabilidade(
  contabilidadeLote: number | null | undefined,
  contabilidadeEmpresa: number | null | undefined
): boolean {
  if (contabilidadeLote == null || contabilidadeLote <= 0) return true;
  if (contabilidadeEmpresa == null) return false;
  return Number(contabilidadeEmpresa) === Number(contabilidadeLote);
}

/** Interfaces para tela Empresas (cadastro unificado) - API Express */

export type StatusGeral =
  | 'OPERACIONAL'
  | 'PARCIAL'
  | 'INOPERANTE'
  | 'ATENCAO';

export type CredStatusApi =
  | 'SEM_CREDENCIAIS'
  | 'INATIVA'
  | 'NAO_TESTADO'
  | 'TESTANDO'
  | 'OK'
  | 'INVALIDA'
  | 'ERRO_VALIDACAO';

/** Linha de empresa para painel operacional (tabela + cards). */
export interface EmpresaRow {
  id: string;
  cnpj: string;
  razao_social: string;
  contabilidade?: { id: number; nome: string } | null;
  possui_certificado: boolean;
  cert_validade: string | null;
  possui_credenciais: boolean;
  cred_status: CredStatusApi | null;
  cred_ultimo_teste_em: string | null;
  cred_ultima_mensagem: string | null;
}

export interface EmpresaListagemItem {
  id: string;
  cnpj: string;
  razao_social: string;
  regime?: string | null;
  contabilidade_id?: number | null;
  contabilidade_nome?: string | null;
  ativo?: boolean;
  created_at?: string;
  updated_at?: string;
  has_certificado: boolean;
  cert_validade: string | null;
  has_credenciais: boolean;
  cred_status: string | null;
  cred_ultimo_teste_em?: string | null;
  cred_ultima_mensagem?: string | null;
  status_geral?: StatusGeral | null;
  status_geral_motivo?: string | null;
}

/**
 * Adapta EmpresaListagemItem da API para EmpresaRow (painel operacional).
 * Deriva valores quando campos não existem no payload.
 */
export function toEmpresaRow(item: EmpresaListagemItem): EmpresaRow {
  const credStatus = (item.cred_status ?? '')
    .toString()
    .toUpperCase()
    .replace(/\s/g, '_');
  const credMap: Record<string, CredStatusApi> = {
    SEM_CREDENCIAIS: 'SEM_CREDENCIAIS',
    INATIVA: 'INATIVA',
    NAO_TESTADO: 'NAO_TESTADO',
    TESTANDO: 'TESTANDO',
    OK: 'OK',
    INVALIDA: 'INVALIDA',
    INVALIDO: 'INVALIDA',
    ERRO_VALIDACAO: 'ERRO_VALIDACAO',
  };
  const credStatusNorm = credMap[credStatus] ?? 'NAO_TESTADO';

  return {
    id: item.id,
    cnpj: item.cnpj,
    razao_social: item.razao_social,
    contabilidade:
      item.contabilidade_id != null && item.contabilidade_nome
        ? { id: item.contabilidade_id, nome: item.contabilidade_nome }
        : null,
    possui_certificado: Boolean(item.has_certificado),
    cert_validade: item.cert_validade ?? null,
    possui_credenciais: Boolean(item.has_credenciais),
    cred_status: item.has_credenciais ? credStatusNorm : null,
    cred_ultimo_teste_em: item.cred_ultimo_teste_em ?? null,
    cred_ultima_mensagem: item.cred_ultima_mensagem ?? null,
  };
}

export type SortField =
  | 'cnpj'
  | 'razao_social'
  | 'contabilidade_nome'
  | 'cert_validade'
  | 'has_credenciais'
  | 'status_geral';

export interface EmpresaListagemResponse {
  items: EmpresaListagemItem[];
  total: number;
  page: number;
  limit: number;
}

export interface EmpresasSummaryResponse {
  total_empresas: number;
  certificados_vencidos: number;
  credenciais_para_validar: number;
  operacionais: number;
}

export interface EmpresaDetalhes {
  empresa: {
    id: number;
    cnpj: string;
    razao_social: string;
    regime?: string | null;
    contabilidade_id?: number | null;
    ativo?: boolean;
    created_at?: string;
    updated_at?: string;
  };
  certificados?: Array<{
    id: number;
    cnpj: string;
    data_validade?: string | null;
    arquivo?: string | null;
  }>;
  certificados_digitais?: Array<{
    id: number;
    cnpj: string;
    data_validade?: string | null;
    arquivo?: string | null;
  }>;
  credenciais: Array<{
    id: number;
    tipo: string;
    usuario: string;
    status: string;
    ultimo_teste_em?: string | null;
  }>;
}

export interface CadastroCredencialPayload {
  cnpj: string;
  razao_social?: string;
  senha: string;
  tipo?: 'CNPJ_SENHA' | 'CPF_SENHA';
  usuario?: string;
  contabilidade_id?: number | null;
}

export interface CadastroResult {
  empresa: {
    id: number;
    cnpj: string;
    razao_social: string;
    regime?: string | null;
    contabilidade_id?: number | null;
  };
  has_cert: boolean;
  has_cred: boolean;
  cert_validade: string | null;
  cred_status: string | null;
}

// Imports - Certificados
export interface PreviewCertificadosResponse {
  session_id: string;
  items: Array<{
    indice: number;
    cnpj: string;
    razao_social: string;
    data_validade: string | null;
    existe_empresa: boolean;
    existe_certificado?: boolean;
    acao: 'IMPORTAR' | 'ERRO' | 'DUPLICADO';
    erro?: string;
  }>;
}

export interface ConfirmarCertificadosPayload {
  session_id: string;
  senha: string;
  itens: Array<{ indice: number }>;
  contabilidade_id?: number | null;
}

export interface ConfirmarCertificadosResponse {
  importados: number;
  erros: Array<{ indice: number; mensagem: string }>;
}

// Imports - Credenciais
export interface PreviewCredenciaisRow {
  rowIndex: number;
  linha: number;
  razao_social: string;
  tipo_login: 'CNPJ' | 'CPF';
  documento_raw: string;
  documento_digits: string;
  documento_formatado: string;
  regime: string | null;
  senha_masked: true;
  exists: boolean;
  valid: boolean;
  errors: string[];
  duplicado_na_planilha?: boolean;
}

export interface PreviewCredenciaisResponse {
  session_id: string;
  total: number;
  validos: number;
  erros: number;
  items: Array<{
    linha: number;
    razao_social: string;
    documento: string;
    tipo: string;
    existe_empresa: boolean;
    existe_credencial: boolean;
    acao: 'CRIAR_EMPRESA' | 'CRIAR_CREDENCIAL' | 'ATUALIZAR_CREDENCIAL' | 'ERRO';
    erro?: string;
  }>;
  rows: PreviewCredenciaisRow[];
}

export interface ConfirmarCredenciaisRow {
  rowIndex: number;
  contabilidade_id?: number;
}

export interface ConfirmarCredenciaisPayload {
  session_id: string;
  contabilidade_id_default: number;
  updateExisting: boolean;
  rows?: ConfirmarCredenciaisRow[];
  linhas_aprovadas?: number[];
}

export interface ConfirmarCredenciaisResultItem {
  rowIndex: number;
  status: 'IMPORTED' | 'UPDATED' | 'SKIPPED_EXISTS' | 'ERROR';
  message?: string;
}

export interface ConfirmarCredenciaisResponse {
  success: true;
  criadas: number;
  atualizadas: number;
  erros: number;
  skipped?: number;
  results: ConfirmarCredenciaisResultItem[];
}

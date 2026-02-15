/** Interfaces para tela Empresas (cadastro unificado) - API Express */

export type StatusGeral = 'OPERACIONAL' | 'PARCIAL' | 'INOPERANTE';

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
  status_geral?: StatusGeral | null;
  status_geral_motivo?: string | null;
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
    acao: 'IMPORTAR' | 'ERRO';
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
}

export interface ConfirmarCredenciaisPayload {
  session_id: string;
  linhas_aprovadas: number[];
}

export interface ConfirmarCredenciaisResponse {
  success: true;
  criadas: number;
  atualizadas: number;
  erros: number;
}

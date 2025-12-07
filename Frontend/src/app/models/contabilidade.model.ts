export interface Contabilidade {
  id: number;
  nome_contabilidade: string;
  cnpj: string;
  email?: string;
  telefone?: string;
  responsavel?: string;
  data_cadastro?: string;
  certificados_vinculados?: number;
}

export interface ContabilidadeCreate {
  nome_contabilidade: string;
  cnpj: string;
  email?: string;
  telefone?: string;
  responsavel?: string;
}

export interface ContabilidadeUpdate {
  nome_contabilidade?: string;
  email?: string;
  telefone?: string;
  responsavel?: string;
}

export interface ContabilidadeListResponse {
  contabilidades: Contabilidade[];
  total: number;
}







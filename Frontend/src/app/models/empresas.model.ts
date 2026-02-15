export interface Empresa {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string;
  regime?: string;
  contabilidade_id?: number | null;
  ativo?: boolean;
  created_at?: string;
}

export interface EmpresaCreate {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string;
  regime?: string;
  contabilidade_id?: number | null;
}

export interface EmpresaUpdate {
  razao_social?: string;
  nome_fantasia?: string;
  regime?: string;
  ativo?: boolean;
}


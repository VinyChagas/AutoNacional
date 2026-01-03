export interface Credencial {
  id?: number;
  empresa_id: string;
  portal: string;
  usuario: string;
  senha?: string; // Apenas para exibição quando desbloqueada
  tipo?: string;
  status?: string;
  atualizado_em?: string;
}

export interface CredencialCreate {
  empresa_id: string;
  portal?: string;
  usuario: string;
  senha: string;
  tipo_login: 'cpf' | 'cnpj';
}

export interface CredencialUpdate {
  senha?: string;
}

export interface CredencialResponse {
  id: number;
  empresa_id: number;
  tipo: string; // "CNPJ_SENHA" ou "CPF_SENHA"
  tipo_login?: 'cpf' | 'cnpj'; // Campo calculado: 'cpf' se tipo === 'CPF_SENHA', 'cnpj' se tipo === 'CNPJ_SENHA'
  usuario: string;
  status: string;
  ultimo_teste_em?: string;
  created_at: string;
  updated_at: string;
}

export interface CredencialListResponse {
  credenciais: CredencialResponse[];
  total: number;
}


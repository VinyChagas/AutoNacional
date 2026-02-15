/**
 * Serviço de empresas - regras de negócio e parse de parâmetros.
 */
import * as repo from './empresas.repo';
import type { EmpresaListagemParams } from './empresas.repo';

const SORT_WHITELIST = [
  'cnpj',
  'razao_social',
  'contabilidade_nome',
  'cert_validade',
  'has_credenciais',
  'status_geral',
] as const;

export interface ListarEmpresasQuery {
  search?: string;
  contabilidade_id?: string;
  has_cert?: string;
  has_cred?: string;
  sem_cert?: string;
  sem_cred?: string;
  sem_metodo?: string;
  page?: string;
  limit?: string;
  sort?: string;
  order?: string;
}

export function parseListarParams(query: ListarEmpresasQuery): EmpresaListagemParams {
  const contabilidadeId = query.contabilidade_id
    ? parseInt(query.contabilidade_id, 10)
    : undefined;
  const hasCert =
    query.has_cert === 'true' ? true : query.has_cert === 'false' ? false : undefined;
  const hasCred =
    query.has_cred === 'true' ? true : query.has_cred === 'false' ? false : undefined;
  const semCert = query.sem_cert === 'true';
  const semCred = query.sem_cred === 'true';
  const semMetodo = query.sem_metodo === 'true';
  const page = query.page ? parseInt(query.page, 10) : 1;
  const limit = query.limit ? parseInt(query.limit, 10) : 20;
  const sortRaw = query.sort?.trim()?.toLowerCase();
  const sort = sortRaw && SORT_WHITELIST.includes(sortRaw as (typeof SORT_WHITELIST)[number])
    ? (sortRaw as (typeof SORT_WHITELIST)[number])
    : undefined;
  const orderRaw = (query.order ?? '').toLowerCase();
  const order = orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : 'asc';

  return {
    search: query.search?.trim() || undefined,
    contabilidade_id: !isNaN(contabilidadeId!) && contabilidadeId! > 0 ? contabilidadeId : undefined,
    has_cert: hasCert,
    has_cred: hasCred,
    sem_cert: semCert,
    sem_cred: semCred,
  sem_metodo: semMetodo,
  page: isNaN(page) ? 1 : page,
  limit: isNaN(limit) ? 20 : limit,
  sort,
  order,
  };
}

export function validarFiltrosConflitantes(params: EmpresaListagemParams): string | null {
  if (params.has_cert === true && params.sem_cert) {
    return 'Não é possível filtrar por "com certificado" e "sem certificado" ao mesmo tempo';
  }
  if (params.has_cred === true && params.sem_cred) {
    return 'Não é possível filtrar por "com credenciais" e "sem credenciais" ao mesmo tempo';
  }
  if (params.has_cert === false && params.sem_cert) return null;
  if (params.has_cred === false && params.sem_cred) return null;
  return null;
}

export async function listarEmpresas(params: EmpresaListagemParams) {
  return repo.listarComAgregados(params);
}

export async function obterEmpresaPorId(id: number) {
  return repo.obterPorIdComDetalhes(id);
}

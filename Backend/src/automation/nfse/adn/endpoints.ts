/**
 * Bases e hosts oficiais do ADN Contribuintes (somente leitura).
 * Origem: Manual Contribuintes ADN + OpenAPI DistribuicaoContribuinte.
 */

export type AmbienteAdn = 'producao' | 'producao-restrita';

export const HOSTS_ADN = {
  producao: 'adn.nfse.gov.br',
  'producao-restrita': 'adn.producaorestrita.nfse.gov.br',
} as const;

export const BASE_URLS_ADN: Record<AmbienteAdn, string> = {
  producao: 'https://adn.nfse.gov.br/contribuintes',
  'producao-restrita': 'https://adn.producaorestrita.nfse.gov.br/contribuintes',
};

export function hostAdnPermitido(hostname: string): boolean {
  return hostname === HOSTS_ADN.producao || hostname === HOSTS_ADN['producao-restrita'];
}

export function montarUrlDistribuicaoDfe(params: {
  ambiente: AmbienteAdn;
  nsu: number;
  cnpjConsulta?: string;
  lote?: boolean;
  baseUrl?: string;
}): URL {
  const base = (params.baseUrl ?? BASE_URLS_ADN[params.ambiente]).replace(/\/+$/, '');
  const url = new URL(`${base}/DFe/${params.nsu}`);
  if (params.cnpjConsulta) {
    url.searchParams.set('cnpjConsulta', params.cnpjConsulta.replace(/\D/g, ''));
  }
  url.searchParams.set('lote', String(params.lote ?? true));
  if (url.protocol !== 'https:' || !hostAdnPermitido(url.hostname)) {
    throw new Error('Host ADN não autorizado.');
  }
  return url;
}

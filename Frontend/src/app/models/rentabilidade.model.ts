/** Modelos de cobrança simuláveis */
export interface ModeloCobrancaPorEmpresa {
  ativo: boolean;
  valorPorEmpresa: number;
  considerarApenasOk: boolean; // true = só OK, false = OK+ERRO
}

export interface ModeloCobrancaPorNota {
  ativo: boolean;
  valorPorNota: number;
}

export interface ModeloMensalidadeFixa {
  ativo: boolean;
  valorMensal: number;
}

export interface ModeloMinimoMensal {
  ativo: boolean;
  valorMinimo: number;
}

export interface ModeloFranquiaExcedente {
  ativo: boolean;
  franquiaNotas: number;
  valorPorNotaExcedente: number;
}

/** Custos fixos e variáveis */
export interface CustosFixos {
  infraVps: number;
  energiaInternet: number;
  licencasServicos: number;
  suporteHoras: number;
  suporteValorHora: number;
}

export interface CustosVariaveis {
  custoPorExecucao: number;
  custoPorNota: number;
  outros: { label: string; valor: number }[];
}

/** Meta para preço recomendado */
export interface MetaPreco {
  metaLucro?: number;
  metaMargem?: number; // 0-100
}

/** Cenário salvo (localStorage) */
export interface CenarioRentabilidade {
  id: string;
  nome: string;
  createdAt: string;
  competencia: string;
  contabilidade_id: number | null;
  receita: number;
  custo: number;
  lucro: number;
  margem: number;
  empresas_processadas: number;
  total_notas: number;
  tempo_total_segundos?: number;
}

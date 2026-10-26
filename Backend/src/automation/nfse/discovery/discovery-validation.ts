/**
 * Confirmação de filtro, duplicidades e fechamento do inventário.
 * Documento sem chave válida não entra no inventário fiscal.
 */
import {
  CODIGO_DIAGNOSTICO_INDETERMINADA,
  inferirNumeroNotaDosTextos,
  montarDiagnosticoNotaIndeterminada,
  resumoDiagnosticoIndeterminadaParaLog,
} from '../classification/diagnostico-indeterminada';
import {
  CODIGO_SITUACAO_DESCONHECIDO,
  CONFLITO_SITUACAO,
  classificarSituacao,
  evidenciasDaClassificacao,
} from '../classification/situacao';
import { criarDocumentoFiscal, type DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type EstadoCompletudeInventario } from '../contracts/inventario';
import { criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import { getLogger } from '../../../infrastructure/logger';
import type {
  DiagnosticoDescoberta,
  LeituraFiltroPortal,
  RegistroDescobertaNfse,
  ResultadoDescobertaNfse,
  StatusDescobertaNfse,
  TipoConsultaDescoberta,
} from './types';

const loggerIndeterminada = getLogger('nfse-situacao-indeterminada');

const CAMINHO_LISTAGEM: Record<DirecaoDocumentoFiscal, string> = {
  EMITIDA: '/Notas/Emitidas',
  RECEBIDA: '/Notas/Recebidas',
};

export function normalizarValorData(valor: string): string {
  const texto = valor.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) return texto;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return texto;
}

/** Lê datainicio/datafim da query (normalizados) sem exigir executar=1. */
export function lerDatasDaUrl(url: string): { inicio: string; fim: string } | null {
  try {
    const consulta = new URL(url).searchParams;
    const inicio = normalizarValorData(consulta.get('datainicio') ?? '');
    const fim = normalizarValorData(consulta.get('datafim') ?? '');
    if (!inicio && !fim) return null;
    return { inicio, fim };
  } catch {
    return null;
  }
}

/**
 * Datas na URL sem executar=1: preenchimento/parcial, não pesquisa concluída.
 * Contrato do Portal (GET observado): executar=1 + datainicio + datafim.
 */
export function urlTemPeriodoSemExecutar(
  url: string,
  periodo: PeriodoConsultaPortal
): boolean {
  try {
    const consulta = new URL(url).searchParams;
    if (consulta.get('executar') === '1') return false;
    const inicio = normalizarValorData(consulta.get('datainicio') ?? '');
    const fim = normalizarValorData(consulta.get('datafim') ?? '');
    return inicio === periodo.inicio && fim === periodo.fim;
  } catch {
    return false;
  }
}

/**
 * Monta o GET de pesquisa do Portal na mesma listagem (path) da URL atual.
 * Preserva origem/path (Emitidas vs Recebidas); não inclui tokens.
 */
export function montarUrlPesquisaPortal(
  urlAtual: string,
  periodo: PeriodoConsultaPortal
): string {
  const u = new URL(urlAtual);
  if (!/\/Notas\/(Emitidas|Recebidas)/i.test(u.pathname)) {
    throw new Error('URL atual não é listagem Emitidas/Recebidas para montar a pesquisa.');
  }
  const params = new URLSearchParams();
  params.set('executar', '1');
  params.set('busca', '');
  params.set('datainicio', periodo.inicio);
  params.set('datafim', periodo.fim);
  return `${u.origin}${u.pathname}?${params.toString()}`;
}

/** A pesquisa do portal é um GET com executar=1 e as duas datas do período. */
export function urlConfirmaPesquisa(url: string, periodo: PeriodoConsultaPortal): boolean {
  let consulta: URLSearchParams;
  try {
    consulta = new URL(url).searchParams;
  } catch {
    return false;
  }
  if (consulta.get('executar') !== '1') return false;
  const inicio = normalizarValorData(consulta.get('datainicio') ?? '');
  const fim = normalizarValorData(consulta.get('datafim') ?? '');
  return inicio === periodo.inicio && fim === periodo.fim;
}

export function confirmarFiltroAplicado(
  leitura: LeituraFiltroPortal,
  periodo: PeriodoConsultaPortal,
  direcao: DirecaoDocumentoFiscal
): { ok: boolean; erros: string[] } {
  const erros: string[] = [];
  const inicio = normalizarValorData(leitura.dataInicio);
  const fim = normalizarValorData(leitura.dataFim);
  const camposOk = inicio === periodo.inicio && fim === periodo.fim;
  if (!camposOk) {
    erros.push(
      `Filtro não aplicado: portal em ${inicio || 'vazio'}–${fim || 'vazio'}, esperado ${periodo.inicio}–${periodo.fim}.`
    );
  }

  const caminho = CAMINHO_LISTAGEM[direcao];
  const urlOk = leitura.url.includes(caminho);
  if (!urlOk) {
    erros.push(`URL não confirma a listagem ${caminho}: ${leitura.url || 'vazia'}.`);
  }

  const pesquisaExecutada = urlConfirmaPesquisa(leitura.url, periodo);
  if (camposOk && urlOk && !pesquisaExecutada) {
    erros.push(
      `Pesquisa não concluída para ${periodo.inicio}–${periodo.fim}: a URL não registra executar=1 com essas datas.`
    );
  }

  const vazioConfirmado = leitura.semRegistros && leitura.quantidadeLinhas === 0;
  const tabelaConfirmada = leitura.temTabela && leitura.quantidadeLinhas > 0 && !leitura.semRegistros;
  if (pesquisaExecutada && !vazioConfirmado && !tabelaConfirmada) {
    erros.push('Pesquisa registrada na URL, mas a tabela não confirmou linhas nem lista vazia.');
  }

  return { ok: erros.length === 0, erros };
}

export function diagnosticarDuplicidades(
  registros: readonly RegistroDescobertaNfse[]
): DiagnosticoDescoberta[] {
  const vistos = new Map<string, RegistroDescobertaNfse>();
  const diagnosticos: DiagnosticoDescoberta[] = [];

  for (const registro of registros) {
    if (!registro.chaveNacional) continue;
    const anterior = vistos.get(`${registro.direcao}:${registro.chaveNacional}`);
    if (anterior) {
      diagnosticos.push({
        codigo: 'DUPLICIDADE',
        mensagem: `Chave repetida em ${registro.direcao}, páginas ${anterior.pagina} e ${registro.pagina}.`,
        direcao: registro.direcao,
        pagina: registro.pagina,
        linha: registro.linha,
        chaveNacional: registro.chaveNacional,
      });
      continue;
    }
    vistos.set(`${registro.direcao}:${registro.chaveNacional}`, registro);
  }

  const porDirecao = new Map<DirecaoDocumentoFiscal, Set<string>>();
  for (const registro of registros) {
    if (!registro.chaveNacional) continue;
    const conjunto = porDirecao.get(registro.direcao) ?? new Set<string>();
    conjunto.add(registro.chaveNacional);
    porDirecao.set(registro.direcao, conjunto);
  }
  const emitidas = porDirecao.get('EMITIDA') ?? new Set<string>();
  const recebidas = porDirecao.get('RECEBIDA') ?? new Set<string>();
  for (const chave of emitidas) {
    if (!recebidas.has(chave)) continue;
    diagnosticos.push({
      codigo: 'CHAVE_EM_AMBAS_DIRECOES',
      mensagem: `Chave presente em emitidas e recebidas: ${chave}.`,
      chaveNacional: chave,
    });
  }

  return diagnosticos;
}

export function agregarStatusDescoberta(
  atual: StatusDescobertaNfse,
  proximo: StatusDescobertaNfse
): StatusDescobertaNfse {
  if (atual === 'DISCOVERY_FAILED' || proximo === 'DISCOVERY_FAILED') return 'DISCOVERY_FAILED';
  if (atual === 'DISCOVERY_INCOMPLETE' || proximo === 'DISCOVERY_INCOMPLETE') {
    return 'DISCOVERY_INCOMPLETE';
  }
  return 'DISCOVERY_COMPLETE';
}

export function completudeDoStatus(status: StatusDescobertaNfse): EstadoCompletudeInventario {
  if (status === 'DISCOVERY_COMPLETE') return 'COMPLETO';
  if (status === 'DISCOVERY_INCOMPLETE') return 'PARCIAL';
  return 'INDETERMINADO';
}

export function fecharDescoberta(input: {
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  tipo: TipoConsultaDescoberta;
  status: StatusDescobertaNfse;
  registros: readonly RegistroDescobertaNfse[];
  diagnosticos: readonly DiagnosticoDescoberta[];
  paginasPercorridas: number;
}): ResultadoDescobertaNfse {
  const duplicidades = diagnosticarDuplicidades(input.registros);
  const diagnosticos = [...input.diagnosticos, ...duplicidades];
  let status = input.status;
  if (duplicidades.some((item) => item.codigo === 'DUPLICIDADE' || item.codigo === 'CHAVE_EM_AMBAS_DIRECOES')) {
    status = agregarStatusDescoberta(status, 'DISCOVERY_INCOMPLETE');
  }
  if (input.registros.some((registro) => registro.chaveNacional == null)) {
    status = agregarStatusDescoberta(status, 'DISCOVERY_INCOMPLETE');
  }

  const chavesBloqueadas = new Set(
    diagnosticos
      .filter((item) => item.codigo === 'CHAVE_EM_AMBAS_DIRECOES' && item.chaveNacional)
      .map((item) => item.chaveNacional as string)
  );
  const chavesIncluidas = new Set<string>();
  const documentos = [];

  for (const registro of input.registros) {
    if (!registro.chaveNacional || chavesBloqueadas.has(registro.chaveNacional)) continue;
    if (chavesIncluidas.has(registro.chaveNacional)) continue;
    chavesIncluidas.add(registro.chaveNacional);
    const classificacao = classificarSituacao(registro.evidenciaSituacao);
    if (classificacao.conflitos.includes(CONFLITO_SITUACAO)) {
      diagnosticos.push({
        codigo: CONFLITO_SITUACAO,
        mensagem: 'A coluna Situação traz evidências atuais incompatíveis. A nota permanece indeterminada.',
        direcao: registro.direcao,
        pagina: registro.pagina,
        linha: registro.linha,
        chaveNacional: registro.chaveNacional,
      });
    }
    if (classificacao.codigoSituacaoDesconhecido) {
      diagnosticos.push({
        codigo: CODIGO_SITUACAO_DESCONHECIDO,
        mensagem: `Código data-situacao não observado: ${classificacao.codigoSituacaoDesconhecido}.`,
        direcao: registro.direcao,
        pagina: registro.pagina,
        linha: registro.linha,
        chaveNacional: registro.chaveNacional,
      });
    }
    // API-03L — toda INDETERMINADA gera diagnóstico estruturado (mesmo sem código desconhecido).
    if (classificacao.situacao === 'INDETERMINADA') {
      const diag = montarDiagnosticoNotaIndeterminada({
        cnpj: input.cnpj,
        periodoConsulta: input.periodoConsulta,
        chaveNacional: registro.chaveNacional,
        numeroNota: inferirNumeroNotaDosTextos(registro.textosCelulas ?? null),
        direcao: registro.direcao,
        pagina: registro.pagina,
        linha: registro.linha,
        evidencia: registro.evidenciaSituacao,
        classificacao,
      });
      diagnosticos.push({
        codigo: CODIGO_DIAGNOSTICO_INDETERMINADA,
        mensagem: `${diag.motivoBloqueio} chave=${diag.chaveNacional} regra=${diag.regraAplicada}`,
        direcao: registro.direcao,
        pagina: registro.pagina,
        linha: registro.linha,
        chaveNacional: registro.chaveNacional,
      });
      loggerIndeterminada.warn(
        resumoDiagnosticoIndeterminadaParaLog(diag),
        'NFS-e indeterminada — bloqueio fiscal estruturado'
      );
    }
    documentos.push(
      criarDocumentoFiscal({
        chaveNacional: registro.chaveNacional,
        cnpj: input.cnpj,
        direcao: registro.direcao,
        situacao: classificacao.situacao,
        periodoConsulta: input.periodoConsulta,
        origemClassificacao: classificacao.origemClassificacao,
        evidencias: evidenciasDaClassificacao(classificacao),
      })
    );
  }

  const periodo = criarPeriodoConsultaPortal(input.periodoConsulta.inicio, input.periodoConsulta.fim);
  const inventario = montarInventario({
    id: `desc-${input.cnpj}-${periodo.inicio.replace(/\//g, '')}-${periodo.fim.replace(/\//g, '')}`,
    cnpj: input.cnpj,
    periodoConsulta: periodo,
    documentos,
    completude: completudeDoStatus(status),
  });

  return {
    cnpj: inventario.cnpj,
    periodoConsulta: periodo,
    tipo: input.tipo,
    status,
    inventario,
    registros: [...input.registros],
    diagnosticos,
    paginasPercorridas: input.paginasPercorridas,
  };
}

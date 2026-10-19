/**
 * Percorre a listagem já autenticada.
 * Não abre browser, não baixa arquivo e não encerra a Page.
 */
import { normalizarCnpjEmpresa, type DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { ContratoNfseError } from '../contracts/erros';
import { criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import {
  agregarStatusDescoberta,
  confirmarFiltroAplicado,
  fecharDescoberta,
} from './discovery-validation';
import { LIMITE_SEGURANCA_PAGINAS } from './pagination';
import { registroDaLinha } from './row-parser';
import type {
  DiagnosticoDescoberta,
  PortalListagem,
  RegistroDescobertaNfse,
  ResultadoDescobertaNfse,
  StatusDescobertaNfse,
  TipoConsultaDescoberta,
} from './types';
import { TIPOS_CONSULTA_DESCOBERTA } from './types';

function direcoesDe(tipo: TipoConsultaDescoberta): DirecaoDocumentoFiscal[] {
  if (tipo === 'EMITIDAS') return ['EMITIDA'];
  if (tipo === 'RECEBIDAS') return ['RECEBIDA'];
  return ['EMITIDA', 'RECEBIDA'];
}

function validarTipo(tipo: string): TipoConsultaDescoberta {
  if ((TIPOS_CONSULTA_DESCOBERTA as readonly string[]).includes(tipo)) {
    return tipo as TipoConsultaDescoberta;
  }
  throw new ContratoNfseError(`Tipo de consulta não permitido: ${tipo}.`);
}

interface Percurso {
  status: StatusDescobertaNfse;
  registros: RegistroDescobertaNfse[];
  diagnosticos: DiagnosticoDescoberta[];
  paginasPercorridas: number;
}

async function percorrerDirecao(
  portal: PortalListagem,
  direcao: DirecaoDocumentoFiscal,
  periodo: PeriodoConsultaPortal,
  maxPaginas: number
): Promise<Percurso> {
  const diagnosticos: DiagnosticoDescoberta[] = [];
  const registros: RegistroDescobertaNfse[] = [];

  try {
    await portal.abrir(direcao);
  } catch (erro) {
    diagnosticos.push({
      codigo: 'NAV_FALHA',
      mensagem: `Falha ao abrir ${direcao}: ${erro instanceof Error ? erro.message : String(erro)}`,
      direcao,
    });
    return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas: 0 };
  }

  let leitura;
  try {
    leitura = await portal.aplicarPeriodo(periodo, direcao);
  } catch (erro) {
    diagnosticos.push({
      codigo: 'NAV_FALHA',
      mensagem: `Falha ao aplicar o período em ${direcao}: ${erro instanceof Error ? erro.message : String(erro)}`,
      direcao,
    });
    return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas: 0 };
  }

  const filtro = confirmarFiltroAplicado(leitura, periodo, direcao);
  if (!filtro.ok) {
    for (const erro of filtro.erros) {
      diagnosticos.push({ codigo: 'FILTRO_NAO_APLICADO', mensagem: erro, direcao });
    }
    return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas: 0 };
  }

  const fingerprints: string[] = [];
  let ordinal = 1;
  let paginasPercorridas = 0;
  let totalizador: number | null = null;
  let pendente: Awaited<ReturnType<PortalListagem['capturar']>> | null = null;

  while (true) {
    let pagina;
    try {
      pagina = pendente ?? (await portal.capturar(ordinal, direcao));
      pendente = null;
    } catch (erro) {
      diagnosticos.push({
        codigo: 'NAV_FALHA',
        mensagem: `Falha ao capturar a página ${ordinal} de ${direcao}: ${erro instanceof Error ? erro.message : String(erro)}`,
        direcao,
        pagina: ordinal,
      });
      return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas };
    }

    if (fingerprints.includes(pagina.fingerprint)) {
      diagnosticos.push({
        codigo: 'PAGINA_REPETIDA',
        mensagem: `A página ${ordinal} de ${direcao} repete conteúdo já visto.`,
        direcao,
        pagina: ordinal,
      });
      return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas };
    }

    fingerprints.push(pagina.fingerprint);
    paginasPercorridas += 1;
    if (pagina.totalizador != null) totalizador = pagina.totalizador;

    for (const linha of pagina.linhas) {
      const registro = registroDaLinha({ ...linha, pagina: pagina.paginaIndicador ?? ordinal }, direcao);
      registros.push(registro);
      for (const codigo of registro.problemas) {
        diagnosticos.push({
          codigo,
          mensagem: `Linha ${registro.linha + 1} da página ${registro.pagina} sem chave nacional confirmada.`,
          direcao,
          pagina: registro.pagina,
          linha: registro.linha,
        });
      }
    }

    if (pagina.semRegistros && pagina.linhas.length === 0) {
      if (totalizador != null && totalizador !== 0) {
        diagnosticos.push({
          codigo: 'TOTALIZADOR_DIVERGENTE',
          mensagem: `O portal indica ${totalizador} registros em ${direcao}, mas a lista veio vazia.`,
          direcao,
        });
        return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas };
      }
      return { status: 'DISCOVERY_COMPLETE', registros, diagnosticos, paginasPercorridas };
    }

    if (pagina.linhas.length === 0 && !pagina.semRegistros) {
      diagnosticos.push({
        codigo: 'LISTA_VAZIA_NAO_CONFIRMADA',
        mensagem: `A listagem de ${direcao} não trouxe linhas nem a mensagem de ausência.`,
        direcao,
        pagina: ordinal,
      });
      return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas };
    }

    if (!pagina.proxima.presente || pagina.proxima.desabilitado) {
      if (totalizador != null && totalizador !== registros.length) {
        diagnosticos.push({
          codigo: 'TOTALIZADOR_DIVERGENTE',
          mensagem: `O portal indica ${totalizador} registros em ${direcao}; a descoberta leu ${registros.length}.`,
          direcao,
        });
        return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas };
      }
      return { status: 'DISCOVERY_COMPLETE', registros, diagnosticos, paginasPercorridas };
    }

    if (paginasPercorridas >= maxPaginas) {
      diagnosticos.push({
        codigo: 'LIMITE_PAGINAS',
        mensagem: `Limite de segurança de ${maxPaginas} páginas atingido em ${direcao}.`,
        direcao,
        pagina: ordinal,
      });
      return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas };
    }

    let avancou = false;
    try {
      avancou = await portal.avancar(direcao);
    } catch (erro) {
      diagnosticos.push({
        codigo: 'NAV_FALHA',
        mensagem: `Falha ao avançar ${direcao}: ${erro instanceof Error ? erro.message : String(erro)}`,
        direcao,
        pagina: ordinal,
      });
      return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas };
    }
    if (!avancou) {
      diagnosticos.push({
        codigo: 'PAGINACAO_NAO_AVANCOU',
        mensagem: `O botão de próxima página de ${direcao} não pôde ser acionado.`,
        direcao,
        pagina: ordinal,
      });
      return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas };
    }

    let seguinte;
    try {
      seguinte = await portal.capturar(ordinal + 1, direcao);
    } catch (erro) {
      diagnosticos.push({
        codigo: 'NAV_FALHA',
        mensagem: `Falha ao ler a página seguinte de ${direcao}: ${erro instanceof Error ? erro.message : String(erro)}`,
        direcao,
        pagina: ordinal + 1,
      });
      return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas };
    }

    if (seguinte.fingerprint === pagina.fingerprint) {
      diagnosticos.push({
        codigo: 'PAGINACAO_NAO_AVANCOU',
        mensagem: `O clique em próxima página não alterou a listagem de ${direcao}.`,
        direcao,
        pagina: ordinal,
      });
      return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas };
    }

    pendente = seguinte;
    ordinal += 1;
  }
}

export async function executarDescoberta(
  portal: PortalListagem,
  input: {
    cnpj: string;
    periodoConsulta: PeriodoConsultaPortal;
    tipo: TipoConsultaDescoberta;
    maxPaginas?: number;
  }
): Promise<ResultadoDescobertaNfse> {
  const cnpj = normalizarCnpjEmpresa(input.cnpj);
  const periodo = criarPeriodoConsultaPortal(input.periodoConsulta.inicio, input.periodoConsulta.fim);
  const tipo = validarTipo(input.tipo);
  const maxPaginas = input.maxPaginas ?? LIMITE_SEGURANCA_PAGINAS;
  if (!Number.isInteger(maxPaginas) || maxPaginas < 1) {
    throw new ContratoNfseError('Limite de páginas inválido.');
  }

  let status: StatusDescobertaNfse = 'DISCOVERY_COMPLETE';
  const registros: RegistroDescobertaNfse[] = [];
  const diagnosticos: DiagnosticoDescoberta[] = [];
  let paginasPercorridas = 0;

  for (const direcao of direcoesDe(tipo)) {
    const percurso = await percorrerDirecao(portal, direcao, periodo, maxPaginas);
    status = agregarStatusDescoberta(status, percurso.status);
    registros.push(...percurso.registros);
    diagnosticos.push(...percurso.diagnosticos);
    paginasPercorridas += percurso.paginasPercorridas;
    if (percurso.status === 'DISCOVERY_FAILED') break;
  }

  return fecharDescoberta({
    cnpj,
    periodoConsulta: periodo,
    tipo,
    status,
    registros,
    diagnosticos,
    paginasPercorridas,
  });
}

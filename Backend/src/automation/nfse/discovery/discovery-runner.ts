/**
 * Percorre a listagem já autenticada.
 * Não abre browser, não baixa arquivo e não encerra a Page.
 */
import { normalizarCnpjEmpresa, type DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { ContratoNfseError } from '../contracts/erros';
import { criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import { exigirControleDescoberta } from './controle-descoberta';
import {
  agregarStatusDescoberta,
  confirmarFiltroAplicado,
  fecharDescoberta,
} from './discovery-validation';
import { LIMITE_SEGURANCA_PAGINAS } from './pagination';
import { PortalDescobertaError } from './page-capture';
import { urlDiagnosticoPortal } from './portal-selectors';
import { registroDaLinha } from './row-parser';
import type {
  ControleDescoberta,
  DiagnosticoDescoberta,
  PortalListagem,
  RegistroDescobertaNfse,
  ResultadoDescobertaNfse,
  StatusDescobertaNfse,
  TipoConsultaDescoberta,
} from './types';
import { TIPOS_CONSULTA_DESCOBERTA } from './types';

function diagnosticoDeErroPortal(
  codigo: string,
  mensagemBase: string,
  direcao: DirecaoDocumentoFiscal,
  erro: unknown,
  extras?: { pagina?: number }
): DiagnosticoDescoberta {
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  if (erro instanceof PortalDescobertaError) {
    return {
      codigo,
      mensagem: `${mensagemBase} [${erro.etapa}] ${erro.message}`,
      direcao,
      etapa: erro.etapa,
      seletor: erro.seletor,
      url: erro.url,
      ...extras,
    };
  }
  return {
    codigo,
    mensagem: `${mensagemBase} ${detalhe}`,
    direcao,
    ...extras,
  };
}

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
  maxPaginas: number,
  controle: ControleDescoberta | undefined,
  maxDocumentos: number | undefined
): Promise<Percurso> {
  const diagnosticos: DiagnosticoDescoberta[] = [];
  const registros: RegistroDescobertaNfse[] = [];

  try {
    exigirControleDescoberta(controle, 'antes_navegacao');
    await portal.abrir(direcao);
  } catch (erro) {
    if (erro instanceof ContratoNfseError && /interrompida/i.test(erro.message)) {
      diagnosticos.push({
        codigo: 'INTERRUPCAO',
        mensagem: erro.message,
        direcao,
      });
      return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas: 0 };
    }
    diagnosticos.push(
      diagnosticoDeErroPortal(
        'NAV_FALHA',
        `Falha ao abrir ${direcao}:`,
        direcao,
        erro
      )
    );
    return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas: 0 };
  }

  let leitura;
  try {
    exigirControleDescoberta(controle, 'antes_navegacao');
    leitura = await portal.aplicarPeriodo(periodo, direcao);
  } catch (erro) {
    if (erro instanceof ContratoNfseError && /interrompida/i.test(erro.message)) {
      diagnosticos.push({
        codigo: 'INTERRUPCAO',
        mensagem: erro.message,
        direcao,
      });
      return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas: 0 };
    }
    diagnosticos.push(
      diagnosticoDeErroPortal(
        'NAV_FALHA',
        `Falha ao aplicar o período em ${direcao}:`,
        direcao,
        erro
      )
    );
    return { status: 'DISCOVERY_FAILED', registros, diagnosticos, paginasPercorridas: 0 };
  }

  const filtro = confirmarFiltroAplicado(leitura, periodo, direcao);
  if (!filtro.ok) {
    const url = urlDiagnosticoPortal(leitura.url);
    for (const erro of filtro.erros) {
      diagnosticos.push({
        codigo: 'FILTRO_NAO_APLICADO',
        mensagem: erro,
        direcao,
        etapa: 'confirmar_filtro',
        url,
      });
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
      exigirControleDescoberta(controle, 'antes_pagina');
      pagina =
        pendente ??
        (await portal.capturar(ordinal, direcao, { acumuladosAntes: registros.length }));
      pendente = null;
    } catch (erro) {
      if (erro instanceof ContratoNfseError && /interrompida/i.test(erro.message)) {
        diagnosticos.push({
          codigo: 'INTERRUPCAO',
          mensagem: erro.message,
          direcao,
          pagina: ordinal,
        });
        return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas };
      }
      diagnosticos.push(
        diagnosticoDeErroPortal(
          'NAV_FALHA',
          `Falha ao capturar a página ${ordinal} de ${direcao}:`,
          direcao,
          erro,
          { pagina: ordinal }
        )
      );
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

    try {
      exigirControleDescoberta(controle, 'antes_extracao');
      for (const linha of pagina.linhas) {
        const registro = registroDaLinha(
          { ...linha, pagina: pagina.paginaIndicador ?? ordinal },
          direcao
        );
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
      exigirControleDescoberta(controle, 'apos_pagina');
    } catch (erro) {
      if (erro instanceof ContratoNfseError && /interrompida/i.test(erro.message)) {
        diagnosticos.push({
          codigo: 'INTERRUPCAO',
          mensagem: erro.message,
          direcao,
          pagina: ordinal,
        });
        return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas };
      }
      throw erro;
    }

    if (
      maxDocumentos != null &&
      Number.isInteger(maxDocumentos) &&
      maxDocumentos >= 0 &&
      registros.length > maxDocumentos
    ) {
      diagnosticos.push({
        codigo: 'LIMITE_DOCUMENTOS',
        mensagem: `Limite de documentos atingido em ${direcao} (${registros.length} > ${maxDocumentos}).`,
        direcao,
        pagina: ordinal,
      });
      return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas };
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
        mensagem: `Limite de ${maxPaginas} páginas atingido em ${direcao} (orçamento da execução).`,
        direcao,
        pagina: ordinal,
      });
      // Truncamento controlado — inventário incompleto, nunca cobertura 100%.
      return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas };
    }

    let avancou = false;
    try {
      exigirControleDescoberta(controle, 'antes_avancar');
      avancou = await portal.avancar(direcao);
    } catch (erro) {
      if (erro instanceof ContratoNfseError && /interrompida/i.test(erro.message)) {
        diagnosticos.push({
          codigo: 'INTERRUPCAO',
          mensagem: erro.message,
          direcao,
          pagina: ordinal,
        });
        return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas };
      }
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
      exigirControleDescoberta(controle, 'antes_pagina');
      seguinte = await portal.capturar(ordinal + 1, direcao, {
        acumuladosAntes: registros.length,
      });
    } catch (erro) {
      if (erro instanceof ContratoNfseError && /interrompida/i.test(erro.message)) {
        diagnosticos.push({
          codigo: 'INTERRUPCAO',
          mensagem: erro.message,
          direcao,
          pagina: ordinal + 1,
        });
        return { status: 'DISCOVERY_INCOMPLETE', registros, diagnosticos, paginasPercorridas };
      }
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
    /** Teto de documentos nesta chamada (orçamento restante da execução). */
    maxDocumentos?: number;
    controle?: ControleDescoberta;
  }
): Promise<ResultadoDescobertaNfse> {
  const cnpj = normalizarCnpjEmpresa(input.cnpj);
  const periodo = criarPeriodoConsultaPortal(input.periodoConsulta.inicio, input.periodoConsulta.fim);
  const tipo = validarTipo(input.tipo);
  const maxPaginas = input.maxPaginas ?? LIMITE_SEGURANCA_PAGINAS;
  if (!Number.isInteger(maxPaginas) || maxPaginas < 1) {
    throw new ContratoNfseError('Limite de páginas inválido.');
  }
  if (
    input.maxDocumentos != null &&
    (!Number.isInteger(input.maxDocumentos) || input.maxDocumentos < 0)
  ) {
    throw new ContratoNfseError('Limite de documentos inválido.');
  }

  let status: StatusDescobertaNfse = 'DISCOVERY_COMPLETE';
  const registros: RegistroDescobertaNfse[] = [];
  const diagnosticos: DiagnosticoDescoberta[] = [];
  let paginasPercorridas = 0;
  let documentosRestantes = input.maxDocumentos;

  for (const direcao of direcoesDe(tipo)) {
    exigirControleDescoberta(input.controle, 'antes_navegacao');
    const orcamentoPaginas = maxPaginas - paginasPercorridas;
    if (orcamentoPaginas < 1) {
      diagnosticos.push({
        codigo: 'LIMITE_PAGINAS',
        mensagem: `Orçamento global de ${maxPaginas} páginas esgotado antes de ${direcao}.`,
        direcao,
      });
      status = agregarStatusDescoberta(status, 'DISCOVERY_INCOMPLETE');
      break;
    }
    const percurso = await percorrerDirecao(
      portal,
      direcao,
      periodo,
      orcamentoPaginas,
      input.controle,
      documentosRestantes
    );
    status = agregarStatusDescoberta(status, percurso.status);
    registros.push(...percurso.registros);
    diagnosticos.push(...percurso.diagnosticos);
    paginasPercorridas += percurso.paginasPercorridas;
    if (documentosRestantes != null) {
      documentosRestantes = Math.max(0, documentosRestantes - percurso.registros.length);
    }
    if (percurso.status === 'DISCOVERY_FAILED') break;
    if (percurso.status === 'DISCOVERY_INCOMPLETE') break;
    if (paginasPercorridas >= maxPaginas) break;
    if (documentosRestantes === 0 && input.maxDocumentos != null) break;
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

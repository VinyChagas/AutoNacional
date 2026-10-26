/**
 * Consulta uma NFS-e na SEFIN e decide se o inventário pode iniciar a recuperação.
 * Não grava arquivo, não abre navegador e não usa a sessão do Playwright.
 */
import { createHash } from 'node:crypto';
import { getLogger } from '../../../infrastructure/logger';
import { normalizarCnpjEmpresa, validarChaveNacional, validarSituacaoFiscal } from '../contracts/documento-fiscal';
import type { DirecaoDocumentoFiscal, DocumentoFiscalNfse } from '../contracts/documento-fiscal';
import { ContratoNfseError } from '../contracts/erros';
import type { InventarioNfse } from '../contracts/inventario';
import { inspecionarCredencialMtls } from './mtls-provider';
import { classificarStatusHttp, extrairXmlDaRespostaSefin } from './response-parser';
import { classificarFalhaTransporte, montarUrlConsultaSefin } from './sefin-client';
import {
  ErroRecuperacaoSefin,
  LIMITES_RECUPERACAO_PADRAO,
  type EntradaRecuperacaoSefin,
  type LimitesRecuperacaoSefin,
  type RegistroLogRecuperacao,
  type ResultadoRecuperacaoSefin,
} from './types';
import { validarXmlNfse, vinculoCnpjAusenteParaDirecao } from './xml-validator';

const loggerPadrao = getLogger('nfse-recovery');

export interface PlanoRecuperacaoSefin {
  podeIniciar: boolean;
  codigo: string | null;
  classe: 'BLOQUEANTE' | null;
  mensagem: string;
  elegiveis: DocumentoFiscalNfse[];
  excluidas: string[];
}

export async function recuperarXmlNfse(entrada: EntradaRecuperacaoSefin): Promise<ResultadoRecuperacaoSefin> {
  if (!/^\d{50}$/.test(entrada.chave)) {
    throw new ContratoNfseError('Chave nacional inválida: esperado 50 dígitos.');
  }
  const chave = validarChaveNacional(entrada.chave);
  const cnpj = normalizarCnpjEmpresa(entrada.cnpj);
  const direcao = validarDirecao(entrada.direcao);
  const limites = { ...LIMITES_RECUPERACAO_PADRAO, ...entrada.limites };
  const log = entrada.log ?? adaptarLogger();
  const base = {
    chaveNacional: chave,
    cnpj,
    direcao,
    periodoConsulta: entrada.periodoConsulta ?? null,
  };

  // API-03M — só cancelada fica fora da SEFIN; indeterminada consulta normalmente.
  if (entrada.situacao === 'CANCELADA') {
    return falha(base, {
      resultado: 'BLOQUEADO',
      validacaoXml: 'NAO_APLICADA',
      classeErro: 'BLOQUEANTE',
      codigo: 'NOTA_CANCELADA',
      mensagem: 'Nota cancelada permanece no inventário e não é consultada na SEFIN.',
    });
  }
  if (entrada.situacao) validarSituacaoFiscal(entrada.situacao);

  if (!entrada.credencial) {
    return falha(base, {
      resultado: 'BLOQUEADO',
      validacaoXml: 'NAO_APLICADA',
      classeErro: 'BLOQUEANTE',
      codigo: 'CERTIFICADO_INDISPONIVEL',
      mensagem: 'Certificado A1 indisponível para a consulta SEFIN.',
    });
  }

  try {
    inspecionarCredencialMtls(entrada.credencial);
    const url = montarUrlConsultaSefin(chave, entrada.baseUrl);
    registrar(log, 'info', chave, cnpj, 'Consultando NFS-e na SEFIN.');
    const resposta = await entrada.transporte.consultar(url, entrada.credencial, limites);
    if (resposta.body.length > limites.maxBytesResposta) {
      throw new ErroRecuperacaoSefin(
        'LIMITE_RESPOSTA',
        'PERMANENTE',
        'Resposta da SEFIN excede o limite configurado.'
      );
    }
    const status = classificarStatusHttp(resposta.status);
    if (status) {
      throw new ErroRecuperacaoSefin(status.codigo, status.classe, status.mensagem);
    }
    const xml = await extrairXmlDaRespostaSefin(resposta.body, limites.maxBytesGzip, limites.maxBytesXml);
    const leitura = validarXmlNfse(xml, { chave, cnpj, direcao });
    if (leitura.validacao !== 'CONFIRMADA') {
      // API-03H — transitório: permite retentativa controlada só desta chave
      // (não marca FALHA_PERMANENTE). XML ausente/incompleto na SEFIN pode estabilizar.
      const detalhe = [
        leitura.chaveXml ? null : 'chave ausente no XML',
        vinculoCnpjAusenteParaDirecao(leitura, direcao)
          ? direcao === 'EMITIDA'
            ? 'CNPJ emitente ausente'
            : 'CNPJ tomador/intermediário ausente'
          : null,
      ]
        .filter(Boolean)
        .join('; ');
      return falha(base, {
        resultado: 'FALHOU',
        validacaoXml: 'PENDENTE',
        classeErro: 'TRANSITORIO',
        codigo: 'VALIDACAO_INSUFICIENTE',
        mensagem: detalhe
          ? `O XML não permite confirmar a chave e o vínculo com o CNPJ (${detalhe}).`
          : 'O XML não permite confirmar a chave e o vínculo com o CNPJ.',
        dCompet: leitura.dCompet,
      });
    }
    const papel = leitura.papelConfirmado;
    registrar(
      log,
      'info',
      chave,
      cnpj,
      papel === 'INTERMEDIARIO'
        ? 'XML da SEFIN confirmado (vínculo intermediário).'
        : 'XML da SEFIN confirmado.'
    );
    return {
      ...base,
      resultado: 'RECUPERADO',
      validacaoXml: 'CONFIRMADA',
      classeErro: null,
      codigo: null,
      mensagem:
        papel === 'INTERMEDIARIO'
          ? 'XML recuperado e confirmado (papel INTERMEDIARIO).'
          : 'XML recuperado e confirmado.',
      dCompet: leitura.dCompet,
      hashSha256: createHash('sha256').update(xml).digest('hex'),
      xml,
      papelFiscal: papel,
    };
  } catch (erro) {
    const classificado = erro instanceof ErroRecuperacaoSefin ? erro : classificarFalhaTransporte(erro);
    registrar(log, 'warn', chave, cnpj, classificado.message, classificado.codigo);
    return falha(base, {
      resultado: classificado.classe === 'BLOQUEANTE' ? 'BLOQUEADO' : 'FALHOU',
      validacaoXml: 'FALHOU',
      classeErro: classificado.classe,
      codigo: classificado.codigo,
      mensagem: classificado.message,
    });
  }
}

export function planejarRecuperacaoSefin(inventario: InventarioNfse): PlanoRecuperacaoSefin {
  const chaves = inventario.documentos.map((documento) => documento.chaveNacional);
  const repetidas = chaves.filter((chave, indice) => chaves.indexOf(chave) !== indice);
  const chaveInvalida = chaves.some((chave) => !/^\d{50}$/.test(chave));
  const totais = inventario.totais;
  const somaSituacoes = totais.vigentes + totais.canceladas + totais.indeterminadas;
  const inconsistente =
    totais.descobertos !== inventario.documentos.length ||
    somaSituacoes !== totais.descobertos ||
    totais.emitidas + totais.recebidas !== totais.descobertos;

  if (inventario.completude !== 'COMPLETO' || chaveInvalida || repetidas.length > 0 || inconsistente) {
    return bloqueio(
      inventario.completude !== 'COMPLETO' ? 'DESCOBERTA_INCOMPLETA' : 'INCONSISTENCIA_INVENTARIO',
      'O inventário não autoriza o início da recuperação.'
    );
  }
  return {
    podeIniciar: true,
    codigo: null,
    classe: null,
    mensagem:
      'Plano de recuperação autorizado para vigentes e indeterminadas (API-03M).',
    elegiveis: inventario.documentos.filter(
      (documento) =>
        documento.situacao === 'VIGENTE' || documento.situacao === 'INDETERMINADA'
    ),
    excluidas: inventario.documentos
      .filter((documento) => documento.situacao === 'CANCELADA')
      .map((documento) => documento.chaveNacional),
  };
}

function bloqueio(codigo: string, mensagem: string): PlanoRecuperacaoSefin {
  return {
    podeIniciar: false,
    codigo,
    classe: 'BLOQUEANTE',
    mensagem,
    elegiveis: [],
    excluidas: [],
  };
}

function validarDirecao(valor: string): DirecaoDocumentoFiscal {
  if (valor === 'EMITIDA' || valor === 'RECEBIDA') return valor;
  throw new ContratoNfseError(`Direção fiscal não permitida: ${valor}.`);
}

function falha(
  base: Pick<ResultadoRecuperacaoSefin, 'chaveNacional' | 'cnpj' | 'direcao' | 'periodoConsulta'>,
  parcial: Omit<
    ResultadoRecuperacaoSefin,
    'chaveNacional' | 'cnpj' | 'direcao' | 'periodoConsulta' | 'dCompet' | 'hashSha256' | 'xml'
  > & { dCompet?: string | null }
): ResultadoRecuperacaoSefin {
  return {
    ...base,
    dCompet: parcial.dCompet ?? null,
    hashSha256: null,
    xml: null,
    resultado: parcial.resultado,
    validacaoXml: parcial.validacaoXml,
    classeErro: parcial.classeErro,
    codigo: parcial.codigo,
    mensagem: parcial.mensagem,
  };
}

function registrar(
  log: RegistroLogRecuperacao,
  nivel: 'info' | 'warn',
  chave: string,
  cnpj: string,
  mensagem: string,
  codigo?: string
): void {
  log[nivel](
    {
      chave: `${chave.slice(0, 4)}…${chave.slice(-4)}`,
      cnpj: `${cnpj.slice(0, 2)}***${cnpj.slice(-2)}`,
      codigo: codigo ?? null,
    },
    mensagem
  );
}

function adaptarLogger(): RegistroLogRecuperacao {
  return {
    info(dados, mensagem) {
      loggerPadrao.info(dados, mensagem);
    },
    warn(dados, mensagem) {
      loggerPadrao.warn(dados, mensagem);
    },
  };
}

export function limitesDaConsulta(parcial?: Partial<LimitesRecuperacaoSefin>): LimitesRecuperacaoSefin {
  return { ...LIMITES_RECUPERACAO_PADRAO, ...parcial };
}


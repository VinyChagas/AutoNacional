/**
 * Ponte mínima entre execution-service e o orquestrador nativo.
 * Flag global + autorização explícita por execução. Sem autorização = legado.
 * Pedido nativo com pré-condições inválidas = NATIVO_RECUSADO (erro, sem fallback).
 */
import type { Page } from 'playwright';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import { discoverNfse } from '../discovery/discovery-service';
import { recuperarXmlNfse } from '../recovery/recovery-service';
import { criarTransporteHttpsMtls } from '../recovery/sefin-client';
import {
  AdaptadorCertificadoA1,
  RepositorioFiscalNfse,
  criarResolvedorRaizInjetada,
  criarFonteA1DoCadastro,
} from '../infrastructure';
import {
  flagRecuperacaoNativaAtiva,
  lerFlagRecuperacaoNativa,
  lerRaizFiscalNativa,
} from './feature-flag';
import { executarFluxoFiscalNativo } from './native-orchestrator';
import {
  OrquestracaoNfseError,
  autorizacaoNativaAtiva,
  type ContextoIntegracaoExecution,
  type DecisaoIntegracaoNativa,
  type ResultadoFluxoFiscalNativo,
} from './types';

export function decidirIntegracaoNativa(ctx: ContextoIntegracaoExecution): DecisaoIntegracaoNativa {
  const leitura = lerFlagRecuperacaoNativa(ctx.env ?? process.env);
  const autorizada = autorizacaoNativaAtiva(ctx.autorizacaoNativa);

  if (!leitura.ativa) {
    return {
      modo: 'LEGADO',
      situacao: 'LEGADO_SOLICITADO',
      executarNativo: false,
      motivo:
        leitura.motivo === 'INVALIDA'
          ? 'Flag inválida; fluxo legado preservado.'
          : 'Flag desativada; fluxo legado preservado.',
      compatibilidadePdf: 'LEGADO_PRESERVADO',
    };
  }

  if (!autorizada) {
    return {
      modo: 'LEGADO',
      situacao: 'LEGADO_SOLICITADO',
      executarNativo: false,
      motivo: 'Flag ativa sem autorização explícita da execução; fluxo legado preservado.',
      compatibilidadePdf: 'LEGADO_PRESERVADO',
      codigoRecusa: 'AUTORIZACAO_AUSENTE',
    };
  }

  // A partir daqui o nativo foi solicitado explicitamente.
  if (ctx.baixarPdf) {
    return {
      modo: 'LEGADO',
      situacao: 'NATIVO_RECUSADO',
      executarNativo: false,
      motivo: 'baixarPdf ativo impede o fluxo nativo (DANFS-e legado).',
      compatibilidadePdf: 'BLOQUEIA_SUBSTITUICAO',
      codigoRecusa: 'PDF_EXIGE_LEGADO',
    };
  }

  if (!ctx.page) {
    return {
      modo: 'LEGADO',
      situacao: 'NATIVO_RECUSADO',
      executarNativo: false,
      motivo: 'Page autenticada ausente.',
      compatibilidadePdf: 'NAO_APLICAVEL',
      codigoRecusa: 'PAGE_AUSENTE',
    };
  }

  if (ctx.tipoAutenticacao !== 'certificado') {
    return {
      modo: 'LEGADO',
      situacao: 'NATIVO_RECUSADO',
      executarNativo: false,
      motivo: 'Recuperação SEFIN nativa exige autenticação A1 nesta etapa.',
      compatibilidadePdf: 'NAO_APLICAVEL',
      codigoRecusa: 'CONTEXTO_INVALIDO',
    };
  }

  if (!lerRaizFiscalNativa(ctx.env ?? process.env)) {
    return {
      modo: 'LEGADO',
      situacao: 'NATIVO_RECUSADO',
      executarNativo: false,
      motivo: 'NFSE_FISCAL_STORAGE_PATH ausente.',
      compatibilidadePdf: 'NAO_APLICAVEL',
      codigoRecusa: 'RAIZ_FISCAL_AUSENTE',
    };
  }

  return {
    modo: 'NATIVO_CONTROLADO',
    situacao: 'NATIVO_SOLICITADO',
    executarNativo: true,
    motivo: 'Flag ativa, autorização explícita e pré-condições atendidas.',
    compatibilidadePdf: 'NAO_APLICAVEL',
  };
}

/**
 * Avalia flag + autorização. NATIVO_RECUSADO sobe erro tipado (sem fallback legado).
 * Sem autorização ou flag off: retorna null e deixa o legado.
 */
export async function tentarFluxoNativoControlado(
  ctx: ContextoIntegracaoExecution
): Promise<{ decisao: DecisaoIntegracaoNativa; resultado: ResultadoFluxoFiscalNativo | null }> {
  const decisao = decidirIntegracaoNativa(ctx);

  if (decisao.situacao === 'NATIVO_RECUSADO') {
    throw new OrquestracaoNfseError(
      decisao.codigoRecusa ?? 'CONTEXTO_INVALIDO',
      decisao.motivo
    );
  }

  if (!decisao.executarNativo || decisao.situacao !== 'NATIVO_SOLICITADO') {
    return { decisao, resultado: null };
  }

  if (!flagRecuperacaoNativaAtiva(ctx.env ?? process.env) || !autorizacaoNativaAtiva(ctx.autorizacaoNativa)) {
    return {
      decisao: {
        ...decisao,
        executarNativo: false,
        modo: 'LEGADO',
        situacao: 'LEGADO_SOLICITADO',
        motivo: 'Flag ou autorização desativada após a decisão.',
      },
      resultado: null,
    };
  }

  const raiz = lerRaizFiscalNativa(ctx.env ?? process.env);
  if (!raiz || !ctx.page) {
    throw new OrquestracaoNfseError('CONTEXTO_INVALIDO', 'Contexto nativo incompleto após a decisão.');
  }

  let periodo;
  try {
    periodo = criarPeriodoConsultaPortal(ctx.dataInicio, ctx.dataFim);
  } catch {
    throw new OrquestracaoNfseError('PERIODO_INVALIDO', 'Período de consulta inválido para o fluxo nativo.');
  }

  const tipo =
    ctx.tipo === 'emitidas' || ctx.tipo === 'recebidas' || ctx.tipo === 'ambas'
      ? ctx.tipo
      : 'ambas';

  const repositorio = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raiz));
  const fonteA1 = ctx.certificadoEmMemoria
    ? {
        async carregar() {
          return {
            pfx: ctx.certificadoEmMemoria!.pfx,
            passphrase: ctx.certificadoEmMemoria!.passphrase,
          };
        },
      }
    : criarFonteA1DoCadastro();

  const resultado = await executarFluxoFiscalNativo({
    page: ctx.page as Page,
    cnpj: ctx.cnpj,
    periodoConsulta: periodo,
    execucaoId: ctx.execucaoId,
    tipo,
    baixarPdf: ctx.baixarPdf,
    raizFiscal: raiz,
    dependencias: {
      descobrir: discoverNfse,
      recuperar: recuperarXmlNfse,
      transporte: criarTransporteHttpsMtls(),
      provedorA1: new AdaptadorCertificadoA1(fonteA1),
      repositorio,
    },
  });

  return { decisao, resultado };
}

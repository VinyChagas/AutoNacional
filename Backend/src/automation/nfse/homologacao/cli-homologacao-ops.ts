/**
 * Operações administrativas locais da CLI de homologação.
 * Reutiliza canal + autorização H1. Sem HTTP, sem Discovery, sem SEFIN.
 */
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  criarAutorizacaoHomologacao,
  criarLimitesHomologacao,
} from './autorizacao';
import {
  criarAutorizacaoId,
  criarCanalAutorizacaoArquivo,
} from './canal-autorizacao';
import type { TicketAutorizacaoOperacional } from './canal-autorizacao-types';
import { mascararCnpjCli, registrarAuditoriaCli } from './cli-auditoria';
import { prepararStoreHomologacaoSeguro } from './store-homologacao-seguro';
import { HomologacaoNfseError } from './types';

export interface EntradaEmitirCli {
  readonly store: string;
  readonly execucaoId: string;
  readonly cnpj: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly diretorioFiscal: string;
  readonly validoAte: string;
  readonly motivo: string;
  readonly maxDocumentos?: number;
  readonly maxPaginas?: number;
  readonly timeoutMs?: number;
  readonly agora?: Date;
}

export async function cliConsultar(store: string, execucaoId: string): Promise<{
  ticket: TicketAutorizacaoOperacional | null;
}> {
  const raiz = await prepararStoreHomologacaoSeguro(store);
  const canal = criarCanalAutorizacaoArquivo(raiz);
  const ticket = await canal.consultar(execucaoId);
  await registrarAuditoriaCli(raiz, {
    evento: 'cli_consulta',
    execucaoId,
    autorizacaoId: ticket?.autorizacaoId,
    estadoTicket: ticket?.estado,
    cnpjMascarado: ticket ? mascararCnpjCli(ticket.autorizacao.cnpj) : undefined,
  });
  return { ticket };
}

export async function cliEmitir(entrada: EntradaEmitirCli): Promise<TicketAutorizacaoOperacional> {
  const raiz = await prepararStoreHomologacaoSeguro(entrada.store);
  const canal = criarCanalAutorizacaoArquivo(raiz);
  const agora = entrada.agora ?? new Date();

  try {
    if (!entrada.motivo?.trim()) {
      throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'Motivo de emissão obrigatório.');
    }
    const periodo = criarPeriodoConsultaPortal(entrada.periodoInicio, entrada.periodoFim);
    const auth = criarAutorizacaoHomologacao({
      cnpj: entrada.cnpj,
      periodoConsulta: periodo,
      execucaoId: entrada.execucaoId,
      operacao: 'DISCOVERY_ONLY',
      validoAte: entrada.validoAte,
      diretorioFiscal: entrada.diretorioFiscal,
      limites: criarLimitesHomologacao({
        maxDocumentos: entrada.maxDocumentos ?? 50,
        maxPaginas: entrada.maxPaginas ?? 20,
        maxRequisicoesSefin: 0,
        timeoutMs: entrada.timeoutMs ?? 60_000,
      }),
      motivo: entrada.motivo.trim(),
      agora,
    });

    const ticket = await canal.emitir({
      versao: 1,
      autorizacaoId: criarAutorizacaoId(),
      autorizacao: auth,
      emitidoEm: agora.toISOString(),
      ativacaoDiscoveryReal: false,
    });

    await auditarAposOperacao(raiz, {
      evento: 'cli_emissao',
      autorizacaoId: ticket.autorizacaoId,
      execucaoId: ticket.autorizacao.execucaoId,
      cnpjMascarado: mascararCnpjCli(ticket.autorizacao.cnpj),
      periodo: {
        inicio: ticket.autorizacao.periodoConsulta.inicio,
        fim: ticket.autorizacao.periodoConsulta.fim,
      },
      estadoTicket: ticket.estado,
      motivo: entrada.motivo.trim(),
      agora,
    });

    return ticket;
  } catch (erro) {
    if (erro instanceof HomologacaoNfseError && erro.codigo === 'FALHA_EVIDENCIA') {
      throw erro;
    }
    await registrarAuditoriaCli(raiz, {
      evento: 'cli_recusada',
      execucaoId: entrada.execucaoId,
      cnpjMascarado: safeMask(entrada.cnpj),
      codigoErro: erro instanceof HomologacaoNfseError ? erro.codigo : 'CONTEXTO_INVALIDO',
      detalhe: erro instanceof Error ? erro.message : 'emissao_recusada',
      agora,
    }).catch(() => undefined);
    throw erro;
  }
}

export async function cliAtivar(entrada: {
  store: string;
  autorizacaoId: string;
  motivo: string;
  agora?: Date;
}): Promise<TicketAutorizacaoOperacional> {
  const raiz = await prepararStoreHomologacaoSeguro(entrada.store);
  const canal = criarCanalAutorizacaoArquivo(raiz);
  const agora = entrada.agora ?? new Date();

  try {
    if (!entrada.motivo?.trim()) {
      throw new HomologacaoNfseError(
        'AUTORIZACAO_MALFORMADA',
        'Ativação exige motivo rastreável.'
      );
    }
    const ticket = await canal.ativarDiscoveryReal(
      entrada.autorizacaoId,
      entrada.motivo.trim(),
      agora
    );
    await auditarAposOperacao(raiz, {
      evento: 'cli_ativacao',
      autorizacaoId: ticket.autorizacaoId,
      execucaoId: ticket.autorizacao.execucaoId,
      cnpjMascarado: mascararCnpjCli(ticket.autorizacao.cnpj),
      estadoTicket: ticket.estado,
      motivo: entrada.motivo.trim(),
      agora,
    });
    return ticket;
  } catch (erro) {
    if (erro instanceof HomologacaoNfseError && erro.codigo === 'FALHA_EVIDENCIA') {
      throw erro;
    }
    await registrarAuditoriaCli(raiz, {
      evento: 'cli_recusada',
      autorizacaoId: entrada.autorizacaoId,
      codigoErro: erro instanceof HomologacaoNfseError ? erro.codigo : 'CONTEXTO_INVALIDO',
      detalhe: erro instanceof Error ? erro.message : 'ativacao_recusada',
      agora,
    }).catch(() => undefined);
    throw erro;
  }
}

export async function cliCancelar(entrada: {
  store: string;
  autorizacaoId: string;
  motivo: string;
  agora?: Date;
}): Promise<void> {
  const raiz = await prepararStoreHomologacaoSeguro(entrada.store);
  const canal = criarCanalAutorizacaoArquivo(raiz);
  const agora = entrada.agora ?? new Date();

  try {
    if (!entrada.motivo?.trim()) {
      throw new HomologacaoNfseError(
        'AUTORIZACAO_MALFORMADA',
        'Cancelamento exige motivo.'
      );
    }
    await canal.cancelar(entrada.autorizacaoId, entrada.motivo.trim());
    await auditarAposOperacao(raiz, {
      evento: 'cli_cancelamento',
      autorizacaoId: entrada.autorizacaoId,
      motivo: entrada.motivo.trim(),
      estadoTicket: 'CANCELADA',
      agora,
    });
  } catch (erro) {
    if (erro instanceof HomologacaoNfseError && erro.codigo === 'FALHA_EVIDENCIA') {
      throw erro;
    }
    await registrarAuditoriaCli(raiz, {
      evento: 'cli_recusada',
      autorizacaoId: entrada.autorizacaoId,
      codigoErro: erro instanceof HomologacaoNfseError ? erro.codigo : 'CONTEXTO_INVALIDO',
      detalhe: erro instanceof Error ? erro.message : 'cancelamento_recusado',
      agora,
    }).catch(() => undefined);
    throw erro;
  }
}

/**
 * Operação já persistida: falha de auditoria NÃO reverte o ticket,
 * mas falha explicitamente com FALHA_EVIDENCIA (sem habilitação parcial silenciosa).
 */
async function auditarAposOperacao(
  store: string,
  registro: Parameters<typeof registrarAuditoriaCli>[1]
): Promise<void> {
  try {
    await registrarAuditoriaCli(store, registro);
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message.slice(0, 160) : 'auditoria_falhou';
    throw new HomologacaoNfseError(
      'FALHA_EVIDENCIA',
      `Operação aplicada no store, mas auditoria falhou: ${detalhe}`
    );
  }
}

function safeMask(cnpj: string): string | undefined {
  try {
    return mascararCnpjCli(cnpj);
  } catch {
    return undefined;
  }
}

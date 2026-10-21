/**
 * Canal de autorização operacional H2.2.1.
 *
 * - Memória: testes / processo único (mutex cooperativa).
 * - Arquivo: consumo único cross-process via create(wx) + rename atômico.
 *
 * Dependência de armazenamento compartilhado (arquivo): diretório absoluto
 * injetado explicitamente — nunca via env de ativação automática.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validarAutorizacaoHomologacao } from './autorizacao';
import { validarDiretorioFiscalSeguro } from './diretorio-seguro';
import {
  HomologacaoNfseError,
  type AutorizacaoHomologacaoNfse,
} from './types';
import type {
  CanalAutorizacaoHomologacao,
  ContextoConsumoAutorizacao,
  MotivoConsumoAutorizacao,
  ResultadoConsumoAutorizacao,
  TicketEmissaoEntrada,
  TicketAutorizacaoOperacional,
} from './canal-autorizacao-types';

let canalAtivo: CanalAutorizacaoHomologacao | null = null;

/** Injeta canal privilegiado (testes / ferramenta interna). Null = legado puro. */
export function configurarCanalHomologacaoOperacional(
  canal: CanalAutorizacaoHomologacao | null
): void {
  canalAtivo = canal;
}

export function obterCanalHomologacaoOperacional(): CanalAutorizacaoHomologacao | null {
  return canalAtivo;
}

export function criarAutorizacaoId(): string {
  return `auth-${randomUUID()}`;
}

function validarTicketEmissao(parcial: TicketEmissaoEntrada): TicketAutorizacaoOperacional {
  if (!parcial.autorizacaoId?.trim()) {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'autorizacaoId ausente.');
  }
  const auth = parcial.autorizacao;
  if (!auth || auth.autorizada !== true || auth.versao !== 1) {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'Autorização H1 inválida no ticket.');
  }
  if (auth.operacao !== 'DISCOVERY_ONLY') {
    throw new HomologacaoNfseError(
      'OPERACAO_NAO_AUTORIZADA',
      'Canal H2.2.1 aceita somente DISCOVERY_ONLY (SEFIN recusado).'
    );
  }
  if (auth.limites.maxRequisicoesSefin !== 0) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_MALFORMADA',
      'DISCOVERY_ONLY exige maxRequisicoesSefin = 0.'
    );
  }
  // Recusa payload genérico Commit 07 disfarçado.
  const generico = auth as AutorizacaoHomologacaoNfse & { autorizacaoId?: string };
  if (!auth.cnpj || !auth.execucaoId || !auth.periodoConsulta || !auth.diretorioFiscal) {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'Campos vinculados ausentes.');
  }
  void generico;

  const ativacaoDiscoveryReal = parcial.ativacaoDiscoveryReal === true;
  if (ativacaoDiscoveryReal && !parcial.ativacaoMotivo?.trim()) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_MALFORMADA',
      'Ativação Discovery-Only real na emissão exige ativacaoMotivo rastreável.'
    );
  }

  const emitidoEm = parcial.emitidoEm || new Date().toISOString();
  return {
    versao: 1,
    autorizacaoId: parcial.autorizacaoId.trim(),
    autorizacao: auth,
    estado: 'DISPONIVEL',
    emitidoEm,
    ativacaoDiscoveryReal,
    ...(ativacaoDiscoveryReal
      ? {
          ativacaoMotivo: parcial.ativacaoMotivo!.trim().slice(0, 200),
          ativacaoEm: emitidoEm,
        }
      : {}),
  };
}

function validarContextoConsumo(
  ticket: TicketAutorizacaoOperacional,
  contexto: ContextoConsumoAutorizacao
): void {
  if (ticket.estado !== 'DISPONIVEL') {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_JA_CONSUMIDA',
      `Ticket em estado ${ticket.estado}; reutilização recusada.`
    );
  }
  validarAutorizacaoHomologacao(ticket.autorizacao, {
    cnpj: contexto.cnpj,
    periodoConsulta: contexto.periodoConsulta,
    execucaoId: contexto.execucaoId,
    operacaoSolicitada: 'DISCOVERY_ONLY',
    diretorioFiscal: contexto.diretorioFiscal,
    agora: contexto.agora,
  });
}

/** Canal em memória — processo único. Mutex serializa consumos concorrentes. */
export function criarCanalAutorizacaoMemoria(): CanalAutorizacaoHomologacao {
  const porExecucao = new Map<string, TicketAutorizacaoOperacional>();
  const porId = new Map<string, TicketAutorizacaoOperacional>();
  let cadeia: Promise<unknown> = Promise.resolve();

  const comMutex = async <T>(fn: () => Promise<T>): Promise<T> => {
    const executar = cadeia.then(fn, fn);
    cadeia = executar.then(
      () => undefined,
      () => undefined
    );
    return executar;
  };

  return {
    async emitir(parcial) {
      const ticket = validarTicketEmissao(parcial);
      if (porId.has(ticket.autorizacaoId) || porExecucao.has(ticket.autorizacao.execucaoId)) {
        throw new HomologacaoNfseError(
          'AUTORIZACAO_MALFORMADA',
          'Já existe ticket para este autorizacaoId ou execucaoId.'
        );
      }
      porId.set(ticket.autorizacaoId, ticket);
      porExecucao.set(ticket.autorizacao.execucaoId, ticket);
      return ticket;
    },

    async consultar(execucaoId) {
      return porExecucao.get(execucaoId) ?? null;
    },

    async validarSemConsumir(execucaoId, contexto) {
      const ticket = porExecucao.get(execucaoId);
      if (!ticket) {
        throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Ticket ausente para a execução.');
      }
      // Somente leitura: não altera estado (mesmo em falha de vínculo).
      validarContextoConsumo(ticket, contexto);
      return ticket;
    },

    async ativarDiscoveryReal(autorizacaoId, motivo, agora) {
      return comMutex(async () => {
        const ticket = porId.get(autorizacaoId);
        if (!ticket) {
          throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Ticket ausente para ativação.');
        }
        if (ticket.estado !== 'DISPONIVEL') {
          throw new HomologacaoNfseError(
            'AUTORIZACAO_JA_CONSUMIDA',
            `Ticket em estado ${ticket.estado}; ativação recusada.`
          );
        }
        if (!motivo?.trim()) {
          throw new HomologacaoNfseError(
            'AUTORIZACAO_MALFORMADA',
            'Motivo de ativação individual obrigatório.'
          );
        }
        if (ticket.ativacaoDiscoveryReal) {
          return ticket;
        }
        const ativado: TicketAutorizacaoOperacional = {
          ...ticket,
          ativacaoDiscoveryReal: true,
          ativacaoMotivo: motivo.trim().slice(0, 200),
          ativacaoEm: (agora ?? new Date()).toISOString(),
        };
        porId.set(autorizacaoId, ativado);
        porExecucao.set(ticket.autorizacao.execucaoId, ativado);
        return ativado;
      });
    },

    async consumir(execucaoId, contexto, motivo) {
      return comMutex(async () => {
        const ticket = porExecucao.get(execucaoId);
        if (!ticket) {
          throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Ticket ausente para a execução.');
        }
        try {
          validarContextoConsumo(ticket, contexto);
        } catch (erro) {
          if (erro instanceof HomologacaoNfseError && erro.codigo === 'AUTORIZACAO_JA_CONSUMIDA') {
            throw erro;
          }
          // Falha de vínculo no consumo real: marca FALHA e impede reuso.
          const falho: TicketAutorizacaoOperacional = {
            ...ticket,
            estado: 'FALHA',
            consumidoEm: (contexto.agora ?? new Date()).toISOString(),
            motivoConsumo: `falha_validacao:${erro instanceof HomologacaoNfseError ? erro.codigo : 'ERRO'}`,
          };
          porId.set(falho.autorizacaoId, falho);
          porExecucao.set(execucaoId, falho);
          throw erro;
        }

        const consumido: TicketAutorizacaoOperacional = {
          ...ticket,
          estado: 'CONSUMIDA',
          consumidoEm: (contexto.agora ?? new Date()).toISOString(),
          motivoConsumo: motivo,
        };
        porId.set(consumido.autorizacaoId, consumido);
        porExecucao.set(execucaoId, consumido);
        return { ticket: consumido, consumidoAgora: true };
      });
    },

    async cancelar(autorizacaoId, motivo) {
      return comMutex(async () => {
        const ticket = porId.get(autorizacaoId);
        if (!ticket) {
          throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Ticket ausente para cancelamento.');
        }
        if (ticket.estado !== 'DISPONIVEL') {
          throw new HomologacaoNfseError(
            'AUTORIZACAO_JA_CONSUMIDA',
            'Ticket não está disponível para cancelamento.'
          );
        }
        const cancelado: TicketAutorizacaoOperacional = {
          ...ticket,
          estado: 'CANCELADA',
          consumidoEm: new Date().toISOString(),
          motivoConsumo: motivo,
        };
        porId.set(autorizacaoId, cancelado);
        porExecucao.set(ticket.autorizacao.execucaoId, cancelado);
      });
    },
  };
}

/**
 * Canal em arquivo — seguro entre processos que compartilham o mesmo diretório.
 * Consumo: cria `{id}.lease` com flag wx; só um vencedor.
 */
export function criarCanalAutorizacaoArquivo(storeRoot: string): CanalAutorizacaoHomologacao {
  let raizPronta: string | null = null;

  const raiz = async (): Promise<string> => {
    if (raizPronta) return raizPronta;
    raizPronta = await validarDiretorioFiscalSeguro({
      diretorioFiscal: storeRoot,
      criarSeAusente: true,
    });
    return raizPronta;
  };

  const caminhoTicket = (id: string, base: string) => path.join(base, `${sanitize(id)}.json`);
  const caminhoLease = (id: string, base: string) => path.join(base, `${sanitize(id)}.lease`);
  const caminhoIndice = (execucaoId: string, base: string) =>
    path.join(base, `exec-${sanitize(execucaoId)}.idx`);

  const lerTicket = async (arquivo: string): Promise<TicketAutorizacaoOperacional> => {
    const raw = await fs.readFile(arquivo, 'utf8');
    return JSON.parse(raw) as TicketAutorizacaoOperacional;
  };

  const escreverTicket = async (arquivo: string, ticket: TicketAutorizacaoOperacional) => {
    const tmp = `${arquivo}.tmp-${process.pid}`;
    await fs.writeFile(tmp, `${JSON.stringify(ticket, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(tmp, arquivo);
  };

  return {
    async emitir(parcial) {
      const ticket = validarTicketEmissao(parcial);
      const base = await raiz();
      const arquivo = caminhoTicket(ticket.autorizacaoId, base);
      const indice = caminhoIndice(ticket.autorizacao.execucaoId, base);
      try {
        await fs.writeFile(indice, ticket.autorizacaoId, { encoding: 'utf8', flag: 'wx' });
      } catch {
        throw new HomologacaoNfseError(
          'AUTORIZACAO_MALFORMADA',
          'Já existe ticket para este execucaoId no store.'
        );
      }
      try {
        await escreverTicket(arquivo, ticket);
      } catch (erro) {
        await fs.unlink(indice).catch(() => undefined);
        throw new HomologacaoNfseError(
          'AUTORIZACAO_MALFORMADA',
          `Falha ao emitir ticket: ${erro instanceof Error ? erro.message : 'erro'}`
        );
      }
      return ticket;
    },

    async consultar(execucaoId) {
      const base = await raiz();
      const indice = caminhoIndice(execucaoId, base);
      try {
        const id = (await fs.readFile(indice, 'utf8')).trim();
        return await lerTicket(caminhoTicket(id, base));
      } catch {
        return null;
      }
    },

    async validarSemConsumir(execucaoId, contexto) {
      const base = await raiz();
      const indice = caminhoIndice(execucaoId, base);
      let autorizacaoId: string;
      try {
        autorizacaoId = (await fs.readFile(indice, 'utf8')).trim();
      } catch {
        throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Ticket ausente para a execução.');
      }
      const ticket = await lerTicket(caminhoTicket(autorizacaoId, base));
      validarContextoConsumo(ticket, contexto);
      return ticket;
    },

    async ativarDiscoveryReal(autorizacaoId, motivo, agora) {
      const base = await raiz();
      const arquivo = caminhoTicket(autorizacaoId, base);
      let ticket: TicketAutorizacaoOperacional;
      try {
        ticket = await lerTicket(arquivo);
      } catch {
        throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Ticket ausente para ativação.');
      }
      if (ticket.estado !== 'DISPONIVEL') {
        throw new HomologacaoNfseError(
          'AUTORIZACAO_JA_CONSUMIDA',
          `Ticket em estado ${ticket.estado}; ativação recusada.`
        );
      }
      if (!motivo?.trim()) {
        throw new HomologacaoNfseError(
          'AUTORIZACAO_MALFORMADA',
          'Motivo de ativação individual obrigatório.'
        );
      }
      if (ticket.ativacaoDiscoveryReal) {
        return ticket;
      }
      const ativado: TicketAutorizacaoOperacional = {
        ...ticket,
        ativacaoDiscoveryReal: true,
        ativacaoMotivo: motivo.trim().slice(0, 200),
        ativacaoEm: (agora ?? new Date()).toISOString(),
      };
      await fs.writeFile(arquivo, `${JSON.stringify(ativado, null, 2)}\n`, 'utf8');
      return ativado;
    },

    async consumir(execucaoId, contexto, motivo) {
      const base = await raiz();
      const indice = caminhoIndice(execucaoId, base);
      let autorizacaoId: string;
      try {
        autorizacaoId = (await fs.readFile(indice, 'utf8')).trim();
      } catch {
        throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Ticket ausente para a execução.');
      }

      const arquivo = caminhoTicket(autorizacaoId, base);
      const lease = caminhoLease(autorizacaoId, base);
      let ticket = await lerTicket(arquivo);

      if (ticket.estado !== 'DISPONIVEL') {
        throw new HomologacaoNfseError(
          'AUTORIZACAO_JA_CONSUMIDA',
          `Ticket em estado ${ticket.estado}; reutilização recusada.`
        );
      }

      try {
        await fs.writeFile(
          lease,
          JSON.stringify({
            execucaoId,
            pid: process.pid,
            em: (contexto.agora ?? new Date()).toISOString(),
            motivo,
          }),
          { encoding: 'utf8', flag: 'wx' }
        );
      } catch {
        throw new HomologacaoNfseError(
          'AUTORIZACAO_CONCORRENCIA',
          'Outro processo já consumiu ou está consumindo este ticket.'
        );
      }

      try {
        validarContextoConsumo(ticket, contexto);
      } catch (erro) {
        const falho: TicketAutorizacaoOperacional = {
          ...ticket,
          estado: 'FALHA',
          consumidoEm: (contexto.agora ?? new Date()).toISOString(),
          motivoConsumo: `falha_validacao:${erro instanceof HomologacaoNfseError ? erro.codigo : 'ERRO'}`,
        };
        await fs.writeFile(arquivo, `${JSON.stringify(falho, null, 2)}\n`, 'utf8');
        throw erro;
      }

      const consumido: TicketAutorizacaoOperacional = {
        ...ticket,
        estado: 'CONSUMIDA',
        consumidoEm: (contexto.agora ?? new Date()).toISOString(),
        motivoConsumo: motivo,
      };
      await fs.writeFile(arquivo, `${JSON.stringify(consumido, null, 2)}\n`, 'utf8');
      return { ticket: consumido, consumidoAgora: true };
    },

    async cancelar(autorizacaoId, motivo) {
      const base = await raiz();
      const arquivo = caminhoTicket(autorizacaoId, base);
      const lease = caminhoLease(autorizacaoId, base);
      const ticket = await lerTicket(arquivo);
      if (ticket.estado !== 'DISPONIVEL') {
        throw new HomologacaoNfseError(
          'AUTORIZACAO_JA_CONSUMIDA',
          'Ticket não está disponível para cancelamento.'
        );
      }
      try {
        await fs.writeFile(lease, JSON.stringify({ cancel: true, motivo }), {
          encoding: 'utf8',
          flag: 'wx',
        });
      } catch {
        throw new HomologacaoNfseError(
          'AUTORIZACAO_CONCORRENCIA',
          'Cancelamento concorrente recusado.'
        );
      }
      const cancelado: TicketAutorizacaoOperacional = {
        ...ticket,
        estado: 'CANCELADA',
        consumidoEm: new Date().toISOString(),
        motivoConsumo: motivo,
      };
      await fs.writeFile(arquivo, `${JSON.stringify(cancelado, null, 2)}\n`, 'utf8');
    },
  };
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'id';
}

export type { CanalAutorizacaoHomologacao, TicketAutorizacaoOperacional };

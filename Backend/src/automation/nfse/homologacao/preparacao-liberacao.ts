/**
 * H2.2.4-B2 / B2-R1 — Preparar (sem enqueue) e liberar (PQueue) Discovery-Only.
 *
 * Payload de job fica em memória do processo Backend (proprietário).
 * Após reinício sem payload → recusa conservadora (reconciliação manual).
 * Ticket NÃO é consumido aqui (consumo na ponte).
 *
 * NÃO há atomicidade Prisma ↔ PQueue. Falha parcial → homologacao_bloqueada
 * quando possível; nunca reenfileira automaticamente estado incerto.
 */
import type { CaptchaMode } from '../../captcha/types';
import { ContratoNfseError } from '../contracts/erros';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { CanalAutorizacaoHomologacao } from './canal-autorizacao-types';
import { HomologacaoNfseError } from './types';

export const STATUS_HOMOLOGACAO_PREPARADA = 'homologacao_preparada';
export const STATUS_HOMOLOGACAO_LIBERADA = 'homologacao_liberada';
/** Falha parcial / estado incerto — não liberável; exige reconciliação manual. */
export const STATUS_HOMOLOGACAO_BLOQUEADA = 'homologacao_bloqueada';

export type TipoAutenticacaoHomologacao = 'certificado' | 'credenciais';

export interface PayloadExecucaoHomologacao {
  readonly execucaoId: string;
  readonly empresaId: number;
  readonly cnpj: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly tipo: string;
  readonly headless: boolean;
  readonly baixarPdf: boolean;
  readonly captchaMode: CaptchaMode;
  readonly tipoAutenticacao: TipoAutenticacaoHomologacao;
  readonly preparadoEm: string;
  /** PID do processo que preparou — diagnóstico multi-instância. */
  readonly processoPid: number;
  liberadoEm?: string;
}

export interface EntradaPrepararHomologacao {
  readonly empresaId: number;
  readonly cnpj: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  /** Deve ser DISCOVERY_ONLY. */
  readonly tipo?: string;
  readonly tipoAutenticacao?: TipoAutenticacaoHomologacao;
  readonly headless?: boolean;
  readonly baixarPdf?: boolean;
  readonly captchaMode?: CaptchaMode;
  readonly agora?: Date;
}

export interface ResultadoPrepararHomologacao {
  readonly execucaoId: string;
  readonly status: typeof STATUS_HOMOLOGACAO_PREPARADA;
  readonly cnpjMascarado: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly operacao: 'DISCOVERY_ONLY';
  readonly enfileirado: false;
  readonly navegadorIniciado: false;
  readonly loginIniciado: false;
  readonly descobertaIniciada: false;
}

export interface ResultadoLiberarHomologacao {
  readonly execucaoId: string;
  readonly status: typeof STATUS_HOMOLOGACAO_LIBERADA;
  readonly enfileirado: true;
  readonly autorizacaoId: string;
  readonly ticketConsumido: false;
}

export interface DependenciasPreparacaoLiberacao {
  criarExecucao(data: {
    empresaId: number;
    cnpj: string;
    periodoInicio: string;
    periodoFim: string;
    tipo: string;
    status: string;
    mensagem: string;
  }): Promise<{ id: number }>;
  obterExecucao(id: number): Promise<{
    id: number;
    status: string;
    cnpj: string | null;
    periodoInicio: string | null;
    periodoFim: string | null;
    empresaId: number;
  } | null>;
  atualizarSeStatus(
    id: number,
    statusAtual: string,
    data: { status: string; mensagem: string; etapaAtual?: string }
  ): Promise<number>;
  enfileirar(payload: PayloadExecucaoHomologacao): Promise<void>;
  obterCanal(): CanalAutorizacaoHomologacao | null;
  headlessPadrao?: boolean;
  /**
   * Gancho de teste: executado após Prisma.create e antes de Map.set.
   * Em produção não é usado. Não reconstruir payload a partir deste gancho.
   */
  ganchoAposCriarAntesDoPayload?: (execucaoId: string) => Promise<void>;
  /**
   * Gancho de teste: após Map.set e antes do retorno.
   */
  ganchoAposPayloadAntesDoRetorno?: (execucaoId: string) => Promise<void>;
  /**
   * Gancho de teste: após updateMany liberada e antes de fila.add.
   */
  ganchoAposReservaAntesDoEnqueue?: (execucaoId: string) => Promise<void>;
}

/** Registry in-memory — perdido no reinício (proposital); só neste processo. */
const payloads = new Map<string, PayloadExecucaoHomologacao>();
const mutexLiberacao = new Map<string, Promise<unknown>>();

export function limparRegistryPreparacaoSomenteTeste(): void {
  payloads.clear();
  mutexLiberacao.clear();
}

export function obterPayloadPreparacao(execucaoId: string): PayloadExecucaoHomologacao | undefined {
  return payloads.get(execucaoId);
}

/** Simula reinício: apaga só o Map (DB/mock permanece). */
export function simularReinicioProcessoSomenteTeste(): void {
  payloads.clear();
  mutexLiberacao.clear();
}

/**
 * Ordem da preparação:
 * 1. Validar parâmetros (CNPJ, período, DISCOVERY_ONLY)
 * 2. Prisma.create → homologacao_preparada (+ execucaoId)
 * 3. Map.set(payload) vinculado ao execucaoId
 * 4. Retornar identificador
 * Nunca chama fila.add / navegador / login / descoberta.
 *
 * Se falhar entre 2 e 3: tenta marcar homologacao_bloqueada (não reconstrói payload).
 * Crash do processo entre 2 e 3 deixa preparada órfã → liberar recusa (payload ausente).
 */
export async function prepararExecucaoHomologacao(
  entrada: EntradaPrepararHomologacao,
  deps: DependenciasPreparacaoLiberacao
): Promise<ResultadoPrepararHomologacao> {
  const tipo = (entrada.tipo ?? 'DISCOVERY_ONLY').trim();
  if (tipo !== 'DISCOVERY_ONLY') {
    throw new HomologacaoNfseError(
      'OPERACAO_NAO_AUTORIZADA',
      'Preparação adm exige tipo DISCOVERY_ONLY.'
    );
  }
  const cnpj = normalizarCnpj(entrada.cnpj);
  if (!Number.isInteger(entrada.empresaId) || entrada.empresaId < 1) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'empresaId inválido.');
  }
  try {
    criarPeriodoConsultaPortal(entrada.periodoInicio, entrada.periodoFim);
  } catch (erro) {
    const msg =
      erro instanceof ContratoNfseError || erro instanceof Error
        ? erro.message
        : 'Período inválido.';
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', msg);
  }

  const tipoAuth: TipoAutenticacaoHomologacao =
    entrada.tipoAutenticacao === 'credenciais' ? 'credenciais' : 'certificado';
  const agora = entrada.agora ?? new Date();
  const headless = entrada.headless ?? deps.headlessPadrao ?? true;

  const exec = await deps.criarExecucao({
    empresaId: entrada.empresaId,
    cnpj,
    periodoInicio: entrada.periodoInicio,
    periodoFim: entrada.periodoFim,
    tipo: 'ambas',
    status: STATUS_HOMOLOGACAO_PREPARADA,
    mensagem: 'Homologação preparada — aguardando ticket e liberação admin',
  });

  const execucaoId = String(exec.id);
  const idNum = exec.id;

  try {
    if (deps.ganchoAposCriarAntesDoPayload) {
      await deps.ganchoAposCriarAntesDoPayload(execucaoId);
    }

    const payload: PayloadExecucaoHomologacao = {
      execucaoId,
      empresaId: entrada.empresaId,
      cnpj,
      periodoInicio: entrada.periodoInicio,
      periodoFim: entrada.periodoFim,
      tipo: 'ambas',
      headless,
      baixarPdf: entrada.baixarPdf ?? false,
      captchaMode: entrada.captchaMode ?? 'TWO_CAPTCHA',
      tipoAutenticacao: tipoAuth,
      preparadoEm: agora.toISOString(),
      processoPid: process.pid,
    };
    payloads.set(execucaoId, payload);

    if (deps.ganchoAposPayloadAntesDoRetorno) {
      await deps.ganchoAposPayloadAntesDoRetorno(execucaoId);
    }

    return {
      execucaoId,
      status: STATUS_HOMOLOGACAO_PREPARADA,
      cnpjMascarado: mascarar(cnpj),
      periodoInicio: entrada.periodoInicio,
      periodoFim: entrada.periodoFim,
      operacao: 'DISCOVERY_ONLY',
      enfileirado: false,
      navegadorIniciado: false,
      loginIniciado: false,
      descobertaIniciada: false,
    };
  } catch (erro) {
    // Não reconstruir payload desconhecido. Bloquear registro persistido.
    payloads.delete(execucaoId);
    await marcarBloqueadaSeguro(
      deps,
      idNum,
      STATUS_HOMOLOGACAO_PREPARADA,
      `Preparação incompleta após persistência: ${erro instanceof Error ? erro.message : 'erro'}. Reconciliação manual; payload não reconstruído.`
    );
    if (erro instanceof HomologacaoNfseError) throw erro;
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      `Preparação incompleta (execucaoId=${execucaoId}). Estado bloqueado. Reconciliação manual.`
    );
  }
}

/**
 * Ordem da liberação (por execucaoId, sob mutex de processo):
 * 1. Validar execucaoId / obter execução
 * 2. Verificar estado (só preparada; liberada/bloqueada/outros → recusa)
 * 3. Exigir payload in-memory deste processo (não reconstruir)
 * 4. Validar ticket (ativado, DISPONIVEL, escopo, limites, expiração) — sem consumir
 * 5. Conferir payload ↔ Prisma (CNPJ/período)
 * 6. Reserva: updateMany preparada → liberada (count deve ser 1)
 * 7. Atualizar Map (liberadoEm)
 * 8. PQueue.add (enfileirar)
 * 9. Retornar resposta admin
 *
 * Se falhar em 8: tenta preparada→bloqueada ou liberada→bloqueada; não reenqueue.
 * Não há atomicidade entre 6 e 8.
 */
export async function liberarExecucaoHomologacao(
  entrada: { execucaoId: string; agora?: Date },
  deps: DependenciasPreparacaoLiberacao
): Promise<ResultadoLiberarHomologacao> {
  const execucaoId = String(entrada.execucaoId ?? '').trim();
  if (!execucaoId || !/^\d+$/.test(execucaoId)) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'execucaoId inválido.');
  }

  const prev = mutexLiberacao.get(execucaoId) ?? Promise.resolve();
  let release!: () => void;
  const holding = new Promise<void>((r) => {
    release = r;
  });
  mutexLiberacao.set(
    execucaoId,
    prev.then(
      () => holding,
      () => holding
    )
  );
  await prev.catch(() => undefined);

  try {
    return await liberarInterno(execucaoId, entrada.agora ?? new Date(), deps);
  } finally {
    release();
  }
}

async function liberarInterno(
  execucaoId: string,
  agora: Date,
  deps: DependenciasPreparacaoLiberacao
): Promise<ResultadoLiberarHomologacao> {
  const idNum = Number(execucaoId);
  const exec = await deps.obterExecucao(idNum);
  if (!exec) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Execução inexistente.');
  }
  if (exec.status === STATUS_HOMOLOGACAO_LIBERADA) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_JA_CONSUMIDA',
      'Execução já liberada; liberação duplicada recusada. Não reenfileirar automaticamente.'
    );
  }
  if (exec.status === STATUS_HOMOLOGACAO_BLOQUEADA) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Execução bloqueada (falha parcial anterior). Reconciliação manual; não reenfileirar automaticamente.'
    );
  }
  if (exec.status !== STATUS_HOMOLOGACAO_PREPARADA) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      `Execução em estado ${exec.status}; liberação recusada.`
    );
  }

  const payload = payloads.get(execucaoId);
  if (!payload) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Estado incerto: payload in-memory ausente neste processo (reinício ou outra instância). Reconciliação manual necessária; não reenfileirar automaticamente.'
    );
  }

  // Isolamento: payload deve bater com o registro persistido.
  const cnpjExec = normalizarCnpj(exec.cnpj ?? '');
  if (
    payload.cnpj !== cnpjExec ||
    payload.periodoInicio !== (exec.periodoInicio ?? '') ||
    payload.periodoFim !== (exec.periodoFim ?? '') ||
    payload.empresaId !== exec.empresaId
  ) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Payload in-memory diverge do registro Prisma. Liberação recusada; reconciliação manual.'
    );
  }

  const canal = deps.obterCanal();
  if (!canal) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_AUSENTE',
      'Canal de homologação não configurado.'
    );
  }

  const ticket = await canal.consultar(execucaoId);
  if (!ticket) {
    throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Ticket ausente para a execução.');
  }
  if (ticket.estado === 'CANCELADA') {
    throw new HomologacaoNfseError('AUTORIZACAO_JA_CONSUMIDA', 'Ticket cancelado.');
  }
  if (ticket.estado === 'CONSUMIDA' || ticket.estado === 'FALHA' || ticket.estado === 'EXPIRADA') {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_JA_CONSUMIDA',
      `Ticket em estado ${ticket.estado}.`
    );
  }
  if (!ticket.ativacaoDiscoveryReal) {
    throw new HomologacaoNfseError(
      'ATIVACAO_INDIVIDUAL_AUSENTE',
      'Ticket sem ativação individual.'
    );
  }

  const periodo = criarPeriodoConsultaPortal(
    exec.periodoInicio ?? payload.periodoInicio,
    exec.periodoFim ?? payload.periodoFim
  );
  const cnpj = cnpjExec;

  // Valida sem consumir — consumo permanece na ponte.
  await canal.validarSemConsumir(execucaoId, {
    execucaoId,
    cnpj,
    periodoConsulta: periodo,
    diretorioFiscal: ticket.autorizacao.diretorioFiscal,
    agora,
  });

  if (ticket.autorizacao.operacao !== 'DISCOVERY_ONLY') {
    throw new HomologacaoNfseError(
      'OPERACAO_NAO_AUTORIZADA',
      'Liberação exige DISCOVERY_ONLY.'
    );
  }
  if (ticket.autorizacao.execucaoId !== execucaoId) {
    throw new HomologacaoNfseError('EXECUCAO_DIVERGENTE', 'Ticket com execucaoId divergente.');
  }

  // Reserva otimista — única transição preparada → liberada.
  const count = await deps.atualizarSeStatus(idNum, STATUS_HOMOLOGACAO_PREPARADA, {
    status: STATUS_HOMOLOGACAO_LIBERADA,
    mensagem: 'Homologação liberada para PQueue — ticket ainda não consumido',
    etapaAtual: 'aguardando_fila',
  });
  if (count !== 1) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_CONCORRENCIA',
      'Liberação concorrente ou estado alterado (updateMany=0); recusada. Não reenfileirar automaticamente.'
    );
  }

  const liberado: PayloadExecucaoHomologacao = {
    ...payload,
    liberadoEm: agora.toISOString(),
  };
  payloads.set(execucaoId, liberado);

  try {
    if (deps.ganchoAposReservaAntesDoEnqueue) {
      await deps.ganchoAposReservaAntesDoEnqueue(execucaoId);
    }
    await deps.enfileirar(liberado);
  } catch (erro) {
    payloads.delete(execucaoId);
    await marcarBloqueadaSeguro(
      deps,
      idNum,
      STATUS_HOMOLOGACAO_LIBERADA,
      `Falha após reserva de liberação (enqueue): ${erro instanceof Error ? erro.message : 'erro'}. Reconciliação manual; não reenfileirar automaticamente.`
    );
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      `Falha após marcar liberação (enqueue): ${erro instanceof Error ? erro.message : 'erro'}. Estado bloqueado. Reconciliação manual.`
    );
  }

  return {
    execucaoId,
    status: STATUS_HOMOLOGACAO_LIBERADA,
    enfileirado: true,
    autorizacaoId: ticket.autorizacaoId,
    ticketConsumido: false,
  };
}

async function marcarBloqueadaSeguro(
  deps: DependenciasPreparacaoLiberacao,
  id: number,
  statusAtual: string,
  mensagem: string
): Promise<void> {
  try {
    await deps.atualizarSeStatus(id, statusAtual, {
      status: STATUS_HOMOLOGACAO_BLOQUEADA,
      mensagem,
      etapaAtual: 'homologacao_bloqueada',
    });
  } catch {
    // Melhor esforço — operador ainda vê status anterior + erro na resposta.
  }
}

function normalizarCnpj(cnpj: string): string {
  const limpo = cnpj.replace(/\D/g, '');
  if (limpo.length !== 14) {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'CNPJ inválido.');
  }
  return limpo;
}

function mascarar(cnpj: string): string {
  return `${cnpj.slice(0, 4)}***${cnpj.slice(-2)}`;
}

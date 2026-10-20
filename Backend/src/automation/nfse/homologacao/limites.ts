/**
 * Controle de limites operacionais de homologação H1.
 * Aplicado antes de cada operação correspondente. Sem retries ilimitados.
 */
import {
  HomologacaoNfseError,
  type ContagemLimitesHomologacao,
  type EstadoLimitesHomologacao,
  type LimitesHomologacaoNfse,
} from './types';

export class ControladorLimitesHomologacao {
  private documentos = 0;
  private requisicoesSefin = 0;
  private interrompido = false;
  private motivoInterrupcao: string | null = null;

  constructor(private readonly limites: LimitesHomologacaoNfse) {}

  contagem(): ContagemLimitesHomologacao {
    return { documentos: this.documentos, requisicoesSefin: this.requisicoesSefin };
  }

  estado(): EstadoLimitesHomologacao {
    if (this.interrompido) return 'INTERRUPCAO';
    if (this.documentos > this.limites.maxDocumentos) return 'LIMITE_DOCUMENTOS';
    if (this.requisicoesSefin > this.limites.maxRequisicoesSefin) return 'LIMITE_REQUISICOES';
    return 'OK';
  }

  /** Antes de aceitar um inventário / lote de documentos. */
  exigirDocumentos(quantidade: number): void {
    this.garantirAtivo();
    if (!Number.isInteger(quantidade) || quantidade < 0) {
      throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Quantidade de documentos inválida.');
    }
    if (quantidade > this.limites.maxDocumentos) {
      this.interromper('Limite de documentos excedido.');
      throw new HomologacaoNfseError(
        'LIMITE_DOCUMENTOS',
        `Limite de documentos excedido (${quantidade} > ${this.limites.maxDocumentos}).`
      );
    }
    this.documentos = quantidade;
  }

  /** Antes de cada requisição SEFIN simulada ou real. */
  exigirProximaRequisicaoSefin(): void {
    this.garantirAtivo();
    const proxima = this.requisicoesSefin + 1;
    if (proxima > this.limites.maxRequisicoesSefin) {
      this.interromper('Limite de requisições SEFIN excedido.');
      throw new HomologacaoNfseError(
        'LIMITE_REQUISICOES',
        `Limite de requisições SEFIN excedido (${proxima} > ${this.limites.maxRequisicoesSefin}).`
      );
    }
    this.requisicoesSefin = proxima;
  }

  interromper(motivo: string): void {
    this.interrompido = true;
    this.motivoInterrupcao = motivo.trim() || 'Interrupção solicitada.';
  }

  foiInterrompido(): boolean {
    return this.interrompido;
  }

  motivo(): string | null {
    return this.motivoInterrupcao;
  }

  timeoutMs(): number {
    return this.limites.timeoutMs;
  }

  private garantirAtivo(): void {
    if (this.interrompido) {
      throw new HomologacaoNfseError(
        'INTERRUPCAO',
        this.motivoInterrupcao ?? 'Homologação interrompida.'
      );
    }
  }
}

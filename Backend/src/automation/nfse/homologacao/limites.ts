/**
 * Controle de limites operacionais de homologação H1/H2.1.
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
  private paginas = 0;
  private requisicoesSefin = 0;
  private interrompido = false;
  private motivoInterrupcao: string | null = null;
  private codigoInterrupcao: EstadoLimitesHomologacao = 'INTERRUPCAO';
  private readonly iniciadoEm: number;

  constructor(
    private readonly limites: LimitesHomologacaoNfse,
    agora?: Date
  ) {
    this.iniciadoEm = (agora ?? new Date()).getTime();
  }

  contagem(): ContagemLimitesHomologacao {
    return {
      documentos: this.documentos,
      paginas: this.paginas,
      requisicoesSefin: this.requisicoesSefin,
    };
  }

  estado(): EstadoLimitesHomologacao {
    if (this.interrompido) return this.codigoInterrupcao;
    if (this.documentos > this.limites.maxDocumentos) return 'LIMITE_DOCUMENTOS';
    if (this.paginas > this.limites.maxPaginas * 2) return 'LIMITE_PAGINAS';
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
      this.interromper('Limite de documentos excedido.', 'LIMITE_DOCUMENTOS');
      throw new HomologacaoNfseError(
        'LIMITE_DOCUMENTOS',
        `Limite de documentos excedido (${quantidade} > ${this.limites.maxDocumentos}).`
      );
    }
    this.documentos = quantidade;
  }

  /**
   * Registra páginas percorridas em uma direção.
   * Se a descoberta atingiu o teto sem completar, marca interrupção de páginas
   * para o adaptador declarar inventário INCOMPLETO (nunca cobertura 100%).
   */
  registrarPaginasDirecao(paginasPercorridas: number, descobertaIncompletaPorPaginas: boolean): void {
    this.garantirAtivo();
    if (!Number.isInteger(paginasPercorridas) || paginasPercorridas < 0) {
      throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Quantidade de páginas inválida.');
    }
    this.paginas += paginasPercorridas;
    if (descobertaIncompletaPorPaginas || paginasPercorridas > this.limites.maxPaginas) {
      this.interromper('Limite de páginas atingido.', 'LIMITE_PAGINAS');
      throw new HomologacaoNfseError(
        'LIMITE_PAGINAS',
        `Limite de páginas atingido (${paginasPercorridas} / max ${this.limites.maxPaginas} por direção).`
      );
    }
  }

  /** Antes de cada requisição SEFIN simulada ou real. */
  exigirProximaRequisicaoSefin(): void {
    this.garantirAtivo();
    const proxima = this.requisicoesSefin + 1;
    if (proxima > this.limites.maxRequisicoesSefin) {
      this.interromper('Limite de requisições SEFIN excedido.', 'LIMITE_REQUISICOES');
      throw new HomologacaoNfseError(
        'LIMITE_REQUISICOES',
        `Limite de requisições SEFIN excedido (${proxima} > ${this.limites.maxRequisicoesSefin}).`
      );
    }
    this.requisicoesSefin = proxima;
  }

  /** Antes de nova direção / navegação fiscal. */
  exigirDentroDoTimeout(agora?: Date): void {
    this.garantirAtivo();
    const agoraMs = (agora ?? new Date()).getTime();
    if (agoraMs - this.iniciadoEm > this.limites.timeoutMs) {
      this.interromper('Timeout operacional de homologação excedido.', 'TIMEOUT');
      throw new HomologacaoNfseError(
        'TIMEOUT',
        `Timeout operacional excedido (${this.limites.timeoutMs} ms).`
      );
    }
  }

  interromper(motivo: string, codigo: EstadoLimitesHomologacao = 'INTERRUPCAO'): void {
    this.interrompido = true;
    this.motivoInterrupcao = motivo.trim() || 'Interrupção solicitada.';
    this.codigoInterrupcao = codigo;
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

  maxPaginas(): number {
    return this.limites.maxPaginas;
  }

  maxDocumentos(): number {
    return this.limites.maxDocumentos;
  }

  private garantirAtivo(): void {
    if (this.interrompido) {
      const codigo =
        this.codigoInterrupcao === 'LIMITE_DOCUMENTOS'
          ? 'LIMITE_DOCUMENTOS'
          : this.codigoInterrupcao === 'LIMITE_PAGINAS'
            ? 'LIMITE_PAGINAS'
            : this.codigoInterrupcao === 'LIMITE_REQUISICOES'
              ? 'LIMITE_REQUISICOES'
              : this.codigoInterrupcao === 'TIMEOUT'
                ? 'TIMEOUT'
                : 'INTERRUPCAO';
      throw new HomologacaoNfseError(
        codigo,
        this.motivoInterrupcao ?? 'Homologação interrompida.'
      );
    }
  }
}

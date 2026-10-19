/**
 * Erro de validação dos contratos internos de NFS-e.
 * Não representa falha de portal, SEFIN, fila ou banco.
 */
export class ContratoNfseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContratoNfseError';
  }
}

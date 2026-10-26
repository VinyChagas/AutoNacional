/**
 * Erros tipados do módulo ADN/NSU.
 * Não acionam SEFIN, Playwright nem o worker operacional.
 */

export type ClasseErroAdn = 'TRANSITORIO' | 'PERMANENTE' | 'BLOQUEANTE';

export class ErroAdn extends Error {
  readonly codigo: string;
  readonly classe: ClasseErroAdn;

  constructor(codigo: string, classe: ClasseErroAdn, mensagem: string) {
    super(mensagem);
    this.name = 'ErroAdn';
    this.codigo = codigo;
    this.classe = classe;
  }
}

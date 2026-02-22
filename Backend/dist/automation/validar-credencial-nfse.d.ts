export type ResultadoValidacaoCredencial = {
    ok: boolean;
    status: 'OK' | 'INVALIDA' | 'ERRO_VALIDACAO';
    message: string;
};
export declare function validarCredencialNfse(documento: string, senha: string, opts?: {
    timeoutSeconds?: number;
    headless?: boolean;
}): Promise<ResultadoValidacaoCredencial>;
//# sourceMappingURL=validar-credencial-nfse.d.ts.map
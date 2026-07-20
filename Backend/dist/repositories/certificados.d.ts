import type { Certificado } from '@prisma/client';
export declare function listarCertificados(): Promise<Certificado[]>;
/**
 * Lista todos os certificados cujo CNPJ/CPF é equivalente ao documento informado.
 * Cobre formatação, CPF com/sem pad e múltiplos registros (sem unique no schema).
 */
export declare function listarPorCnpjNormalizado(cnpj: string): Promise<Certificado[]>;
export declare function obterPorCnpj(cnpj: string): Promise<Certificado | null>;
export declare function existeCertificadoAtivoParaCnpj(cnpj: string): Promise<boolean>;
export declare function obterPorId(id: number): Promise<Certificado | null>;
export declare function listarPorEmpresaId(empresaId: number | string): Promise<Certificado[]>;
export declare function criar(data: {
    cnpj: string;
    arquivo?: string;
    senhaCriptografada?: string;
    dataValidade?: string;
    empresaId?: string;
    contabilidadeId?: number;
}): Promise<Certificado>;
export declare function atualizar(id: number, data: Partial<Pick<Certificado, 'arquivo' | 'senhaCriptografada' | 'dataValidade' | 'contabilidadeId'>>): Promise<Certificado | null>;
export declare function deletar(id: number): Promise<boolean>;
export interface RemoverCertificadosResult {
    deletedCount: number;
    certificadoIds: number[];
    storage: {
        attempted: string[];
        removed: string[];
        failed: Array<{
            path: string;
            error: string;
        }>;
    };
}
/**
 * Remove TODOS os certificados equivalentes ao CNPJ/CPF + arquivos no Storage.
 * Empresa e credenciais não são tocadas.
 */
export declare function removerTodosPorCnpj(cnpj: string): Promise<RemoverCertificadosResult | null>;
/** @deprecated Use removerTodosPorCnpj — mantido para compatibilidade. */
export declare function deletarPorCnpj(cnpj: string): Promise<boolean>;
//# sourceMappingURL=certificados.d.ts.map
import type { Certificado } from '@prisma/client';
export declare function listarCertificados(): Promise<Certificado[]>;
export declare function obterPorCnpj(cnpj: string): Promise<Certificado | null>;
export declare function obterPorId(id: number): Promise<Certificado | null>;
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
export declare function deletarPorCnpj(cnpj: string): Promise<boolean>;
//# sourceMappingURL=certificados.d.ts.map
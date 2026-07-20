import type { Empresa } from '@prisma/client';
export declare function listarEmpresas(skip?: number, limit?: number): Promise<Empresa[]>;
export declare function listarEmpresasPorContabilidade(contabilidadeId: number, skip?: number, limit?: number): Promise<Empresa[]>;
export declare function obterEmpresaPorId(empresaId: number): Promise<Empresa | null>;
/** Empresa com relação contabilidade (para nome da pasta de downloads). */
export declare function obterEmpresaComContabilidade(empresaId: number): Promise<(Empresa & {
    contabilidade: {
        nomeContabilidade: string;
    } | null;
}) | null>;
export declare function obterEmpresaPorCnpj(cnpj: string): Promise<Empresa | null>;
export declare function criarEmpresa(data: {
    cnpj: string;
    razaoSocial: string;
    regime?: string;
    contabilidadeId?: number;
}): Promise<Empresa>;
export declare function atualizarEmpresa(empresaId: number, data: Partial<Pick<Empresa, 'razaoSocial' | 'regime' | 'contabilidadeId'>>): Promise<Empresa | null>;
/**
 * Exclui empresa + credenciais (cascade FK) + certificados (sem FK) + Storage.
 * Certificados são buscados por empresaId e por CNPJ equivalente (legado).
 */
export declare function deletarEmpresa(empresaId: number): Promise<boolean>;
export declare function verificarCnpjTemCertificado(cnpj: string): Promise<boolean>;
//# sourceMappingURL=empresas.d.ts.map
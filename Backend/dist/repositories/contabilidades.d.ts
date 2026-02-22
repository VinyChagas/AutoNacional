import type { Contabilidade } from '@prisma/client';
export declare function listarContabilidades(skip?: number, limit?: number): Promise<Contabilidade[]>;
export declare function obterPorId(id: number): Promise<Contabilidade | null>;
export declare function obterPorCnpj(cnpj: string): Promise<Contabilidade | null>;
export declare function criar(data: {
    nomeContabilidade: string;
    cnpj: string;
    email?: string;
    telefone?: string;
    responsavel?: string;
}): Promise<Contabilidade>;
export declare function atualizar(id: number, data: Partial<{
    nomeContabilidade: string;
    email: string;
    telefone: string;
    responsavel: string;
}>): Promise<Contabilidade | null>;
export declare function deletar(id: number): Promise<boolean>;
/**
 * Conta certificados vinculados a uma contabilidade.
 */
export declare function contarCertificados(contabilidadeId: number): Promise<number>;
/**
 * Conta empresas vinculadas a uma contabilidade.
 */
export declare function contarEmpresas(contabilidadeId: number): Promise<number>;
/**
 * Total de empresas vinculadas (certificados + empresas) para uma contabilidade.
 */
export declare function obterTotalVinculados(contabilidadeId: number): Promise<number>;
/**
 * Total de empresas vinculadas por contabilidade (em batch).
 */
export declare function obterEmpresasVinculadasPorIds(contabilidadeIds: number[]): Promise<Record<number, number>>;
/**
 * Total de vinculados para múltiplas contabilidades (em batch).
 */
export declare function obterTotalVinculadosPorIds(contabilidadeIds: number[]): Promise<Record<number, number>>;
//# sourceMappingURL=contabilidades.d.ts.map
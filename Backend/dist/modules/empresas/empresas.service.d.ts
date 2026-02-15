/**
 * Serviço de empresas - regras de negócio e parse de parâmetros.
 */
import * as repo from './empresas.repo';
import type { EmpresaListagemParams } from './empresas.repo';
export interface ListarEmpresasQuery {
    search?: string;
    contabilidade_id?: string;
    has_cert?: string;
    has_cred?: string;
    page?: string;
    limit?: string;
}
export declare function parseListarParams(query: ListarEmpresasQuery): EmpresaListagemParams;
export declare function listarEmpresas(params: EmpresaListagemParams): Promise<repo.EmpresaListagemResult>;
export declare function obterEmpresaPorId(id: number): Promise<repo.EmpresaDetalhada | null>;
//# sourceMappingURL=empresas.service.d.ts.map
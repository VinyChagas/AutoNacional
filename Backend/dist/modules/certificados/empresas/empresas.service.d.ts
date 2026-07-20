/**
 * Serviço de empresas - regras de negócio e parse de parâmetros.
 */
import * as repo from './empresas.repo';
import type { EmpresaListagemParams } from './empresas.repo';
import { type EmpresaExportReport } from './empresas-export';
export interface ListarEmpresasQuery {
    search?: string;
    contabilidade_id?: string;
    has_cert?: string;
    has_cred?: string;
    sem_cert?: string;
    sem_cred?: string;
    sem_metodo?: string;
    segment?: string;
    report?: string;
    format?: string;
    page?: string;
    limit?: string;
    sort?: string;
    order?: string;
}
export declare function parseListarParams(query: ListarEmpresasQuery): EmpresaListagemParams;
export declare function validarFiltrosConflitantes(params: EmpresaListagemParams): string | null;
export declare function listarEmpresas(params: EmpresaListagemParams): Promise<repo.EmpresaListagemResult>;
export declare function obterEmpresaPorId(id: number): Promise<repo.EmpresaDetalhada | null>;
export declare function obterSummary(params: Pick<EmpresaListagemParams, 'search' | 'contabilidade_id' | 'has_cert' | 'has_cred' | 'sem_cert' | 'sem_cred' | 'sem_metodo'>): Promise<{
    total_empresas: number;
    certificados_vencidos: number;
    credenciais_para_validar: number;
    operacionais: number;
}>;
export interface ExportEmpresasResult {
    buffer: Buffer;
    filename: string;
    report: EmpresaExportReport;
    total: number;
}
/**
 * Exporta empresas em XLSX usando a mesma listagem/status da tela.
 * - NOT_ELIGIBLE / ALL_PENDING: filtros-base (sem segment dos cards)
 * - FILTERED: filtros-base + segment ativo
 */
export declare function exportarEmpresas(query: ListarEmpresasQuery): Promise<ExportEmpresasResult | {
    error: string;
    status: number;
}>;
//# sourceMappingURL=empresas.service.d.ts.map
import { type StatusGeralDisplay, type LoginMetodo } from '../modules/certificados/empresas/empresa-status';
export type StatusGeral = StatusGeralDisplay;
export type { LoginMetodo };
export interface EmpresaExecucaoItem {
    empresa_id: number;
    cnpj: string;
    razao_social: string;
    status_geral: StatusGeral;
    login_metodo: LoginMetodo;
    automation_eligibility?: string;
}
export interface ExecutionSummaryResponse {
    total_empresas: number;
    total_aptas: number;
    total_operacional: number;
    total_atencao: number;
    total_inoperante: number;
    total_parcial: number;
    aptas: EmpresaExecucaoItem[];
    inoperantes: EmpresaExecucaoItem[];
    parciais: EmpresaExecucaoItem[];
}
/**
 * Obtém o resumo de empresas para execução por contabilidade.
 * Inclui contagens e listas por grupo (aptas, inoperantes, parciais).
 */
export declare function obterSummaryExecucao(contabilidadeId: number): Promise<ExecutionSummaryResponse>;
/**
 * Lista empresas com método utilizável para a fila (inclui PARCIAL / warning).
 */
export declare function listarEmpresasAptas(contabilidadeId: number): Promise<EmpresaExecucaoItem[]>;
//# sourceMappingURL=execution-summary.service.d.ts.map
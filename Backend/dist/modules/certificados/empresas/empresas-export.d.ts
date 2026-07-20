import type { EmpresaAgregada } from './empresas.repo';
export declare const EMPRESA_EXPORT_REPORTS: readonly ["NOT_ELIGIBLE", "ALL_PENDING", "FILTERED"];
export type EmpresaExportReport = (typeof EMPRESA_EXPORT_REPORTS)[number];
export declare function isEmpresaExportReport(value: string): value is EmpresaExportReport;
export declare function parseEmpresaExportReport(raw: string | undefined): EmpresaExportReport | null;
/** Filtra o conjunto já listado conforme o tipo de relatório. */
export declare function filterEmpresasForReport(items: EmpresaAgregada[], report: EmpresaExportReport): EmpresaAgregada[];
export interface EmpresaExportRow {
    cnpj_cpf: string;
    razao_social: string;
    contabilidade: string;
    apta_para_automacao: string;
    situacao_geral: string;
    motivos: string;
    acao_recomendada: string;
    possui_certificado: string;
    validade_certificado: string;
    status_certificado: string;
    dias_validade: string;
    possui_credencial: string;
    status_credencial: string;
    ultimo_teste: string;
    mensagem_ultima_validacao: string;
    metodo_utilizavel: string;
    data_geracao: string;
}
export declare function assertExportRowHasNoSecrets(row: EmpresaExportRow): void;
export declare function toExportRow(item: EmpresaAgregada, generatedAt: Date): EmpresaExportRow;
export interface ExportResumoCounts {
    total_exportado: number;
    certificados_vencidos: number;
    certificados_vencendo: number;
    senhas_invalidas: number;
    credenciais_nunca_testadas: number;
    falhas_tecnicas_validacao: number;
    empresas_sem_metodo: number;
    por_contabilidade: Record<string, number>;
}
export declare function buildExportResumo(items: EmpresaAgregada[]): ExportResumoCounts;
export declare function buildExportFilename(report: EmpresaExportReport, at?: Date): string;
export declare function buildEmpresasWorkbookBuffer(items: EmpresaAgregada[], generatedAt?: Date): Buffer;
//# sourceMappingURL=empresas-export.d.ts.map
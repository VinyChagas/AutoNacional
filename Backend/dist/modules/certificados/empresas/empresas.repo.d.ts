import { type AutomationEligibility, type CertificateStatus, type CredentialRevalidationReason, type CredentialStatus, type StatusGeralDisplay } from './empresa-status';
import { type EmpresaSegment } from './empresas-segment';
export type StatusGeral = StatusGeralDisplay;
export interface EmpresaAgregada {
    id: number;
    cnpj: string;
    razao_social: string;
    regime: string | null;
    contabilidade_id: number | null;
    contabilidade_nome?: string | null;
    ativo: boolean;
    created_at: Date;
    updated_at: Date;
    has_certificado: boolean;
    cert_validade: string | null;
    has_credenciais: boolean;
    cred_status: string | null;
    cred_ultimo_teste_em: string | null;
    cred_ultima_mensagem: string | null;
    status_geral: StatusGeral;
    status_geral_motivo?: string | null;
    certificate_status: CertificateStatus;
    credential_status: CredentialStatus;
    credential_requires_revalidation: boolean;
    credential_revalidation_reason: CredentialRevalidationReason;
    automation_eligibility: AutomationEligibility;
    issue_codes: string[];
    issue_messages: string[];
    recommended_action: string | null;
    certificate_days_delta: number | null;
}
export interface EmpresaListagemParams {
    search?: string;
    contabilidade_id?: number;
    has_cert?: boolean;
    has_cred?: boolean;
    sem_cert?: boolean;
    sem_cred?: boolean;
    sem_metodo?: boolean;
    /** Segmento operacional dos cards (ignorado pelo summary). */
    segment?: EmpresaSegment;
    /** Força carregar o conjunto completo (exportação). */
    force_full_scan?: boolean;
    page?: number;
    limit?: number;
    sort?: 'cnpj' | 'razao_social' | 'contabilidade_nome' | 'cert_validade' | 'has_credenciais' | 'status_geral';
    order?: 'asc' | 'desc';
}
export interface EmpresaListagemResult {
    items: EmpresaAgregada[];
    total: number;
    page: number;
    limit: number;
}
/**
 * Lista empresas com campos agregados.
 * Filtros estruturais (chips) e segmento dos cards exigem agregação em memória;
 * nesse caso o conjunto completo do escopo base é carregado, filtrado, contado e só então paginado.
 */
export declare function listarComAgregados(params: EmpresaListagemParams): Promise<EmpresaListagemResult>;
export interface EmpresaDetalhada {
    empresa: {
        id: number;
        cnpj: string;
        razao_social: string;
        regime: string | null;
        contabilidade_id: number | null;
        ativo: boolean;
        created_at: string;
        updated_at: string;
    };
    certificados_digitais: Array<{
        id: number;
        cnpj: string;
        arquivo: string | null;
        data_validade: string | null;
        contabilidade_id: number | null;
        data_cadastro: string;
    }>;
    credenciais: Array<{
        id: number;
        tipo: string;
        usuario: string;
        status: string;
        ultimo_teste_em: string | null;
    }>;
}
/**
 * Exclui empresas em massa na ordem: credenciais → certificados_digitais → empresas.
 * Também remove arquivos do Storage após a transação.
 * Ignora IDs inexistentes e retorna a quantidade efetivamente deletada.
 * Certificados são removidos por empresaId e também por cnpj (para registros legados sem empresaId).
 */
export declare function deletarEmMassa(ids: number[]): Promise<number>;
/**
 * Retorna métricas de resumo (total, cert vencidos, cred para validar, operacionais).
 * Usa os mesmos filtros da listagem: contabilidade, search, has_cert, has_cred, sem_*.
 */
export declare function obterSummary(params: Pick<EmpresaListagemParams, 'search' | 'contabilidade_id' | 'has_cert' | 'has_cred' | 'sem_cert' | 'sem_cred' | 'sem_metodo'>): Promise<{
    total_empresas: number;
    certificados_vencidos: number;
    credenciais_para_validar: number;
    operacionais: number;
}>;
/**
 * Obtém empresa por ID com certificados e credenciais.
 */
export declare function obterPorIdComDetalhes(id: number): Promise<EmpresaDetalhada | null>;
//# sourceMappingURL=empresas.repo.d.ts.map
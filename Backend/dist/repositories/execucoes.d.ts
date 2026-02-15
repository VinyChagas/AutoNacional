import type { Execucao } from '@prisma/client';
export declare function listarExecucoes(opts?: {
    skip?: number;
    limit?: number;
    status?: string;
    empresaId?: number;
}): Promise<Execucao[]>;
export declare function obterPorId(id: number): Promise<Execucao | null>;
export declare function criar(data: {
    empresaId: number;
    cnpj?: string;
    periodoInicio?: string;
    periodoFim?: string;
    tipo?: string;
}): Promise<Execucao>;
export declare function atualizar(id: number, data: Partial<{
    status: string;
    etapaAtual: string;
    progresso: number;
    mensagem: string;
    dataInicio: Date;
    dataFim: Date;
    mensagemErro: string;
    qtdNotasEmitidas: number;
    qtdNotasRecebidas: number;
    resultadoFinal: string;
}>): Promise<Execucao | null>;
//# sourceMappingURL=execucoes.d.ts.map
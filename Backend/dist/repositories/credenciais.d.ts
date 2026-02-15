import type { Credencial } from '@prisma/client';
export type TipoCredencial = 'CNPJ_SENHA' | 'CPF_SENHA';
export declare function listarPorEmpresa(empresaId: number): Promise<Credencial[]>;
export declare function obterPorId(credencialId: number): Promise<Credencial | null>;
export declare function criarOuAtualizar(empresaId: number, tipo: TipoCredencial, usuario: string, senha: string): Promise<Credencial>;
export declare function atualizarStatus(credencialId: number, status: string): Promise<Credencial | null>;
export declare function atualizarCredencial(credencialId: number, senha: string): Promise<Credencial | null>;
export declare function deletarCredencial(credencialId: number): Promise<boolean>;
export declare function descriptografarSenha(credencial: Credencial): string;
//# sourceMappingURL=credenciais.d.ts.map
/**
 * Cliente Supabase server-side com Service Role Key.
 *
 * ATENÇÃO: Nunca exponha SUPABASE_SERVICE_ROLE_KEY ao frontend.
 * Use apenas no backend (Express). O service role bypassa RLS.
 */
import { SupabaseClient } from '@supabase/supabase-js';
/**
 * Retorna o cliente Supabase singleton.
 * Deve ser usado apenas no servidor (rotas, services, jobs).
 */
export declare function getSupabaseClient(): SupabaseClient;
/**
 * Garante que o bucket de certificados existe no Storage.
 * Cria o bucket na primeira inicialização se não existir.
 */
export declare function ensureCertificadosBucket(): Promise<void>;
/**
 * Exemplo de uso - Storage (upload de certificados):
 *
 *   const client = getSupabaseClient();
 *   const { data, error } = await client.storage
 *     .from(env.CERT_STORAGE_BUCKET)
 *     .upload(`${cnpj}.pfx`, fileBuffer, { upsert: true });
 *
 * Exemplo - Tabela:
 *
 *   const { data, error } = await client
 *     .from('certificados_digitais')
 *     .insert({ cnpj, arquivo, data_validade, empresa_id })
 *     .select()
 *     .single();
 *
 * Exemplo - RPC:
 *
 *   const { data, error } = await client.rpc('nome_funcao', { param: value });
 */
//# sourceMappingURL=supabase.d.ts.map
/**
 * Cliente Supabase server-side com Service Role Key.
 * Use SOMENTE no backend. NUNCA exponha ao frontend.
 *
 * Para Storage (certificados) e acesso a tabelas com bypass de RLS.
 */
import { SupabaseClient } from '@supabase/supabase-js';
/**
 * Retorna o cliente Supabase admin (service role) singleton.
 */
export declare function getSupabaseAdmin(): SupabaseClient;
/**
 * Cliente admin lazy: use supabaseAdmin para acessar o client sem chamar getSupabaseAdmin().
 * NUNCA exponha este módulo ao frontend.
 */
export declare const supabaseAdmin: SupabaseClient<any, "public", "public", any, any>;
//# sourceMappingURL=supabase.d.ts.map
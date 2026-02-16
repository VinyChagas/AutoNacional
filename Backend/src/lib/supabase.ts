/**
 * Cliente Supabase server-side com Service Role Key.
 * Use SOMENTE no backend. NUNCA exponha ao frontend.
 *
 * Para Storage (certificados) e acesso a tabelas com bypass de RLS.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

let _client: SupabaseClient | null = null;

/**
 * Retorna o cliente Supabase admin (service role) singleton.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_client) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.'
      );
    }
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}

/**
 * Cliente admin lazy: use supabaseAdmin para acessar o client sem chamar getSupabaseAdmin().
 * NUNCA exponha este módulo ao frontend.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabaseAdmin() as unknown as Record<string, unknown>)[prop as string];
  },
});

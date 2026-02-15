/**
 * Cliente Supabase server-side com Service Role Key.
 *
 * ATENÇÃO: Nunca exponha SUPABASE_SERVICE_ROLE_KEY ao frontend.
 * Use apenas no backend (Express). O service role bypassa RLS.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('supabase');

let supabase: SupabaseClient | null = null;

/**
 * Retorna o cliente Supabase singleton.
 * Deve ser usado apenas no servidor (rotas, services, jobs).
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env. ' +
          'Para validação estrita na inicialização, use USE_SUPABASE=true.'
      );
    }
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return supabase;
}

/**
 * Garante que o bucket de certificados existe no Storage.
 * Cria o bucket na primeira inicialização se não existir.
 */
export async function ensureCertificadosBucket(): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return; // Supabase não configurado, pula
  }
  try {
    const client = getSupabaseClient();
    const bucket = env.CERT_STORAGE_BUCKET || 'certificados';
    const { data: buckets } = await client.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === bucket);
    if (!exists) {
      const { error } = await client.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: '10MB',
        allowedMimeTypes: ['application/x-pkcs12', 'application/pkcs12', 'application/octet-stream'],
      });
      if (error && !error.message?.toLowerCase().includes('already exists')) {
        throw error;
      }
    }
  } catch (err) {
    // Não falha o startup; o upload falhará com mensagem clara
    logger.warn({ err }, 'Bucket certificados: verifique se existe no Storage');
  }
}

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

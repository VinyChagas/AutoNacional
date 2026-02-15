/**
 * Exemplo de uso do cliente Supabase server-side.
 *
 * NUNCA importe isto no frontend. Service role key bypassa RLS.
 */
import { getSupabaseClient } from '../config/supabase';
import { env } from '../config/env';

/**
 * Exemplo: upload de certificado para Storage Supabase.
 */
export async function uploadCertificadoToStorage(
  cnpj: string,
  buffer: Buffer
): Promise<{ path: string } | { error: string }> {
  const client = getSupabaseClient();
  const path = `${cnpj}.pfx`;

  const { data, error } = await client.storage
    .from(env.CERT_STORAGE_BUCKET)
    .upload(path, buffer, { upsert: true });

  if (error) {
    return { error: error.message };
  }
  return { path: data.path };
}

/**
 * Exemplo: obter URL pública (se bucket for público) ou signed.
 */
export async function getCertificadoUrl(cnpj: string, expiresIn = 3600): Promise<string | null> {
  const client = getSupabaseClient();
  const path = `${cnpj}.pfx`;

  const { data } = await client.storage
    .from(env.CERT_STORAGE_BUCKET)
    .createSignedUrl(path, expiresIn);

  return data?.signedUrl ?? null;
}

/**
 * Exemplo: inserir na tabela via Supabase (alternativa ao Prisma).
 */
export async function insertCertificadoViaSupabase(payload: {
  cnpj: string;
  arquivo: string;
  data_validade?: string;
  empresa_id?: number;
  contabilidade_id?: number;
}) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('certificados_digitais')
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

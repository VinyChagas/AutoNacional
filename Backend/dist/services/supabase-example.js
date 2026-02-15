"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCertificadoToStorage = uploadCertificadoToStorage;
exports.getCertificadoUrl = getCertificadoUrl;
exports.insertCertificadoViaSupabase = insertCertificadoViaSupabase;
/**
 * Exemplo de uso do cliente Supabase server-side.
 *
 * NUNCA importe isto no frontend. Service role key bypassa RLS.
 */
const supabase_1 = require("../config/supabase");
const env_1 = require("../config/env");
/**
 * Exemplo: upload de certificado para Storage Supabase.
 */
async function uploadCertificadoToStorage(cnpj, buffer) {
    const client = (0, supabase_1.getSupabaseClient)();
    const path = `${cnpj}.pfx`;
    const { data, error } = await client.storage
        .from(env_1.env.CERT_STORAGE_BUCKET)
        .upload(path, buffer, { upsert: true });
    if (error) {
        return { error: error.message };
    }
    return { path: data.path };
}
/**
 * Exemplo: obter URL pública (se bucket for público) ou signed.
 */
async function getCertificadoUrl(cnpj, expiresIn = 3600) {
    const client = (0, supabase_1.getSupabaseClient)();
    const path = `${cnpj}.pfx`;
    const { data } = await client.storage
        .from(env_1.env.CERT_STORAGE_BUCKET)
        .createSignedUrl(path, expiresIn);
    return data?.signedUrl ?? null;
}
/**
 * Exemplo: inserir na tabela via Supabase (alternativa ao Prisma).
 */
async function insertCertificadoViaSupabase(payload) {
    const client = (0, supabase_1.getSupabaseClient)();
    const { data, error } = await client
        .from('certificados_digitais')
        .insert(payload)
        .select()
        .single();
    if (error)
        throw new Error(error.message);
    return data;
}
//# sourceMappingURL=supabase-example.js.map
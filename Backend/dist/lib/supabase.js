"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAdmin = void 0;
exports.getSupabaseAdmin = getSupabaseAdmin;
/**
 * Cliente Supabase server-side com Service Role Key.
 * Use SOMENTE no backend. NUNCA exponha ao frontend.
 *
 * Para Storage (certificados) e acesso a tabelas com bypass de RLS.
 */
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../config/env");
let _client = null;
/**
 * Retorna o cliente Supabase admin (service role) singleton.
 */
function getSupabaseAdmin() {
    if (!_client) {
        if (!env_1.env.SUPABASE_URL || !env_1.env.SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error('Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.');
        }
        _client = (0, supabase_js_1.createClient)(env_1.env.SUPABASE_URL, env_1.env.SUPABASE_SERVICE_ROLE_KEY, {
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
exports.supabaseAdmin = new Proxy({}, {
    get(_, prop) {
        return getSupabaseAdmin()[prop];
    },
});
//# sourceMappingURL=supabase.js.map
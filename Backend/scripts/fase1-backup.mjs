#!/usr/bin/env node
/**
 * Fase 1 — Backup e inventário completo para migração Supabase → PostgreSQL próprio.
 * Uso: node scripts/fase1-backup.mjs
 *
 * Gera:
 *   dumps/supabase_schema_<data>.sql
 *   dumps/supabase_data_<data>.sql
 *   dumps/supabase_views_<data>.sql
 *   dumps/storage-certificados_<data>/ (+ manifest.json)
 *   dumps/FASE1_MANIFEST_<data>.json
 *   dumps/FASE1_INVENTARIO_<data>.md
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
dotenv.config({ path: join(backendRoot, '.env') });

const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const dumpsDir = join(backendRoot, 'dumps');
mkdirSync(dumpsDir, { recursive: true });

function maskUrl(url) {
  if (!url) return '(não definida)';
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username && u.username !== 'postgres') u.username = '***';
    return u.toString();
  } catch {
    return '(formato inválido)';
  }
}

function extractProjectRef(url) {
  if (!url) return null;
  const m = url.match(/https?:\/\/([^.]+)\.supabase\.co/);
  return m?.[1] ?? null;
}

function scanLocalCerts(dir) {
  if (!existsSync(dir)) return { exists: false, files: [], total_bytes: 0 };
  const files = [];
  let total = 0;

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(pfx|p12)$/i.test(entry.name)) {
        const st = statSync(full);
        files.push({ path: full.replace(backendRoot + '/', ''), bytes: st.size });
        total += st.size;
      }
    }
  }
  walk(dir);
  return { exists: true, files, total_bytes: total };
}

console.log('=== Fase 1: Backup e inventário ===\n');

// 1. Dump do banco
console.log('[1/4] Dump PostgreSQL (schema + dados)...');
execSync('node scripts/dump-supabase.mjs', { cwd: backendRoot, stdio: 'inherit' });

// 2. Dump de views
console.log('\n[2/4] Dump de views...');
const viewsFile = join(dumpsDir, `supabase_views_${date}.sql`);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: views } = await client.query(`
  SELECT c.relname AS view_name, pg_get_viewdef(c.oid, true) AS definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
  ORDER BY c.relname
`);

const viewLines = [
  `-- Views do schema public — Fase 1 backup`,
  `-- Data: ${new Date().toISOString()}`,
  '',
];
for (const v of views) {
  viewLines.push(`-- View: ${v.view_name}`);
  viewLines.push(`CREATE OR REPLACE VIEW public."${v.view_name}" AS`);
  viewLines.push(`${v.definition};`);
  viewLines.push('');
}
writeFileSync(viewsFile, viewLines.join('\n'), 'utf8');
console.log(`Views: ${viewsFile} (${views.length} view(s))`);

// Contagens por tabela
const { rows: counts } = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`);
const tableCounts = {};
for (const { table_name } of counts) {
  const r = await client.query(`SELECT count(*)::int AS c FROM public."${table_name}"`);
  tableCounts[table_name] = r.rows[0].c;
}

const { rows: dbSize } = await client.query(
  `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
);
await client.end();

// 3. Export Storage
console.log('\n[3/4] Export Supabase Storage (certificados)...');
execSync('node scripts/export-storage-certificados.mjs', { cwd: backendRoot, stdio: 'inherit' });

// 4. Inventário
console.log('\n[4/4] Gerando manifest e inventário...');
const storageDir = join(dumpsDir, `storage-certificados_${date}`);
const storageManifestPath = join(storageDir, 'manifest.json');
let storageManifest = null;
if (existsSync(storageManifestPath)) {
  storageManifest = JSON.parse(readFileSync(storageManifestPath, 'utf8'));
}

const localCerts = scanLocalCerts(join(backendRoot, 'certificados_armazenados'));

const envInventory = {
  SUPABASE_URL: maskUrl(process.env.SUPABASE_URL),
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? '(definida — omitida)' : '(não definida)',
  DATABASE_URL: maskUrl(process.env.DATABASE_URL),
  CERT_STORAGE_BUCKET: process.env.CERT_STORAGE_BUCKET || 'certificados (default)',
  USE_SUPABASE: process.env.USE_SUPABASE || '(não definida)',
  CRYPTO_KEY: process.env.CRYPTO_KEY ? '(definida — omitida)' : '(não definida)',
  PORT: process.env.PORT || '4321 (default)',
  CORS_ORIGINS: process.env.CORS_ORIGINS || '(não definida)',
};

const totalRows = Object.values(tableCounts).reduce((a, b) => a + b, 0);

const manifest = {
  phase: 1,
  generated_at: new Date().toISOString(),
  project_ref: extractProjectRef(process.env.SUPABASE_URL),
  database: {
    size: dbSize[0]?.size,
    tables: tableCounts,
    total_rows: totalRows,
    schema_file: `supabase_schema_${date}.sql`,
    data_file: `supabase_data_${date}.sql`,
    views_file: `supabase_views_${date}.sql`,
  },
  storage: storageManifest?.summary ?? { note: 'manifest não encontrado' },
  storage_dir: `storage-certificados_${date}/`,
  local_legacy_certs: localCerts,
  env: envInventory,
};

const manifestFile = join(dumpsDir, `FASE1_MANIFEST_${date}.json`);
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');

const inventarioMd = `# Fase 1 — Backup e Inventário

**Gerado em:** ${new Date().toISOString()}  
**Projeto Supabase:** ${manifest.project_ref ?? 'N/A'}

## Arquivos gerados

| Arquivo | Descrição |
|---------|-----------|
| \`supabase_schema_${date}.sql\` | Schema (19 tabelas + índices) |
| \`supabase_data_${date}.sql\` | Dados (${totalRows.toLocaleString('pt-BR')} registros) |
| \`supabase_views_${date}.sql\` | Views (${views.length}) |
| \`storage-certificados_${date}/\` | Certificados PFX exportados do Storage |
| \`FASE1_MANIFEST_${date}.json\` | Manifest machine-readable |

## Banco de dados

- **Tamanho:** ${dbSize[0]?.size ?? 'N/A'}
- **Total de registros (public):** ${totalRows.toLocaleString('pt-BR')}

### Contagem por tabela

| Tabela | Registros |
|--------|-----------|
${Object.entries(tableCounts).map(([t, c]) => `| \`${t}\` | ${c.toLocaleString('pt-BR')} |`).join('\n')}

## Supabase Storage

- **Bucket:** ${process.env.CERT_STORAGE_BUCKET || 'certificados'}
- **Arquivos exportados:** ${storageManifest?.summary?.downloaded ?? 'N/A'}
- **Falhas:** ${storageManifest?.summary?.failed ?? 0}
- **Tamanho total:** ${storageManifest?.summary?.total_bytes ? (storageManifest.summary.total_bytes / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}

## Certificados locais (legado)

- **Pasta \`certificados_armazenados/\`:** ${localCerts.exists ? 'existe' : 'não encontrada'}
- **Arquivos .pfx/.p12:** ${localCerts.files.length}
- **Tamanho:** ${(localCerts.total_bytes / 1024).toFixed(1)} KB

## Variáveis de ambiente (valores mascarados)

| Variável | Status |
|----------|--------|
${Object.entries(envInventory).map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n')}

## Próximo passo

Fase 2 — Provisionar PostgreSQL 18 na VPS (Docker) e validar extensões \`pgcrypto\`, \`uuid-ossp\`.
`;

const inventarioFile = join(dumpsDir, `FASE1_INVENTARIO_${date}.md`);
writeFileSync(inventarioFile, inventarioMd, 'utf8');

console.log(`\n=== Fase 1 concluída ===`);
console.log(`Manifest: ${manifestFile}`);
console.log(`Inventário: ${inventarioFile}`);

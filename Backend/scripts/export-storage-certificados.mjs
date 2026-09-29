#!/usr/bin/env node
/**
 * Exporta todos os arquivos do bucket Supabase Storage (certificados).
 * Script pontual da migração (já executado). Não faz parte do runtime de produção.
 *
 * Se for reexecutar, instale @supabase/supabase-js temporariamente —
 * a dependência foi removida do package.json após a migração para filesystem local.
 *
 * Uso: node scripts/export-storage-certificados.mjs
 * Saída: Backend/dumps/storage-certificados_<data>/
 */
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
dotenv.config({ path: join(backendRoot, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.CERT_STORAGE_BUCKET || 'certificados';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const outDir = join(backendRoot, 'dumps', `storage-certificados_${date}`);
mkdirSync(outDir, { recursive: true });

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function listAll(prefix = '') {
  const files = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list(${prefix}): ${error.message}`);
    if (!data?.length) break;

    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id == null) {
        files.push(...(await listAll(path)));
      } else {
        files.push({
          path,
          size: item.metadata?.size ?? null,
          mimetype: item.metadata?.mimetype ?? null,
          updated_at: item.updated_at ?? null,
        });
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return files;
}

async function downloadFile(path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`download(${path}): ${error.message}`);
  return data;
}

const files = await listAll();
console.log(`Encontrados ${files.length} arquivo(s) no bucket "${bucket}"`);

const manifest = {
  exported_at: new Date().toISOString(),
  bucket,
  total_files: files.length,
  files: [],
  errors: [],
};

let downloaded = 0;
let totalBytes = 0;

for (const file of files) {
  const dest = join(outDir, file.path);
  mkdirSync(dirname(dest), { recursive: true });

  try {
    const blob = await downloadFile(file.path);
    const buffer = Buffer.from(await blob.arrayBuffer());
    await pipeline(Readable.from(buffer), createWriteStream(dest));
    downloaded += 1;
    totalBytes += buffer.length;
    manifest.files.push({ ...file, local_path: file.path, bytes: buffer.length, status: 'ok' });
    if (downloaded % 50 === 0) {
      console.log(`  ${downloaded}/${files.length} baixados...`);
    }
  } catch (err) {
    manifest.errors.push({ path: file.path, error: err.message });
    manifest.files.push({ ...file, status: 'error', error: err.message });
    console.error(`  ERRO: ${file.path} — ${err.message}`);
  }
}

manifest.summary = {
  downloaded,
  failed: manifest.errors.length,
  total_bytes: totalBytes,
};

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Exportação concluída: ${downloaded}/${files.length} arquivos (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Destino: ${outDir}`);

if (manifest.errors.length) {
  process.exitCode = 1;
}

#!/usr/bin/env node
/**
 * Dump do banco Supabase (schema + dados) sem depender de pg_dump/Docker.
 * Uso: node scripts/dump-supabase.mjs
 * Saída: Backend/dumps/supabase_schema_<data>.sql e supabase_data_<data>.sql
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
dotenv.config({ path: join(backendRoot, '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não definida no .env');
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const dumpsDir = join(backendRoot, 'dumps');
mkdirSync(dumpsDir, { recursive: true });

const schemaFile = join(dumpsDir, `supabase_schema_${date}.sql`);
const dataFile = join(dumpsDir, `supabase_data_${date}.sql`);

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

function escapeSql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value instanceof Date) return `'${value.toISOString().replace('T', ' ').replace('Z', '+00')}'`;
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'`;
  if (Array.isArray(value)) {
    const inner = value.map((v) => (v === null ? 'NULL' : escapeSql(v))).join(', ');
    return `ARRAY[${inner}]`;
  }
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function dumpSchema() {
  const { rows: tables } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const lines = [
    '-- Dump de schema (public) gerado por scripts/dump-supabase.mjs',
    `-- Data: ${new Date().toISOString()}`,
    'SET client_encoding = UTF8;',
    'SET standard_conforming_strings = on;',
    '',
  ];

  for (const { table_name: table } of tables) {
    const { rows: cols } = await client.query(
      `
      SELECT
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
        NOT a.attnotnull AS is_nullable,
        pg_get_expr(ad.adbin, ad.adrelid) AS column_default
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `,
      [table],
    );

    const colDefs = cols.map((col) => {
      let def = `"${col.column_name}" ${col.data_type}`;
      if (col.column_default != null) def += ` DEFAULT ${col.column_default}`;
      if (!col.is_nullable) def += ' NOT NULL';
      return def;
    });

    lines.push(`CREATE TABLE IF NOT EXISTS public."${table}" (`);
    lines.push(`  ${colDefs.join(',\n  ')}`);
    lines.push(');');
    lines.push('');
  }

  const { rows: indexes } = await client.query(`
    SELECT indexdef || ';' AS ddl
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname NOT LIKE '%_pkey'
    ORDER BY tablename, indexname
  `);
  if (indexes.length) {
    lines.push('-- Índices');
    for (const { ddl } of indexes) lines.push(ddl);
    lines.push('');
  }

  writeFileSync(schemaFile, lines.join('\n'), 'utf8');
  console.log(`Schema: ${schemaFile} (${tables.length} tabelas)`);
}

async function dumpData() {
  const { rows: tables } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const lines = [
    '-- Dump de dados (public) gerado por scripts/dump-supabase.mjs',
    `-- Data: ${new Date().toISOString()}`,
    'SET session_replication_role = replica;',
    '',
  ];

  let totalRows = 0;

  for (const { table_name: table } of tables) {
    const { rows } = await client.query(`SELECT * FROM public."${table}"`);
    if (!rows.length) continue;

    const columns = Object.keys(rows[0]).map((c) => `"${c}"`).join(', ');
    lines.push(`-- ${table}: ${rows.length} registro(s)`);

    for (const row of rows) {
      const values = Object.values(row).map(escapeSql).join(', ');
      lines.push(`INSERT INTO public."${table}" (${columns}) VALUES (${values});`);
    }
    lines.push('');
    totalRows += rows.length;
  }

  lines.push('SET session_replication_role = DEFAULT;');
  writeFileSync(dataFile, lines.join('\n'), 'utf8');
  console.log(`Dados: ${dataFile} (${totalRows} registros)`);
}

try {
  await client.connect();
  console.log('Conectado ao Supabase. Gerando dump...');
  await dumpSchema();
  await dumpData();
  console.log('Dump concluído.');
} catch (err) {
  console.error('Falha no dump:', err.message);
  process.exit(1);
} finally {
  await client.end();
}

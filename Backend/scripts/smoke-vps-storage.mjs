#!/usr/bin/env node
/**
 * Smoke test read-only do storage de certificados PFX (local ou SFTP).
 * Não cria, modifica nem exclui arquivos. Não imprime conteúdo PFX nem senhas.
 *
 * Uso: npm run test:smoke-storage
 */
import { access, constants, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client } from 'ssh2';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
dotenv.config({ path: join(backendRoot, '.env') });

const DEFAULT_PATH = '/srv/data/autonacional/certificados';
const DRIVER = (process.env.CERT_STORAGE_DRIVER || 'local').trim().toLowerCase();

function assertOk(label, cond, detail = '') {
  if (!cond) {
    throw new Error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`  OK  ${label}${detail ? ` (${detail})` : ''}`);
}

function maskRelative(p) {
  const s = String(p || '').trim();
  if (s.length <= 12) return '***';
  return `${s.slice(0, 8)}...${s.slice(-8)}`;
}

function resolveSafePosix(baseDir, relativePath) {
  const trimmed = String(relativePath || '').trim();
  if (!trimmed) throw new Error('path relativo vazio');
  const posix = trimmed.replace(/\\/g, '/');
  if (
    isAbsolute(trimmed) ||
    posix.startsWith('/') ||
    posix.split('/').includes('..')
  ) {
    throw new Error('path relativo inseguro (traversal ou absoluto)');
  }
  const baseResolved = resolve(baseDir);
  const candidate = resolve(baseResolved, posix);
  const rel = relative(baseResolved, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path resolvido sairia da base de storage');
  }
  const prefix = baseResolved.endsWith(sep) ? baseResolved : baseResolved + sep;
  if (!candidate.startsWith(prefix)) {
    throw new Error('path resolvido sairia da base de storage');
  }
  return candidate;
}

function resolveSafeRemotePosix(baseDir, relativePath) {
  const trimmed = String(relativePath || '').trim();
  if (!trimmed) throw new Error('path relativo vazio');
  const posix = trimmed.replace(/\\/g, '/');
  if (
    posix.startsWith('/') ||
    posix.split('/').includes('..') ||
    /^[a-zA-Z]:/.test(posix)
  ) {
    throw new Error('path relativo inseguro (traversal ou absoluto)');
  }
  const baseResolved = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const candidate = `${baseResolved}/${posix.split('/').filter((s) => s && s !== '.').join('/')}`;
  const rel = candidate.slice(baseResolved.length + 1);
  if (rel.includes('..') || candidate === baseResolved) {
    throw new Error('path resolvido sairia da base de storage');
  }
  return candidate;
}

async function countPfxLocal(dir) {
  let count = 0;
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile() && /\.(pfx|p12)$/i.test(entry.name)) {
        count++;
      }
    }
  }
  await walk(dir);
  return count;
}

function describeUrl(databaseUrl) {
  if (!databaseUrl) return { host: '(não configurado)', database: '(não configurado)' };
  try {
    const normalized = databaseUrl
      .replace(/^postgresql:/i, 'http:')
      .replace(/^postgres:/i, 'http:');
    const u = new URL(normalized);
    return {
      host: u.hostname || '(desconhecido)',
      database:
        decodeURIComponent(u.pathname.replace(/^\//, '').split('?')[0] || '') ||
        '(desconhecido)',
    };
  } catch {
    return { host: '(indisponível)', database: '(indisponível)' };
  }
}

function resolveSftpAuthMode() {
  const sshAuthSock = (process.env.SSH_AUTH_SOCK || '').trim();
  const privateKeyPath = (process.env.CERT_STORAGE_SFTP_PRIVATE_KEY || '').trim();

  if (sshAuthSock) {
    return { mode: 'ssh-agent', privateKeyPath: '' };
  }
  if (privateKeyPath) {
    return { mode: 'private-key', privateKeyPath };
  }
  throw new Error(
    'SFTP requer SSH_AUTH_SOCK (ssh-agent) ou CERT_STORAGE_SFTP_PRIVATE_KEY configurado'
  );
}

async function buildSftpConnectConfig(host, port, username) {
  const auth = resolveSftpAuthMode();
  const config = {
    host,
    port,
    username,
    readyTimeout: 30_000,
    keepaliveInterval: 10_000,
  };

  if (auth.mode === 'ssh-agent') {
    config.agent = process.env.SSH_AUTH_SOCK;
  } else {
    config.privateKey = await readFile(auth.privateKeyPath, 'utf8');
  }

  return { config, authMode: auth.mode };
}

function sftpConnect(config) {
  return new Promise((resolveConn, reject) => {
    const client = new Client();
    client
      .on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }
          resolveConn({ client, sftp });
        });
      })
      .on('error', reject)
      .connect(config);
  });
}

function sftpStat(sftp, remotePath) {
  return new Promise((resolveStat, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) reject(err);
      else resolveStat(stats);
    });
  });
}

function sftpReadFile(sftp, remotePath) {
  return new Promise((resolveRead, reject) => {
    sftp.readFile(remotePath, (err, data) => {
      if (err) reject(err);
      else resolveRead(data);
    });
  });
}

async function countPfxSftp(sftp, basePath) {
  let count = 0;
  async function walk(current) {
    const entries = await new Promise((resolveList, reject) => {
      sftp.readdir(current, (err, list) => {
        if (err) reject(err);
        else resolveList(list);
      });
    });
    for (const entry of entries) {
      const child = `${current.replace(/\/$/, '')}/${entry.filename}`;
      if (entry.attrs.isDirectory()) {
        await walk(child);
      } else if (/\.(pfx|p12)$/i.test(entry.filename)) {
        count++;
      }
    }
  }
  await walk(basePath);
  return count;
}

async function smokeLocal(basePath) {
  const baseResolved = resolve(basePath);
  await access(baseResolved, constants.R_OK);
  const dirStat = await stat(baseResolved);
  assertOk('diretório local existe e é acessível', dirStat.isDirectory());

  const pfxCount = await countPfxLocal(baseResolved);
  assertOk('existem arquivos PFX no storage local', pfxCount > 0, `count=${pfxCount}`);

  return {
    async readRelative(relativePath) {
      const physical = resolveSafePosix(baseResolved, relativePath);
      const fileStat = await stat(physical);
      assertOk('arquivo físico localizado', fileStat.isFile(), `bytes=${fileStat.size}`);
      const buf = await readFile(physical);
      assertOk('arquivo pode ser lido', Buffer.isBuffer(buf) && buf.length > 0, `bytes=${buf.length}`);
    },
  };
}

async function smokeSftp() {
  const host = (process.env.CERT_STORAGE_SFTP_HOST || '').trim();
  const port = parseInt(process.env.CERT_STORAGE_SFTP_PORT || '22', 10);
  const username = (process.env.CERT_STORAGE_SFTP_USER || '').trim();
  const basePath = (process.env.CERT_STORAGE_SFTP_BASE_PATH || DEFAULT_PATH).trim();

  assertOk('CERT_STORAGE_SFTP_HOST definido', Boolean(host));
  assertOk('CERT_STORAGE_SFTP_USER definido', Boolean(username));
  assertOk('CERT_STORAGE_SFTP_BASE_PATH definido', Boolean(basePath));

  const { config, authMode } = await buildSftpConnectConfig(host, port, username);
  console.log(`Autenticação SFTP: ${authMode}`);

  const { client, sftp } = await sftpConnect(config);

  try {
    const baseStat = await sftpStat(sftp, basePath);
    assertOk('diretório remoto SFTP existe e é acessível', baseStat.isDirectory());

    const pfxCount = await countPfxSftp(sftp, basePath);
    assertOk('existem arquivos PFX no storage SFTP', pfxCount > 0, `count=${pfxCount}`);

    return {
      async readRelative(relativePath) {
        const remotePath = resolveSafeRemotePosix(basePath, relativePath);
        const fileStat = await sftpStat(sftp, remotePath);
        assertOk('arquivo remoto localizado', fileStat.isFile(), `bytes=${fileStat.size}`);
        const buf = await sftpReadFile(sftp, remotePath);
        assertOk('arquivo pode ser lido via SFTP', Buffer.isBuffer(buf) && buf.length > 0, `bytes=${buf.length}`);
      },
    };
  } finally {
    client.end();
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;

  console.log(`=== Smoke Storage (${DRIVER}, somente leitura) ===`);
  console.log(`CERT_STORAGE_DRIVER: ${DRIVER}`);
  console.log('');

  if (DRIVER !== 'local' && DRIVER !== 'sftp') {
    throw new Error(`CERT_STORAGE_DRIVER inválido: ${DRIVER}`);
  }

  const storage =
    DRIVER === 'sftp'
      ? await smokeSftp()
      : await smokeLocal((process.env.CERT_STORAGE_PATH || DEFAULT_PATH).trim());

  if (!connectionString) {
    throw new Error('DATABASE_URL não definida no .env');
  }

  const target = describeUrl(connectionString);
  console.log(`Database host: ${target.host}`);
  console.log(`Database: ${target.database}`);

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter, log: ['error'] });

  try {
    await prisma.$connect();

    const cert = await prisma.certificado.findFirst({
      where: { arquivo: { not: null } },
      select: { id: true, arquivo: true },
      orderBy: { id: 'asc' },
    });

    assertOk(
      'há certificado com path relativo no banco',
      Boolean(cert?.arquivo?.trim())
    );

    const relativePath = cert.arquivo.trim();
    console.log(`  ..  path relativo mascarado: ${maskRelative(relativePath)}`);

    await storage.readRelative(relativePath);

    console.log('');
    console.log('Smoke storage: SUCESSO (somente leitura)');
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('Smoke storage: FALHA');
  console.error(err?.message || err);
  process.exit(1);
});

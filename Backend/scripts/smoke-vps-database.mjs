/**
 * Smoke test read-only contra PostgreSQL via Prisma (DATABASE_URL).
 * Não altera dados. Não executa migrations. Não toca Storage.
 *
 * Uso: node scripts/smoke-vps-database.mjs
 * (ou: npm run test:smoke-db — se o script estiver no package.json)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function describeUrl(databaseUrl) {
  if (!databaseUrl) return { host: '(não configurado)', database: '(não configurado)', user: '' };
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, 'http:').replace(/^postgres:/i, 'http:');
    const u = new URL(normalized);
    return {
      host: u.hostname || '(desconhecido)',
      database: decodeURIComponent(u.pathname.replace(/^\//, '').split('?')[0] || '') || '(desconhecido)',
      user: u.username || '',
    };
  } catch {
    return { host: '(indisponível)', database: '(indisponível)', user: '' };
  }
}

function assertOk(label, cond, detail = '') {
  if (!cond) {
    throw new Error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`  OK  ${label}${detail ? ` (${detail})` : ''}`);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL não definida no .env');
    process.exit(1);
  }

  const target = describeUrl(connectionString);
  console.log('=== Smoke Database (somente leitura) ===');
  console.log(`Host: ${target.host}`);
  console.log(`Database: ${target.database}`);
  console.log(`User: ${target.user || '(omitido)'}`);
  console.log('');

  if (target.user === 'vinylab_admin') {
    console.error('Recusado: a aplicação não deve usar vinylab_admin. Use autonacional_app.');
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter, log: ['error'] });

  try {
    await prisma.$connect();
    assertOk('conexão Prisma', true);

    const ping = await prisma.$queryRaw`SELECT 1::int AS ok`;
    assertOk('SELECT 1', Array.isArray(ping) && Number(ping[0]?.ok) === 1);

    const empresas = await prisma.empresa.count();
    assertOk('listagem/count empresas', empresas >= 0, `count=${empresas}`);

    const contabilidades = await prisma.contabilidade.count();
    assertOk('consulta contabilidades', contabilidades >= 0, `count=${contabilidades}`);

    const certificados = await prisma.certificado.count();
    assertOk('consulta certificados_digitais', certificados >= 0, `count=${certificados}`);

    const execucoes = await prisma.execucao.count();
    assertOk('consulta execucoes', execucoes >= 0, `count=${execucoes}`);

    const automationExecutions = await prisma.automationExecution.count();
    assertOk('consulta automation_executions', automationExecutions >= 0, `count=${automationExecutions}`);

    const batches = await prisma.automationExecutionBatch.count();
    assertOk('consulta automation_execution_batches', batches >= 0, `count=${batches}`);

    const logBatches = await prisma.execucaoLogBatch.count();
    assertOk('consulta execucao_log_batch', logBatches >= 0, `count=${logBatches}`);

    const billing = await prisma.$queryRaw`
      SELECT competencia, contabilidade_id, empresas_processadas_total
      FROM billing_monthly_summary
      LIMIT 5
    `;
    assertOk(
      'consulta view billing_monthly_summary',
      Array.isArray(billing),
      `rows=${billing.length}`
    );

    console.log('');
    console.log('Smoke database: SUCESSO (somente leitura)');
    if (target.host.includes('supabase')) {
      console.log(
        'AVISO: DATABASE_URL ainda aponta para host Supabase. Para teste VPS, aponte para vinylab-postgres (rede Docker) ou SSH tunnel local.'
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Smoke database: FALHA');
    console.error(msg);
    // Não imprime connection string / password
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('Smoke database: FALHA');
  console.error(err?.message || err);
  process.exit(1);
});

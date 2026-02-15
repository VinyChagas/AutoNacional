/**
 * Cliente Prisma singleton.
 * Conecta ao PostgreSQL (Supabase) via adapter @prisma/adapter-pg.
 * Prisma 7 exige adapter ou accelerateUrl para engine type "client".
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getLogger } from '../infrastructure/logger';
import { DATABASE_URL } from '../infrastructure/config';

const logger = getLogger('db');

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient(): PrismaClient {
  const connectionString = DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL é obrigatória para conexão com PostgreSQL');
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Inicializa a conexão com o banco de dados.
 * Cliente de conexão com o banco de dados.
 */
export async function initDb(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Banco de dados conectado com sucesso');
  } catch (error) {
    logger.error({ err: error }, 'Erro ao conectar ao banco de dados');
    throw error;
  }
}

/**
 * Desconecta do banco de dados (útil para encerramento gracioso).
 */
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Desconectado do banco de dados');
}

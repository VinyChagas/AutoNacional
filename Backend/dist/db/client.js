"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.initDb = initDb;
exports.disconnectDb = disconnectDb;
/**
 * Cliente Prisma singleton.
 * Conecta ao PostgreSQL (Supabase) via adapter @prisma/adapter-pg.
 * Prisma 7 exige adapter ou accelerateUrl para engine type "client".
 */
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const logger_1 = require("../infrastructure/logger");
const config_1 = require("../infrastructure/config");
const logger = (0, logger_1.getLogger)('db');
const globalForPrisma = globalThis;
function createPrismaClient() {
    const connectionString = config_1.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL é obrigatória para conexão com PostgreSQL');
    }
    const adapter = new adapter_pg_1.PrismaPg({ connectionString });
    return new client_1.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development'
            ? ['error', 'warn']
            : ['error'],
    });
}
exports.prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = exports.prisma;
}
/**
 * Inicializa a conexão com o banco de dados.
 * Cliente de conexão com o banco de dados.
 */
async function initDb() {
    try {
        await exports.prisma.$connect();
        logger.info('Banco de dados conectado com sucesso');
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao conectar ao banco de dados');
        throw error;
    }
}
/**
 * Desconecta do banco de dados (útil para encerramento gracioso).
 */
async function disconnectDb() {
    await exports.prisma.$disconnect();
    logger.info('Desconectado do banco de dados');
}
//# sourceMappingURL=client.js.map
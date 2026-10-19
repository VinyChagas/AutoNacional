import express from 'express';
import cors from 'cors';
import http from 'http';
import { describeDatabaseTarget } from './config/env';
import { CORS_ORIGINS, PORT } from './infrastructure/config';
import { getLogger } from './infrastructure/logger';
import { initSocketIo } from './infrastructure/socket';
import { disconnectDb, initDb, prisma } from './db/client';
import { seedDefaultSettings } from './db/init';
import * as settingsRepo from './repositories/settings';
import {
  obterEstadoFila,
  pararFilaExecucao,
  setCertificateLoader,
} from './services/execution-service';
import {
  garantirDiretorio,
  limparDiretorioPorIdade,
} from './services/runtime-cleanup';
import {
  assertCertificateStorageReady,
  closeCertificateStorage,
  getCertificateStorageArchitectureLabel,
  getCertificateStorageDriverLabel,
} from './storage';
import { errorHandler } from './middleware/error-handler';
import settingsRouter from './routers/settings';
import configRouter from './routers/config';
import {
  empresasRouter,
  credenciaisRouter,
  certificadosRouter,
  importsRouter,
} from './modules';
import execucoesRouter from './routers/execucoes';
import validacoesRouter from './routers/validacoes';
import execucaoRouter from './routers/execucao';
import logsRouter from './routers/logs';
import contabilidadesRouter from './routers/contabilidades';
import relatoriosRouter from './routers/relatorios';
import dashboardRouter from './routers/dashboard';
import nfseRouter from './routers/nfse';
import metricsRouter from './routers/metrics';
import { carregarCertificadoPorCnpj } from './services/certificate-loader';
import { iniciarRelatorio2Captcha } from './automation/captcha-report';

if (!process.stdin.isTTY) {
  process.stdin.resume();
}

const logger = getLogger('main');
const app = express();
let cleanupTimer: NodeJS.Timeout | undefined;
let httpServer: http.Server | undefined;
let shuttingDown = false;

app.use(
  cors({
    origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : ['http://localhost:4200'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['*'],
  })
);

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health', async (_req, res) => {
  const queue = obterEstadoFila();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'ok',
      queue,
    });
  } catch (err) {
    logger.error({ err }, 'Healthcheck: PostgreSQL indisponível');
    res.status(503).json({
      status: 'degraded',
      database: 'error',
      queue,
    });
  }
});

app.use('/api/settings', settingsRouter);
app.use('/api/config', configRouter);
app.use('/api/empresas', empresasRouter);
app.use('/api/credenciais', credenciaisRouter);
app.use('/api/certificados', certificadosRouter);
app.use('/api/imports', importsRouter);
app.use('/api/execucoes', execucoesRouter);
app.use('/api/validacoes', validacoesRouter);
app.use('/api/execucao', execucaoRouter);
app.use('/api/logs', logsRouter);
app.use('/api/contabilidades', contabilidadesRouter);
app.use('/api/relatorios', relatoriosRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/nfse', nfseRouter);
app.use('/api/metrics', metricsRouter);

app.use(errorHandler);

async function bootstrap() {
  const dbTarget = describeDatabaseTarget();
  let databaseOk = false;

  try {
    await initDb();
    await seedDefaultSettings();
    databaseOk = true;
    logger.info('Database: PostgreSQL próprio conectado');
    logger.info(`Database host: ${dbTarget.host}`);
    logger.info(`Database: ${dbTarget.database}`);
  } catch (err) {
    logger.warn({ err }, 'Erro ao inicializar banco - continuando');
    logger.warn(
      `Database: falha ao conectar (host=${dbTarget.host}, database=${dbTarget.database})`
    );
  }

  let storageOk = false;
  try {
    await assertCertificateStorageReady();
    storageOk = true;
    logger.info(`Certificate Storage: ${getCertificateStorageDriverLabel()}`);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'Certificate storage inacessível — cadastro de certificados pode falhar'
    );
  }

  if (databaseOk && storageOk) {
    logger.info(`Arquitetura: ${getCertificateStorageArchitectureLabel()}`);
  }

  if (databaseOk) {
    try {
      const settings = await settingsRepo.obterConfiguracoes();
      const logsPath = settings?.logsPath ?? './logs';
      const tempPath = settings?.tempPath ?? './temp';
      const downloadsPath = settings?.downloadsBasePath ?? './downloads';
      const retentionDays = settings?.logRetentionDays ?? 30;
      await garantirDiretorio(logsPath);
      await garantirDiretorio(tempPath);
      await garantirDiretorio(downloadsPath);
      await limparDiretorioPorIdade(logsPath, retentionDays);
      await limparDiretorioPorIdade(tempPath, retentionDays);
      cleanupTimer = setInterval(() => {
        void limparDiretorioPorIdade(logsPath, retentionDays).catch((err) => {
          logger.warn({ err }, 'Falha na limpeza periódica de logs');
        });
        void limparDiretorioPorIdade(tempPath, retentionDays).catch((err) => {
          logger.warn({ err }, 'Falha na limpeza periódica de temporários');
        });
      }, 24 * 60 * 60 * 1000);
      cleanupTimer.unref();
    } catch (err) {
      logger.warn({ err }, 'Não foi possível preparar diretórios de dados');
    }
  }

  setCertificateLoader(carregarCertificadoPorCnpj);

  const reportPath = iniciarRelatorio2Captcha();
  logger.info({ reportPath }, 'Relatório 2captcha pronto para diagnóstico (chave mascarada)');

  httpServer = http.createServer(app);
  initSocketIo(httpServer);

  httpServer.listen(PORT, () => {
    logger.info(`AutoNacional API rodando em http://localhost:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Encerrando Backend');
    if (cleanupTimer) clearInterval(cleanupTimer);

    const forceExit = setTimeout(() => {
      logger.error('Encerramento excedeu o tempo limite');
      process.exit(1);
    }, 30_000);
    forceExit.unref();

    if (httpServer) {
      httpServer.close();
      httpServer.closeAllConnections?.();
    }

    try {
      await pararFilaExecucao(20_000);
    } catch (err) {
      logger.error({ err }, 'Falha ao parar a fila de execução');
    }

    await closeCertificateStorage().catch((err) => {
      logger.warn({ err }, 'Falha ao fechar storage de certificados');
    });

    try {
      await disconnectDb();
    } catch (err) {
      logger.error({ err }, 'Falha ao desconectar Prisma');
    }

    clearTimeout(forceExit);
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // Mantém o processo ativo (evita exit em alguns ambientes)
  httpServer.ref();
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Erro fatal no bootstrap');
  process.exit(1);
});

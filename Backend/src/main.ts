import express from 'express';
import cors from 'cors';
import http from 'http';
import './config/env'; // Valida env quando USE_SUPABASE=true
import { CORS_ORIGINS, PORT } from './infrastructure/config';
import { getLogger } from './infrastructure/logger';
import { initSocketIo } from './infrastructure/socket';
import { initDb } from './db/client';
import { seedDefaultSettings } from './db/init';
import { ensureCertificadosBucket } from './config/supabase';
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
import { setCertificateLoader } from './services/execution-service';
import { carregarCertificadoPorCnpj } from './services/certificate-loader';
import { iniciarRelatorio2Captcha } from './automation/captcha-report';

if (!process.stdin.isTTY) {
  process.stdin.resume();
}

const logger = getLogger('main');
const app = express();

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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'AutoNacional API está funcionando' });
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
  try {
    await initDb();
    await seedDefaultSettings();
    logger.info('Banco inicializado');
  } catch (err) {
    logger.warn({ err }, 'Erro ao inicializar banco - continuando');
  }

  try {
    await ensureCertificadosBucket();
  } catch (err) {
    logger.warn({ err }, 'Supabase Storage: bucket certificados não criado - cadastro de certificados pode falhar');
  }

  setCertificateLoader(carregarCertificadoPorCnpj);

  const reportPath = iniciarRelatorio2Captcha();
  logger.info({ reportPath }, 'Relatório 2captcha pronto para diagnóstico (chave mascarada)');

  const httpServer = http.createServer(app);
  initSocketIo(httpServer);

  httpServer.listen(PORT, () => {
    logger.info(`AutoNacional API rodando em http://localhost:${PORT}`);
  });

  // Mantém o processo ativo (evita exit em alguns ambientes)
  httpServer.ref();
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Erro fatal no bootstrap');
  process.exit(1);
});

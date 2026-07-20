"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
require("./config/env"); // Valida env quando USE_SUPABASE=true
const config_1 = require("./infrastructure/config");
const logger_1 = require("./infrastructure/logger");
const client_1 = require("./db/client");
const init_1 = require("./db/init");
const supabase_1 = require("./config/supabase");
const error_handler_1 = require("./middleware/error-handler");
const settings_1 = __importDefault(require("./routers/settings"));
const config_2 = __importDefault(require("./routers/config"));
const modules_1 = require("./modules");
const execucoes_1 = __importDefault(require("./routers/execucoes"));
const validacoes_1 = __importDefault(require("./routers/validacoes"));
const execucao_1 = __importDefault(require("./routers/execucao"));
const logs_1 = __importDefault(require("./routers/logs"));
const contabilidades_1 = __importDefault(require("./routers/contabilidades"));
const relatorios_1 = __importDefault(require("./routers/relatorios"));
const dashboard_1 = __importDefault(require("./routers/dashboard"));
const nfse_1 = __importDefault(require("./routers/nfse"));
const metrics_1 = __importDefault(require("./routers/metrics"));
const execution_service_1 = require("./services/execution-service");
const certificate_loader_1 = require("./services/certificate-loader");
const captcha_report_1 = require("./automation/captcha-report");
if (!process.stdin.isTTY) {
    process.stdin.resume();
}
const logger = (0, logger_1.getLogger)('main');
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: config_1.CORS_ORIGINS.length > 0 ? config_1.CORS_ORIGINS : ['http://localhost:4200'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['*'],
}));
app.use(express_1.default.json());
app.get('/', (_req, res) => {
    res.json({ status: 'ok' });
});
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', message: 'AutoNacional API está funcionando' });
});
app.use('/api/settings', settings_1.default);
app.use('/api/config', config_2.default);
app.use('/api/empresas', modules_1.empresasRouter);
app.use('/api/credenciais', modules_1.credenciaisRouter);
app.use('/api/certificados', modules_1.certificadosRouter);
app.use('/api/imports', modules_1.importsRouter);
app.use('/api/execucoes', execucoes_1.default);
app.use('/api/validacoes', validacoes_1.default);
app.use('/api/execucao', execucao_1.default);
app.use('/api/logs', logs_1.default);
app.use('/api/contabilidades', contabilidades_1.default);
app.use('/api/relatorios', relatorios_1.default);
app.use('/api/dashboard', dashboard_1.default);
app.use('/api/nfse', nfse_1.default);
app.use('/api/metrics', metrics_1.default);
app.use(error_handler_1.errorHandler);
async function bootstrap() {
    try {
        await (0, client_1.initDb)();
        await (0, init_1.seedDefaultSettings)();
        logger.info('Banco inicializado');
    }
    catch (err) {
        logger.warn({ err }, 'Erro ao inicializar banco - continuando');
    }
    try {
        await (0, supabase_1.ensureCertificadosBucket)();
    }
    catch (err) {
        logger.warn({ err }, 'Supabase Storage: bucket certificados não criado - cadastro de certificados pode falhar');
    }
    (0, execution_service_1.setCertificateLoader)(certificate_loader_1.carregarCertificadoPorCnpj);
    const reportPath = (0, captcha_report_1.iniciarRelatorio2Captcha)();
    logger.info({ reportPath }, 'Relatório 2captcha pronto para diagnóstico (chave mascarada)');
    const server = app.listen(config_1.PORT, () => {
        logger.info(`AutoNacional API rodando em http://localhost:${config_1.PORT}`);
    });
    // Mantém o processo ativo (evita exit em alguns ambientes)
    server.ref();
}
bootstrap().catch((err) => {
    logger.error({ err }, 'Erro fatal no bootstrap');
    process.exit(1);
});
//# sourceMappingURL=main.js.map
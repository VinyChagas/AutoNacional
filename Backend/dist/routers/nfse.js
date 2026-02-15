"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Router de NFSe - automação do portal NFSe Nacional.
 * POST /api/nfse/:cnpj/abrir - Abre dashboard autenticado com certificado A1.
 */
const express_1 = require("express");
const logger_1 = require("../infrastructure/logger");
const playwright_nfse_1 = require("../automation/playwright-nfse");
const execution_service_1 = require("../services/execution-service");
const logger = (0, logger_1.getLogger)('nfse');
const router = (0, express_1.Router)();
function limparCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
// POST /:cnpj/abrir - Abrir dashboard NFSe
router.post('/:cnpj/abrir', async (req, res) => {
    try {
        const cnpj = limparCnpj(String(req.params.cnpj ?? ''));
        if (!cnpj || cnpj.length !== 14 || !/^\d+$/.test(cnpj)) {
            res.status(400).json({
                detail: 'CNPJ inválido. Deve conter 14 dígitos.',
            });
            return;
        }
        const headless = req.query.headless === 'true' || req.body?.headless === true;
        let certificado;
        try {
            certificado = await (0, execution_service_1.obterCertificadoPorCnpj)(cnpj);
        }
        catch (e) {
            const msg = e.message;
            if (msg.includes('CertificateService não configurado')) {
                res.status(503).json({
                    detail: 'Serviço de certificados não disponível. Verifique se o CertificateService está configurado (Etapa 5.2 da migração).',
                });
                return;
            }
            throw e;
        }
        const resultado = await (0, playwright_nfse_1.abrirDashboardNfse)(certificado, {
            headless,
            timeout: 30000,
        });
        res.json({
            sucesso: resultado.sucesso,
            url_atual: resultado.url_atual,
            titulo: resultado.titulo,
            mensagem: resultado.mensagem,
            logs: resultado.logs,
        });
    }
    catch (e) {
        if (e instanceof playwright_nfse_1.NFSeAutenticacaoError) {
            logger.warn({ err: e }, 'Falha na autenticação NFSe');
            res.status(401).json({
                detail: `Falha na autenticação: ${e.message}`,
            });
            return;
        }
        if (e.message?.toLowerCase?.().includes('autenticação')) {
            res.status(401).json({
                detail: `Falha na autenticação: ${e.message}`,
            });
            return;
        }
        logger.error({ err: e }, 'Erro ao abrir dashboard NFSe');
        res.status(500).json({
            detail: `Erro inesperado ao abrir dashboard NFSe: ${e.message}`,
        });
    }
});
exports.default = router;
//# sourceMappingURL=nfse.js.map
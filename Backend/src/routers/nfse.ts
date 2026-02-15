/**
 * Router de NFSe - automação do portal NFSe Nacional.
 * POST /api/nfse/:cnpj/abrir - Abre dashboard autenticado com certificado A1.
 */
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import { abrirDashboardNfse, NFSeAutenticacaoError } from '../automation/playwright-nfse';
import { obterCertificadoPorCnpj } from '../services/execution-service';

const logger = getLogger('nfse');
const router = Router();

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

// POST /:cnpj/abrir - Abrir dashboard NFSe
router.post('/:cnpj/abrir', async (req: Request, res: Response) => {
  try {
    const cnpj = limparCnpj(String(req.params.cnpj ?? ''));
    if (!cnpj || cnpj.length !== 14 || !/^\d+$/.test(cnpj)) {
      res.status(400).json({
        detail: 'CNPJ inválido. Deve conter 14 dígitos.',
      });
      return;
    }

    const headless =
      req.query.headless === 'true' || req.body?.headless === true;

    let certificado;
    try {
      certificado = await obterCertificadoPorCnpj(cnpj);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('CertificateService não configurado')) {
        res.status(503).json({
          detail:
            'Serviço de certificados não disponível. Verifique se o CertificateService está configurado (Etapa 5.2 da migração).',
        });
        return;
      }
      throw e;
    }

    const resultado = await abrirDashboardNfse(certificado, {
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
  } catch (e) {
    if (e instanceof NFSeAutenticacaoError) {
      logger.warn({ err: e }, 'Falha na autenticação NFSe');
      res.status(401).json({
        detail: `Falha na autenticação: ${e.message}`,
      });
      return;
    }
    if (
      (e as Error).message?.toLowerCase?.().includes('autenticação')
    ) {
      res.status(401).json({
        detail: `Falha na autenticação: ${(e as Error).message}`,
      });
      return;
    }
    logger.error({ err: e }, 'Erro ao abrir dashboard NFSe');
    res.status(500).json({
      detail: `Erro inesperado ao abrir dashboard NFSe: ${(e as Error).message}`,
    });
  }
});

export default router;

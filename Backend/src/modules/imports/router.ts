/**
 * Router do módulo Imports (Preview + Confirmar).
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler';
import { uploadArray, uploadSingle } from '../../middleware/upload';
import * as controller from './imports.controller';

const router = Router();

// Certificados em lote
router.post(
  '/certificados/preview',
  uploadArray('files', 50),
  asyncHandler(controller.previewCertificados)
);
router.post(
  '/certificados/confirmar',
  asyncHandler(controller.confirmarCertificados)
);

// Credenciais via planilha
router.post(
  '/credenciais/preview',
  uploadSingle('arquivo'),
  asyncHandler(controller.previewCredenciais)
);
router.post(
  '/credenciais/confirmar',
  asyncHandler(controller.confirmarCredenciais)
);

router.get('/health', (_req, res) => {
  res.json({ success: true, module: 'imports' });
});

export default router;

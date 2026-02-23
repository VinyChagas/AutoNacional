/**
 * Rotas de empresas.
 * Ordem: rotas específicas antes de /:id para evitar conflitos.
 */
import { Router } from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { uploadSingle } from '../../../middleware/upload';
import * as controller from './empresas.controller';

const router = Router();

router.get('/', asyncHandler(controller.listar));
router.get('/summary', asyncHandler(controller.summary));
router.delete('/', asyncHandler(controller.excluirEmMassa));
router.get('/contabilidade/:contabilidade_id', asyncHandler(controller.listarPorContabilidade));
router.get('/cnpj/:cnpj', asyncHandler(controller.obterPorCnpj));
router.post('/cadastro/certificado', uploadSingle('file'), asyncHandler(controller.cadastroCertificado));
router.post('/cadastro/credencial', asyncHandler(controller.cadastroCredencial));
router.get('/:id', asyncHandler(controller.obterPorId));

export default router;

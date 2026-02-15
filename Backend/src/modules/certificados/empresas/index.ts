/**
 * Módulo Empresas - CRUD e listagem com agregados.
 */
import { Router } from 'express';
import empresasRoutes from './empresas.routes';
import empresasRouterLegacy from '../../../routers/empresas';

const router = Router();
router.use(empresasRoutes);
router.use(empresasRouterLegacy);

export { router as empresasRouter };

/**
 * Router para logs de execução.
 *
 * POST /api/logs/execucoes/salvar
 * Persiste log de lote no Supabase (execucao_log_batch + execucao_log_item).
 *
 * Exemplo curl:
 * curl -X POST http://localhost:8000/api/logs/execucoes/salvar \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "batch_id": "550e8400-e29b-41d4-a716-446655440000",
 *     "contabilidade_id": "1",
 *     "competencia": "2025-02",
 *     "dataInicio": "2025-02-01",
 *     "dataFim": "2025-02-28",
 *     "tipo": "ambas",
 *     "headless": false,
 *     "totais": {
 *       "total_empresas": 2,
 *       "total_sucesso": 1,
 *       "total_falha": 1,
 *       "total_emitidas": 10,
 *       "total_recebidas": 5,
 *       "totais_por_resultado": { "NFS_ENCONTRADAS": 1, "SEM_MOVIMENTO": 1 }
 *     },
 *     "itens": [
 *       {
 *         "empresa_id": "123",
 *         "cnpj": "12345678000199",
 *         "nome_empresa": "Empresa Exemplo",
 *         "tipo_autenticacao": "certificado",
 *         "status_final": "finalizado",
 *         "qtd_emitidas": 5,
 *         "qtd_recebidas": 3,
 *         "resultado_final": "NFS_ENCONTRADAS"
 *       }
 *     ]
 *   }'
 *
 * Respostas:
 * - 201: { success: true, batch_log_id: 1, saved: true }
 * - 400: { detail: "mensagem de validação" }
 * - 409: { detail: "Log já existe para este batch_id" }
 * - 500: { detail: "Erro ao salvar log de execuções" }
 */
import { Router } from 'express';
import { salvarLogExecucoes } from '../controllers/logs.controller';

const router = Router();

router.post('/execucoes/salvar', salvarLogExecucoes);

export default router;

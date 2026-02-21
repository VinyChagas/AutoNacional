-- ============================================================================
-- Migration: automation_execution_metrics
-- Tabelas para persistir métricas de execução (alimentar Painel de Rentabilidade)
-- Execute no Supabase SQL Editor
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: automation_execution_batches
-- Representa 1 disparo de execução (quando usuário clica "Iniciar")
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_execution_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia TEXT NOT NULL,
  contabilidade_id INTEGER NULL,
  total_empresas INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE automation_execution_batches IS 'Lotes de execução (1 por clique em Iniciar)';
COMMENT ON COLUMN automation_execution_batches.competencia IS 'Formato YYYY-MM (ex: 2026-01)';
COMMENT ON COLUMN automation_execution_batches.status IS 'RUNNING | FINISHED';

-- ----------------------------------------------------------------------------
-- Tabela: automation_executions
-- Execução consolidada de 1 empresa dentro de um batch
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES automation_execution_batches(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL,
  empresa_cnpj TEXT NOT NULL,
  contabilidade_id INTEGER NULL,
  competencia TEXT NOT NULL,
  status TEXT NOT NULL,
  login_metodo TEXT NULL,
  qtd_emitidas INTEGER NOT NULL DEFAULT 0,
  qtd_recebidas INTEGER NOT NULL DEFAULT 0,
  qtd_canceladas INTEGER NOT NULL DEFAULT 0,
  tempo_execucao_segundos INTEGER NOT NULL DEFAULT 0,
  erro_resumo TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT automation_executions_batch_empresa_unique UNIQUE (batch_id, empresa_id)
);

COMMENT ON TABLE automation_executions IS 'Execuções por empresa (OK ou ERRO)';
COMMENT ON COLUMN automation_executions.status IS 'OK | ERRO';
COMMENT ON COLUMN automation_executions.login_metodo IS 'CERTIFICADO | CREDENCIAL';

-- ----------------------------------------------------------------------------
-- Índices
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_automation_executions_competencia
  ON automation_executions (competencia);

CREATE INDEX IF NOT EXISTS idx_automation_executions_contabilidade_competencia
  ON automation_executions (contabilidade_id, competencia);

CREATE INDEX IF NOT EXISTS idx_automation_executions_status_competencia
  ON automation_executions (status, competencia);

CREATE INDEX IF NOT EXISTS idx_automation_executions_batch_id
  ON automation_executions (batch_id);

-- ----------------------------------------------------------------------------
-- RLS (Row Level Security)
-- ----------------------------------------------------------------------------
ALTER TABLE automation_execution_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_executions ENABLE ROW LEVEL SECURITY;

-- Policy: leitura para usuários autenticados (opcional - painel usa backend)
CREATE POLICY "allow_authenticated_read_batches"
  ON automation_execution_batches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "allow_authenticated_read_executions"
  ON automation_executions FOR SELECT
  TO authenticated
  USING (true);

-- O backend usa service_role e bypassa RLS para INSERT/UPDATE
-- Não criamos policy de INSERT/UPDATE para role anon/authenticated (apenas service_role)

-- ----------------------------------------------------------------------------
-- VIEW: billing_monthly_summary
-- Agregação mensal para consulta simplificada
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW billing_monthly_summary AS
SELECT
  competencia,
  contabilidade_id,
  COUNT(*)::INTEGER AS empresas_processadas_total,
  COUNT(*) FILTER (WHERE status = 'OK')::INTEGER AS empresas_ok,
  COUNT(*) FILTER (WHERE status = 'ERRO')::INTEGER AS empresas_erro,
  COALESCE(SUM(qtd_emitidas), 0)::INTEGER AS nf_emitidas,
  COALESCE(SUM(qtd_recebidas), 0)::INTEGER AS nf_recebidas,
  COALESCE(SUM(qtd_canceladas), 0)::INTEGER AS nf_canceladas,
  (COALESCE(SUM(qtd_emitidas), 0) + COALESCE(SUM(qtd_recebidas), 0))::INTEGER AS total_notas,
  COALESCE(SUM(tempo_execucao_segundos), 0)::INTEGER AS tempo_total_segundos,
  CASE
    WHEN COUNT(*) > 0 AND SUM(tempo_execucao_segundos) > 0
    THEN ROUND(
      (SUM(tempo_execucao_segundos)::NUMERIC / COUNT(*)), 2
    )
    ELSE NULL
  END AS tempo_medio_por_empresa_segundos
FROM automation_executions
GROUP BY competencia, contabilidade_id;

COMMENT ON VIEW billing_monthly_summary IS 'Resumo mensal agregado para billing (Painel de Rentabilidade)';

/**
 * API-02W — relógio monotônico e serialização de métricas operacionais.
 */
import { describe, expect, it } from 'vitest';
import {
  CronometroMonotonico,
  agoraMonotonicoMs,
  deltaMonotonicoMs,
  metricasOperacionaisVazias,
  serializarMetricasOperacionais,
} from './metricas-operacionais';

describe('metricas-operacionais', () => {
  it('agoraMonotonicoMs é monotônico não-negativo', () => {
    const a = agoraMonotonicoMs();
    const b = agoraMonotonicoMs();
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it('deltaMonotonicoMs não retorna negativo', () => {
    expect(deltaMonotonicoMs(100, 90)).toBe(0);
    expect(deltaMonotonicoMs(10, 25)).toBe(15);
  });

  it('CronometroMonotonico mede entre marcas', async () => {
    const c = new CronometroMonotonico();
    c.marcar('a');
    await new Promise((r) => setTimeout(r, 20));
    c.marcar('b');
    const d = c.entre('a', 'b');
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThanOrEqual(10);
    expect(c.entre('a', 'inexistente')).toBeNull();
    expect(c.totalAteAgora()).toBeGreaterThanOrEqual(10);
  });

  it('serializarMetricasOperacionais distingue notas descobertas de XMLs', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.notasDescobertas = 12;
    m.contadores.xmlsPersistidos = 10;
    m.contadores.xmlsExportados = 8;
    m.contadores.xmlsJaExistentes = 2;
    m.duracoes.duracaoTotalMs = 258000;
    const s = serializarMetricasOperacionais(m)!;
    expect(s.notas_descobertas).toBe(12);
    expect(s.xmls_persistidos).toBe(10);
    expect(s.xmls_exportados).toBe(8);
    expect(s.xmls_ja_existentes).toBe(2);
    expect(s.duracao_total_ms).toBe(258000);
    expect(s.chromium_ms).toBeNull();
  });

  it('serializarMetricasOperacionais retorna null se ausente', () => {
    expect(serializarMetricasOperacionais(null)).toBeNull();
    expect(serializarMetricasOperacionais(undefined)).toBeNull();
  });

  it('métricas vazias não inventam zeros nos contadores', () => {
    const m = metricasOperacionaisVazias();
    expect(m.contadores.notasDescobertas).toBeNull();
    expect(m.contadores.xmlsPersistidos).toBeNull();
    expect(m.duracoes.descobertaEmitidasMs).toBeNull();
  });
});

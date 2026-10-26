import {
  formatarDuracaoMs,
  formatarMetricaNumero,
  xmlsDisponiveisDownloads,
} from './metricas-operacionais.model';

describe('metricas-operacionais (API-02W)', () => {
  it('formatarDuracaoMs — null/ausente → —', () => {
    expect(formatarDuracaoMs(null)).toBe('—');
    expect(formatarDuracaoMs(undefined)).toBe('—');
  });

  it('formatarDuracaoMs — segundos e minutos', () => {
    expect(formatarDuracaoMs(45000)).toBe('45s');
    expect(formatarDuracaoMs(258000)).toBe('4m 18s');
    expect(formatarDuracaoMs(120000)).toBe('2m');
  });

  it('formatarMetricaNumero — null → —; zero medido → 0', () => {
    expect(formatarMetricaNumero(null)).toBe('—');
    expect(formatarMetricaNumero(0)).toBe('0');
    expect(formatarMetricaNumero(12)).toBe('12');
  });

  it('xmlsDisponiveisDownloads soma exportados + já existentes', () => {
    expect(xmlsDisponiveisDownloads(null)).toBeNull();
    expect(xmlsDisponiveisDownloads({})).toBeNull();
    expect(
      xmlsDisponiveisDownloads({ xmls_exportados: 8, xmls_ja_existentes: 2 })
    ).toBe(10);
    expect(xmlsDisponiveisDownloads({ xmls_exportados: 3 })).toBe(3);
  });
});

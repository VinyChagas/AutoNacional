/**
 * API-03L — diagnóstico estruturado de INDETERMINADA + data-situacao na TD.
 * Reproduz o gap observado na CRASA (diagnosticos:0 / bloqueio sem chave nos logs).
 */
import { describe, expect, it } from 'vitest';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import { interpretarHtmlTabela, registroDaLinha } from '../discovery/row-parser';
import { fecharDescoberta } from '../discovery/discovery-validation';
import {
  CODIGO_DIAGNOSTICO_INDETERMINADA,
  inferirNumeroNotaDosTextos,
  montarDiagnosticoNotaIndeterminada,
  motivoBloqueioIndeterminada,
} from './diagnostico-indeterminada';
import { classificarSituacao } from './situacao';

const CHAVE = '35503081221063590000171000000000023826080259038744';
const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');
const CNPJ = '21063590000171';

describe('API-03L — diagnóstico definitivo INDETERMINADA', () => {
  it('data-situacao na TD (não no TR) é capturado pelo parser', () => {
    const html = `
      <table><tbody>
        <tr data-chave="${CHAVE}">
          <td>238</td>
          <td class="td-situacao" data-situacao="P102_NFSE_DECISAO_JUDICIAL_GERADA">
            <img src="/EmissorNacional/img/tb-nota-bypass.svg"
                 alt="NFS-e emitida via decisão administrativa/judicial"
                 data-original-title="NFS-e emitida via decisão administrativa/judicial">
          </td>
          <td><a href="/EmissorNacional/Notas/Download/NFSe/${CHAVE}">XML</a></td>
        </tr>
      </tbody></table>`;
    const linha = interpretarHtmlTabela(html)[0];
    expect(linha.evidenciaSituacao.dataSituacao).toBe('P102_NFSE_DECISAO_JUDICIAL_GERADA');
    expect(classificarSituacao(linha.evidenciaSituacao).situacao).toBe('VIGENTE');
  });

  it('data-situacao só no descendente da linha (sem classe situacao) ainda é lido', () => {
    const html = `
      <table><tbody>
        <tr data-chave="${CHAVE}">
          <td>238</td>
          <td><span data-situacao="P100_GERADA"><img src="/EmissorNacional/img/tb-gerada.svg" title="NFS-e Gerada"></span></td>
          <td><a href="/EmissorNacional/Notas/Download/NFSe/${CHAVE}">XML</a></td>
        </tr>
      </tbody></table>`;
    const linha = interpretarHtmlTabela(html)[0];
    expect(linha.evidenciaSituacao.dataSituacao).toBe('P100_GERADA');
    expect(classificarSituacao(linha.evidenciaSituacao).situacao).toBe('VIGENTE');
  });

  it('sem evidência: diagnostico SEM_EVIDENCIA_SITUACAO com chave e número', () => {
    const evidencia = {
      dataSituacao: null,
      textoColuna: null,
      classeColuna: null,
      icones: [] as const,
    };
    const classificacao = classificarSituacao(evidencia);
    expect(classificacao.situacao).toBe('INDETERMINADA');
    const { regraAplicada, motivoBloqueio } = motivoBloqueioIndeterminada(classificacao, evidencia);
    expect(regraAplicada).toBe('SEM_EVIDENCIA_SITUACAO');
    expect(motivoBloqueio).toMatch(/Nenhuma evidência/i);

    const diag = montarDiagnosticoNotaIndeterminada({
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      chaveNacional: CHAVE,
      numeroNota: '238',
      direcao: 'EMITIDA',
      pagina: 1,
      linha: 0,
      evidencia,
      classificacao,
    });
    expect(diag.codigo).toBe(CODIGO_DIAGNOSTICO_INDETERMINADA);
    expect(diag.chaveNacional).toBe(CHAVE);
    expect(diag.numeroNota).toBe('238');
    expect(diag.empresaCnpj).toBe(CNPJ);
    expect(diag.regraAplicada).toBe('SEM_EVIDENCIA_SITUACAO');
  });

  it('ícone não reconhecido sem código → EVIDENCIA_NAO_RECONHECIDA', () => {
    const evidencia = {
      dataSituacao: null,
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [
        {
          src: '/EmissorNacional/img/tb-status-x.svg',
          alt: 'status',
          title: null,
          dataOriginalTitle: null,
          ariaLabel: null,
        },
      ],
    };
    const classificacao = classificarSituacao(evidencia);
    expect(classificacao.situacao).toBe('INDETERMINADA');
    expect(motivoBloqueioIndeterminada(classificacao, evidencia).regraAplicada).toBe(
      'EVIDENCIA_NAO_RECONHECIDA'
    );
  });

  it('fecharDescoberta emite SITUACAO_INDETERMINADA (não fica diagnosticos:0)', () => {
    const html = `
      <table><tbody>
        <tr data-chave="${CHAVE}">
          <td>238</td>
          <td class="td-situacao"></td>
          <td><a href="/EmissorNacional/Notas/Download/NFSe/${CHAVE}">XML</a></td>
        </tr>
      </tbody></table>`;
    const registro = registroDaLinha(interpretarHtmlTabela(html)[0], 'EMITIDA');
    expect(inferirNumeroNotaDosTextos(registro.textosCelulas)).toBe('238');

    const resultado = fecharDescoberta({
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
      status: 'DISCOVERY_COMPLETE',
      registros: [registro],
      diagnosticos: [],
      paginasPercorridas: 1,
    });
    expect(resultado.inventario.totais.indeterminadas).toBe(1);
    expect(resultado.diagnosticos.some((d) => d.codigo === CODIGO_DIAGNOSTICO_INDETERMINADA)).toBe(
      true
    );
    const diag = resultado.diagnosticos.find((d) => d.codigo === CODIGO_DIAGNOSTICO_INDETERMINADA);
    expect(diag?.chaveNacional).toBe(CHAVE);
    expect(diag?.mensagem).toMatch(/SEM_EVIDENCIA_SITUACAO|Nenhuma evidência/i);
  });

  it('fluxo captura→parser→classificação→inventário: P102 na TD + bypass → VIGENTE na meta', () => {
    const html = `
      <table><tbody>
        <tr data-chave="${CHAVE}">
          <td>238</td>
          <td class="td-situacao" data-situacao="P102_NFSE_DECISAO_JUDICIAL_GERADA">
            <img src="/EmissorNacional/img/tb-nota-bypass.svg"
                 alt="NFS-e emitida via decisão administrativa/judicial">
          </td>
          <td><a href="/EmissorNacional/Notas/Download/NFSe/${CHAVE}">XML</a></td>
        </tr>
      </tbody></table>`;
    const registro = registroDaLinha(interpretarHtmlTabela(html)[0], 'EMITIDA');
    const resultado = fecharDescoberta({
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
      status: 'DISCOVERY_COMPLETE',
      registros: [registro],
      diagnosticos: [],
      paginasPercorridas: 1,
    });
    expect(resultado.inventario.totais.vigentes).toBe(1);
    expect(resultado.inventario.totais.indeterminadas).toBe(0);
    expect(resultado.diagnosticos.filter((d) => d.codigo === CODIGO_DIAGNOSTICO_INDETERMINADA)).toHaveLength(
      0
    );
  });
});

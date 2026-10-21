import { describe, expect, it } from 'vitest';
import { bloqueiaProcessamentoAutomatico, entraNaRecuperacaoSefin } from '../contracts/documento-fiscal';
import { montarInventario } from '../contracts/inventario';
import { criarCompetenciaFiscalXml, criarPeriodoConsultaPortal } from '../contracts/periodo';
import { montarPlanoRecuperacao } from '../contracts/recuperacao';
import { executarDescoberta } from '../discovery/discovery-runner';
import { comFingerprint } from '../discovery/pagination';
import { interpretarHtmlTabela } from '../discovery/row-parser';
import type { DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import type { LeituraFiltroPortal, LinhaListagem, PaginaListagem, PortalListagem } from '../discovery/types';
import {
  CODIGO_DATA_SITUACAO_CANCELADA,
  CODIGO_DATA_SITUACAO_GERADA,
  CODIGO_SITUACAO_DESCONHECIDO,
  CODIGOS_DATA_SITUACAO_VIGENTE,
  CONFLITO_SITUACAO,
  classificarSituacao,
  documentoClassificado,
  type EvidenciaColunaSituacao,
  type IconeColunaSituacao,
} from './situacao';

const CNPJ = '12345678000199';
const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');

function chave(final: number): string {
  return String(final).padStart(50, '7');
}

function icone(parcial: Partial<IconeColunaSituacao>): IconeColunaSituacao {
  return { src: null, title: null, dataOriginalTitle: null, alt: null, ariaLabel: null, ...parcial };
}

function evidencia(parcial: Partial<EvidenciaColunaSituacao> = {}): EvidenciaColunaSituacao {
  return { dataSituacao: null, textoColuna: null, classeColuna: 'td-situacao', icones: [], ...parcial };
}

const GERADA = evidencia({
  icones: [icone({ src: '/EmissorNacional/img/tb-gerada.svg', title: 'NFS-e Gerada' })],
});
const CANCELADA = evidencia({
  dataSituacao: CODIGO_DATA_SITUACAO_CANCELADA,
  icones: [
    icone({
      src: '/EmissorNacional/img/tb-cancelada.svg',
      title: 'NFS-e cancelada',
      dataOriginalTitle: 'NFS-e cancelada',
    }),
  ],
});

function classificar(parcial: Partial<EvidenciaColunaSituacao>) {
  return classificarSituacao(evidencia(parcial));
}

describe('classificação da coluna Situação', () => {
  it('classifica P104_NFSE_CANCELADA como cancelada', () => {
    const resultado = classificar({ dataSituacao: 'P104_NFSE_CANCELADA' });
    expect(resultado.situacao).toBe('CANCELADA');
    expect(resultado.fonte).toBe('tr.data-situacao');
    expect(resultado.evidenciaDeterminante).toBe('data-situacao=P104_NFSE_CANCELADA');
  });

  it('classifica P100_GERADA como vigente (código observado no Portal)', () => {
    expect(CODIGOS_DATA_SITUACAO_VIGENTE).toContain(CODIGO_DATA_SITUACAO_GERADA);
    const resultado = classificar({ dataSituacao: CODIGO_DATA_SITUACAO_GERADA });
    expect(resultado.situacao).toBe('VIGENTE');
    expect(resultado.fonte).toBe('tr.data-situacao');
    expect(resultado.evidenciaDeterminante).toBe(`data-situacao=${CODIGO_DATA_SITUACAO_GERADA}`);
    expect(resultado.codigoSituacaoDesconhecido).toBeNull();
    expect(entraNaRecuperacaoSefin(
      documentoClassificado({
        chaveNacional: chave(100),
        cnpj: CNPJ,
        direcao: 'EMITIDA',
        periodoConsulta: PERIODO,
        evidencia: evidencia({ dataSituacao: CODIGO_DATA_SITUACAO_GERADA }),
      })
    )).toBe(true);
  });

  it('não trata código data-situacao desconhecido como vigente automaticamente', () => {
    const resultado = classificar({
      dataSituacao: 'P999_NAO_OBSERVADO',
      icones: GERADA.icones,
    });
    expect(resultado.situacao).toBe('INDETERMINADA');
    expect(resultado.codigoSituacaoDesconhecido).toBe('P999_NAO_OBSERVADO');
  });

  it('classifica o ícone tb-cancelada.svg como cancelada', () => {
    const resultado = classificar({
      icones: [icone({ src: '/EmissorNacional/img/tb-cancelada.svg' })],
    });
    expect(resultado.situacao).toBe('CANCELADA');
    expect(resultado.fonte).toBe('icone.situacao');
    expect(resultado.evidenciaDeterminante).toContain('tb-cancelada.svg');
  });

  it('classifica o title NFS-e cancelada como cancelada', () => {
    const resultado = classificar({ icones: [icone({ title: 'NFS-e cancelada' })] });
    expect(resultado.situacao).toBe('CANCELADA');
    expect(resultado.evidenciaDeterminante).toBe('td-situacao.img.title=NFS-e cancelada');
  });

  it('classifica data-original-title NFS-e cancelada como cancelada', () => {
    const resultado = classificar({
      icones: [icone({ dataOriginalTitle: 'NFS-e cancelada' })],
    });
    expect(resultado.situacao).toBe('CANCELADA');
    expect(resultado.evidenciaDeterminante).toBe('td-situacao.img.data-original-title=NFS-e cancelada');
  });

  it('classifica tb-gerada.svg como vigente', () => {
    const resultado = classificar({
      icones: [icone({ src: '/EmissorNacional/img/tb-gerada.svg' })],
    });
    expect(resultado.situacao).toBe('VIGENTE');
    expect(resultado.fonte).toBe('icone.situacao');
  });

  it('classifica NFS-e Gerada como vigente', () => {
    const resultado = classificar({ icones: [icone({ title: 'NFS-e Gerada' })] });
    expect(resultado.situacao).toBe('VIGENTE');
    expect(resultado.evidenciaDeterminante).toBe('td-situacao.img.title=NFS-e Gerada');
  });

  it('classifica NFS-e emitida como vigente', () => {
    const resultado = classificar({ textoColuna: 'NFS-e emitida' });
    expect(resultado.situacao).toBe('VIGENTE');
    expect(resultado.fonte).toBe('td.td-situacao');
  });

  it('mantém texto de situação desconhecido como indeterminada', () => {
    const resultado = classificar({ textoColuna: 'Situação não mapeada' });
    expect(resultado.situacao).toBe('INDETERMINADA');
    expect(resultado.fonte).toBe('nao_identificada');
  });

  it('mantém coluna sem evidência como indeterminada', () => {
    const resultado = classificarSituacao(evidencia({ classeColuna: null }));
    expect(resultado.situacao).toBe('INDETERMINADA');
    expect(resultado.evidencias).toContain('nenhuma evidência de situação na coluna Situação');
  });

  it('marca conflito quando a coluna traz cancelamento e emissão atuais', () => {
    const resultado = classificar({
      textoColuna: 'NFS-e emitida',
      icones: [icone({ src: '/EmissorNacional/img/tb-cancelada.svg', title: 'NFS-e cancelada' })],
    });
    expect(resultado.situacao).toBe('INDETERMINADA');
    expect(resultado.conflitos).toEqual([CONFLITO_SITUACAO]);
  });

  it('classifica como cancelada quando há histórico de emissão', () => {
    const resultado = classificar({
      dataSituacao: 'P104_NFSE_CANCELADA',
      icones: [
        icone({ src: '/EmissorNacional/img/tb-cancelada.svg', title: 'NFS-e cancelada' }),
        icone({ src: '/EmissorNacional/img/tb-gerada.svg', title: 'NFS-e Gerada' }),
      ],
    });
    expect(resultado.situacao).toBe('CANCELADA');
    expect(resultado.conflitos).toEqual([]);
    expect(resultado.evidencias.some((item) => item.startsWith('historico-emissao='))).toBe(true);
  });

  it('não trata o botão Cancelar como cancelamento de nota vigente', () => {
    const html = `
      <table><tbody>
        <tr>
          <td class="td-situacao"><img src="/EmissorNacional/img/tb-gerada.svg" title="NFS-e Gerada" /></td>
          <td class="td-acoes"><img title="Cancelar" alt="Cancelar" aria-label="Cancelar nota" /></td>
          <td><a href="/EmissorNacional/Notas/Download/NFSe/${chave(12)}">Download XML</a></td>
        </tr>
      </tbody></table>`;
    const resultado = classificarSituacao(interpretarHtmlTabela(html)[0].evidenciaSituacao);
    expect(resultado.situacao).toBe('VIGENTE');
    expect(JSON.stringify(resultado.evidencias)).not.toContain('Cancelar');
  });

  it('não deixa o botão Cancelar alterar uma nota cancelada', () => {
    const html = `
      <table><tbody>
        <tr data-situacao="P104_NFSE_CANCELADA">
          <td class="td-situacao">
            <img src="/EmissorNacional/img/tb-cancelada.svg" title="NFS-e cancelada" />
          </td>
          <td class="td-acoes"><img title="Cancelar" alt="Cancelar" /></td>
          <td><a href="/EmissorNacional/Notas/Download/NFSe/${chave(13)}">Download XML</a></td>
        </tr>
      </tbody></table>`;
    const linha = interpretarHtmlTabela(html)[0];
    const resultado = classificarSituacao(linha.evidenciaSituacao);
    expect(resultado.situacao).toBe('CANCELADA');
    expect(resultado.fonte).toBe('tr.data-situacao');
    expect(JSON.stringify(linha.evidenciaSituacao)).not.toContain('Cancelar');
  });

  it('ignora ícones do menu de ações', () => {
    const html = `
      <table><tbody>
        <tr>
          <td class="td-situacao"><img src="/EmissorNacional/img/tb-gerada.svg" title="NFS-e Gerada" /></td>
          <td class="menu-acoes"><img src="/img/acoes/cancelar.png" title="Cancelar" /></td>
        </tr>
      </tbody></table>`;
    const resultado = classificarSituacao(interpretarHtmlTabela(html)[0].evidenciaSituacao);
    expect(resultado.situacao).toBe('VIGENTE');
    expect(resultado.evidencias.join(' ')).not.toContain('cancelar.png');
  });

  it('classifica cancelada em emitidas e recebidas sem mudar a direção', () => {
    for (const direcao of ['EMITIDA', 'RECEBIDA'] as const) {
      const documento = documentoClassificado({
        chaveNacional: chave(direcao === 'EMITIDA' ? 15 : 16),
        cnpj: CNPJ,
        direcao,
        periodoConsulta: PERIODO,
        evidencia: CANCELADA,
      });
      expect(documento.situacao).toBe('CANCELADA');
      expect(documento.direcao).toBe(direcao);
    }
  });

  it('classifica indeterminada em emitidas e recebidas sem mudar a direção', () => {
    for (const direcao of ['EMITIDA', 'RECEBIDA'] as const) {
      const documento = documentoClassificado({
        chaveNacional: chave(direcao === 'EMITIDA' ? 17 : 18),
        cnpj: CNPJ,
        direcao,
        periodoConsulta: PERIODO,
        evidencia: evidencia(),
      });
      expect(documento.situacao).toBe('INDETERMINADA');
      expect(documento.direcao).toBe(direcao);
      expect(bloqueiaProcessamentoAutomatico(documento)).toBe(true);
    }
  });

  it('preserva chave, direção, período e competência informativa', () => {
    const documento = documentoClassificado({
      chaveNacional: chave(23),
      cnpj: CNPJ,
      direcao: 'RECEBIDA',
      periodoConsulta: PERIODO,
      competenciaFiscalXml: criarCompetenciaFiscalXml('2025-11'),
      evidencia: GERADA,
    });
    expect(documento.chaveNacional).toBe(chave(23));
    expect(documento.direcao).toBe('RECEBIDA');
    expect(documento.periodoConsulta).toEqual(PERIODO);
    expect(documento.competenciaFiscalXml?.dCompet).toBe('2025-11');
    expect(documento.situacao).toBe('VIGENTE');
    expect(entraNaRecuperacaoSefin(documento)).toBe(true);
  });

  it('bloqueia a recuperação da indeterminada e deixa a cancelada fora da fila', () => {
    const inventario = montarInventario({
      id: 'plano-classificacao',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [
        documentoClassificado({
          chaveNacional: chave(27),
          cnpj: CNPJ,
          direcao: 'EMITIDA',
          periodoConsulta: PERIODO,
          evidencia: evidencia(),
        }),
        documentoClassificado({
          chaveNacional: chave(28),
          cnpj: CNPJ,
          direcao: 'EMITIDA',
          periodoConsulta: PERIODO,
          evidencia: CANCELADA,
        }),
        documentoClassificado({
          chaveNacional: chave(29),
          cnpj: CNPJ,
          direcao: 'RECEBIDA',
          periodoConsulta: PERIODO,
          evidencia: GERADA,
        }),
      ],
    });
    const plano = montarPlanoRecuperacao(inventario);
    expect(plano.map((item) => item.chaveNacional)).toEqual([chave(27), chave(29)]);
    expect(plano.find((item) => item.chaveNacional === chave(27))?.resultado).toBe('BLOQUEADO');
    expect(plano.find((item) => item.chaveNacional === chave(28))).toBeUndefined();
    expect(plano.find((item) => item.chaveNacional === chave(29))?.resultado).toBe('PENDENTE');
    expect(inventario.totais).toMatchObject({
      descobertos: 3,
      vigentes: 1,
      canceladas: 1,
      indeterminadas: 1,
    });
    expect(inventario.totais.descobertos).toBe(
      inventario.totais.vigentes + inventario.totais.canceladas + inventario.totais.indeterminadas
    );
  });

  it('não promove código data-situacao desconhecido a vigente por causa do ícone', () => {
    const resultado = classificar({
      dataSituacao: 'P999_NAO_OBSERVADO',
      icones: [icone({ src: '/EmissorNacional/img/tb-gerada.svg', title: 'NFS-e Gerada' })],
    });
    expect(resultado.situacao).toBe('INDETERMINADA');
    expect(resultado.codigoSituacaoDesconhecido).toBe('P999_NAO_OBSERVADO');
    expect(resultado.fonte).toBe('tr.data-situacao');
  });

  it('distingue histórico de emissão do estado fiscal atual', () => {
    const historico = classificar({
      icones: [
        icone({ src: '/EmissorNacional/img/tb-cancelada.svg' }),
        icone({ title: 'NFS-e Gerada' }),
      ],
    });
    const estadoAtual = classificar({
      textoColuna: 'NFS-e emitida',
      icones: [icone({ src: '/EmissorNacional/img/tb-cancelada.svg' })],
    });
    expect(historico.situacao).toBe('CANCELADA');
    expect(historico.conflitos).toEqual([]);
    expect(estadoAtual.situacao).toBe('INDETERMINADA');
    expect(estadoAtual.conflitos).toEqual([CONFLITO_SITUACAO]);
  });
});

function urlComPesquisa(direcao: DirecaoDocumentoFiscal): string {
  const lista = direcao === 'EMITIDA' ? 'Emitidas' : 'Recebidas';
  const params = new URLSearchParams({
    executar: '1',
    busca: '',
    datainicio: PERIODO.inicio,
    datafim: PERIODO.fim,
  });
  return `https://www.nfse.gov.br/EmissorNacional/Notas/${lista}?${params.toString()}`;
}

function leituraDe(direcao: DirecaoDocumentoFiscal): LeituraFiltroPortal {
  return {
    url: urlComPesquisa(direcao),
    dataInicio: PERIODO.inicio,
    dataFim: PERIODO.fim,
    semRegistros: false,
    quantidadeLinhas: 1,
    temTabela: true,
  };
}

function paginaDe(linhas: LinhaListagem[]): PaginaListagem {
  return comFingerprint({
    url: urlComPesquisa('EMITIDA'),
    paginaIndicador: 1,
    totalizador: null,
    semRegistros: false,
    proxima: { presente: false, desabilitado: true },
    linhas,
  });
}

function linhaDe(final: number, evidenciaSituacao: EvidenciaColunaSituacao, linha = 0): LinhaListagem {
  return {
    pagina: 1,
    linha,
    hrefs: final > 0 ? [`/EmissorNacional/Notas/Download/NFSe/${chave(final)}`] : [],
    dataChave: null,
    textos: ['servico'],
    evidenciaSituacao,
  };
}

async function descobrir(linhas: LinhaListagem[]) {
  const portal: PortalListagem = {
    async abrir() {
      return undefined;
    },
    async aplicarPeriodo(_periodo, direcao) {
      return leituraDe(direcao);
    },
    async capturar() {
      return paginaDe(linhas);
    },
    async avancar() {
      return false;
    },
  };
  return executarDescoberta(portal, { cnpj: CNPJ, periodoConsulta: PERIODO, tipo: 'EMITIDAS' });
}

describe('descoberta classificada', () => {
  it('inventaria 10 notas vigentes', async () => {
    const resultado = await descobrir(Array.from({ length: 10 }, (_, indice) => linhaDe(indice + 1, GERADA, indice)));
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    expect(resultado.inventario.totais).toMatchObject({
      descobertos: 10,
      emitidas: 10,
      vigentes: 10,
      canceladas: 0,
      indeterminadas: 0,
    });
  });

  it('inventaria 8 vigentes e 2 canceladas', async () => {
    const linhas = [
      ...Array.from({ length: 8 }, (_, indice) => linhaDe(indice + 1, GERADA, indice)),
      linhaDe(9, CANCELADA, 8),
      linhaDe(10, CANCELADA, 9),
    ];
    const resultado = await descobrir(linhas);
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    expect(resultado.inventario.completude).toBe('COMPLETO');
    expect(resultado.inventario.totais).toMatchObject({
      descobertos: 10,
      vigentes: 8,
      canceladas: 2,
      indeterminadas: 0,
    });
    expect(resultado.inventario.documentos.filter((item) => item.situacao === 'CANCELADA')).toHaveLength(2);
  });

  it('mantém a nota de código desconhecido como indeterminada no inventário', async () => {
    const linhas = [
      ...Array.from({ length: 7 }, (_, indice) => linhaDe(indice + 1, GERADA, indice)),
      linhaDe(8, CANCELADA, 7),
      linhaDe(9, CANCELADA, 8),
      linhaDe(10, evidencia({ dataSituacao: 'P999_NAO_OBSERVADO', icones: GERADA.icones }), 9),
    ];
    const resultado = await descobrir(linhas);
    expect(resultado.inventario.totais).toMatchObject({
      descobertos: 10,
      vigentes: 7,
      canceladas: 2,
      indeterminadas: 1,
    });
    expect(resultado.inventario.totais.descobertos).toBe(7 + 2 + 1);
    expect(resultado.diagnosticos.some((item) => item.codigo === CODIGO_SITUACAO_DESCONHECIDO)).toBe(true);
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    const indeterminada = resultado.inventario.documentos.find((item) => item.situacao === 'INDETERMINADA');
    expect(indeterminada?.chaveNacional).toBe(chave(10));
    expect(bloqueiaProcessamentoAutomatico(indeterminada!)).toBe(true);
  });

  it('não classifica o botão Cancelar da página como nota cancelada', async () => {
    const html = `
      <table><tbody>
        <tr>
          <td class="td-situacao"><img src="/EmissorNacional/img/tb-gerada.svg" title="NFS-e Gerada" /></td>
          <td class="td-acoes"><button type="button">Cancelar</button></td>
          <td><a href="/EmissorNacional/Notas/Download/NFSe/${chave(40)}">Download XML</a></td>
        </tr>
      </tbody></table>`;
    const resultado = await descobrir(interpretarHtmlTabela(html));
    expect(resultado.inventario.documentos[0].situacao).toBe('VIGENTE');
    expect(resultado.inventario.totais.canceladas).toBe(0);
  });

  it('não transforma descoberta incompleta em inventário completo', async () => {
    const semChave = linhaDe(0, GERADA, 1);
    const resultado = await descobrir([linhaDe(41, GERADA, 0), semChave]);
    expect(resultado.status).toBe('DISCOVERY_INCOMPLETE');
    expect(resultado.inventario.completude).toBe('PARCIAL');
    expect(resultado.inventario.documentos).toHaveLength(1);
    expect(resultado.inventario.documentos[0].situacao).toBe('VIGENTE');
  });

  it('inventaria somente canceladas e mantém a descoberta completa', async () => {
    const resultado = await descobrir([linhaDe(50, CANCELADA, 0), linhaDe(51, CANCELADA, 1)]);
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    expect(resultado.inventario.totais).toMatchObject({
      descobertos: 2,
      vigentes: 0,
      canceladas: 2,
      indeterminadas: 0,
    });
    expect(resultado.inventario.documentos.every((item) => item.direcao === 'EMITIDA')).toBe(true);
    expect(resultado.inventario.documentos.every((item) => item.periodoConsulta.inicio === PERIODO.inicio)).toBe(
      true
    );
  });
});

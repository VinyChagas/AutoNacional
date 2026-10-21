import { describe, expect, it } from 'vitest';
import { ContratoNfseError } from '../contracts/erros';
import { criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import { bloqueiaProcessamentoAutomatico } from '../contracts/documento-fiscal';
import { extrairChaveDaLinha } from './chave';
import { executarDescoberta } from './discovery-runner';
import { interpretarHtmlTabela, registroDaLinha } from './row-parser';
import { comFingerprint } from './pagination';
import type {
  DirecaoDocumentoFiscal,
} from '../contracts/documento-fiscal';
import type {
  LeituraFiltroPortal,
  LinhaListagem,
  PaginaListagem,
  PortalListagem,
} from './types';

const CNPJ = '12.345.678/0001-99';
const CNPJ_LIMPO = '12345678000199';
const PERIODO = criarPeriodoConsultaPortal('01/01/2026', '31/01/2026');

function chave(final: number): string {
  return String(final).padStart(50, '9');
}

function href(final: number): string {
  return `/EmissorNacional/Notas/Download/NFSe/${chave(final)}`;
}

function linha(parcial: Partial<LinhaListagem> & Pick<LinhaListagem, 'hrefs'>): LinhaListagem {
  return {
    pagina: 1,
    linha: 0,
    dataChave: null,
    textos: ['100'],
    evidenciaSituacao: {
      dataSituacao: null,
      textoColuna: null,
      classeColuna: null,
      icones: [],
    },
    ...parcial,
  };
}

function pagina(
  linhas: LinhaListagem[],
  extras: Partial<Omit<PaginaListagem, 'fingerprint' | 'linhas'>> = {}
): PaginaListagem {
  return comFingerprint({
    url: 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?executar=1',
    paginaIndicador: 1,
    totalizador: null,
    semRegistros: false,
    proxima: { presente: false, desabilitado: true },
    ...extras,
    linhas,
  });
}

function urlComPesquisa(
  direcao: DirecaoDocumentoFiscal,
  inicio = PERIODO.inicio,
  fim = PERIODO.fim
): string {
  const lista = direcao === 'EMITIDA' ? 'Emitidas' : 'Recebidas';
  const params = new URLSearchParams({
    executar: '1',
    busca: '',
    datainicio: inicio,
    datafim: fim,
  });
  return `https://www.nfse.gov.br/EmissorNacional/Notas/${lista}?${params.toString()}`;
}

function leituraDe(direcao: DirecaoDocumentoFiscal, extras: Partial<LeituraFiltroPortal> = {}): LeituraFiltroPortal {
  return {
    url: urlComPesquisa(direcao),
    dataInicio: PERIODO.inicio,
    dataFim: PERIODO.fim,
    semRegistros: false,
    quantidadeLinhas: 1,
    temTabela: true,
    ...extras,
  };
}

function portalControlado(opcoes: {
  paginas: Partial<Record<DirecaoDocumentoFiscal, PaginaListagem[]>>;
  leitura?: (direcao: DirecaoDocumentoFiscal) => LeituraFiltroPortal;
  falhaAoAbrir?: boolean;
  repetirPagina?: boolean;
}): { portal: PortalListagem; abertas: DirecaoDocumentoFiscal[]; avancos: number; capturas: number } {
  const abertas: DirecaoDocumentoFiscal[] = [];
  const cursor = new Map<DirecaoDocumentoFiscal, number>();
  let avancos = 0;
  let capturas = 0;
  const portal: PortalListagem = {
    async abrir(direcao) {
      if (opcoes.falhaAoAbrir) throw new Error('menu ausente');
      abertas.push(direcao);
      cursor.set(direcao, 0);
    },
    async aplicarPeriodo(_periodo, direcao) {
      return (opcoes.leitura ?? leituraDe)(direcao);
    },
    async capturar(numero, direcao) {
      capturas += 1;
      const lista = opcoes.paginas[direcao] ?? [];
      if (opcoes.repetirPagina && numero > 1) return lista[0];
      return lista[Math.min(numero, lista.length) - 1];
    },
    async avancar(direcao) {
      avancos += 1;
      const atual = cursor.get(direcao) ?? 0;
      cursor.set(direcao, atual + 1);
      return true;
    },
  };
  return {
    portal,
    abertas,
    get avancos() {
      return avancos;
    },
    get capturas() {
      return capturas;
    },
  };
}

describe('extração de chave', () => {
  it('extrai chave de 50 dígitos do href de download', () => {
    const extraida = extrairChaveDaLinha({ hrefs: [href(1)], dataChave: null });
    expect(extraida.chave).toBe(chave(1));
    expect(extraida.fonte).toBe('HREF_DOWNLOAD_XML');
    expect(extraida.problemas).toEqual([]);
  });

  it('rejeita chave de 44 dígitos', () => {
    const extraida = extrairChaveDaLinha({
      hrefs: [`/EmissorNacional/Notas/Download/NFSe/${'1'.repeat(44)}`],
      dataChave: null,
    });
    expect(extraida.chave).toBeNull();
    expect(extraida.problemas).toContain('CHAVE_44_REJEITADA');
  });

  it('rejeita chave inválida', () => {
    const extraida = extrairChaveDaLinha({
      hrefs: ['/EmissorNacional/Notas/Download/NFSe/ABC'],
      dataChave: null,
    });
    expect(extraida.chave).toBeNull();
    expect(extraida.problemas).toContain('CHAVE_INVALIDA');
  });

  it('usa data-chave quando ela contém 50 dígitos', () => {
    const extraida = extrairChaveDaLinha({ hrefs: [], dataChave: `prefixo-${chave(2)}` });
    expect(extraida.chave).toBe(chave(2));
    expect(extraida.fonte).toBe('DATA_CHAVE');
  });

  it('não decodifica data-chave desconhecido', () => {
    const extraida = extrairChaveDaLinha({
      hrefs: [],
      dataChave: 'MW85eTRUeExBcE1mV09YVjJrMVlZOU1taXRPMlVLSWdJVk5EUWQxaFVhcVNv',
    });
    expect(extraida.chave).toBeNull();
    expect(extraida.problemas).toContain('DATA_CHAVE_NAO_VERIFICAVEL');
  });
});

describe('descoberta da listagem', () => {
  it('descobre emitidas e marca a situação como indeterminada', async () => {
    const html = `
      <table><tbody>
        <tr>
          <td>100</td>
          <td class="td-situacao"></td>
          <td><a href="${href(1)}">Download XML</a></td>
        </tr>
      </tbody></table>`;
    const linhas = interpretarHtmlTabela(html);
    const controle = portalControlado({ paginas: { EMITIDA: [pagina(linhas, { totalizador: 1 })] } });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });

    expect(controle.abertas).toEqual(['EMITIDA']);
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    expect(resultado.inventario.cnpj).toBe(CNPJ_LIMPO);
    expect(resultado.inventario.totais).toMatchObject({
      descobertos: 1,
      emitidas: 1,
      recebidas: 0,
      vigentes: 0,
      indeterminadas: 1,
    });
    expect(resultado.inventario.documentos[0].situacao).toBe('INDETERMINADA');
    expect(bloqueiaProcessamentoAutomatico(resultado.inventario.documentos[0])).toBe(true);
    expect(resultado.inventario.completude).toBe('COMPLETO');
  });

  it('descobre recebidas', async () => {
    const controle = portalControlado({
      paginas: {
        RECEBIDA: [
          pagina([linha({ hrefs: [href(3)], linha: 0 })], {
            url: 'https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1',
            totalizador: 1,
          }),
        ],
      },
    });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'RECEBIDAS',
    });
    expect(controle.abertas).toEqual(['RECEBIDA']);
    expect(resultado.inventario.totais.recebidas).toBe(1);
    expect(resultado.inventario.documentos[0].direcao).toBe('RECEBIDA');
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
  });

  it('confirma lista vazia sem exigir quantidade fixa', async () => {
    const controle = portalControlado({
      paginas: {
        EMITIDA: [
          pagina([], {
            semRegistros: true,
            totalizador: 0,
            proxima: { presente: false, desabilitado: true },
          }),
        ],
      },
      leitura: (direcao) => leituraDe(direcao, { semRegistros: true, quantidadeLinhas: 0 }),
    });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    expect(resultado.inventario.totais.descobertos).toBe(0);
    expect(resultado.inventario.completude).toBe('COMPLETO');
    expect(controle.avancos).toBe(0);
  });

  it('percorre várias páginas e para na última', async () => {
    const primeira = pagina([linha({ hrefs: [href(1)] })], {
      paginaIndicador: 1,
      totalizador: 2,
      proxima: { presente: true, desabilitado: false },
    });
    const ultima = pagina([linha({ hrefs: [href(2)], linha: 0 })], {
      paginaIndicador: 2,
      totalizador: 2,
      proxima: { presente: true, desabilitado: true },
    });
    const controle = portalControlado({ paginas: { EMITIDA: [primeira, ultima] } });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    expect(resultado.paginasPercorridas).toBe(2);
    expect(resultado.inventario.totais.descobertos).toBe(2);
    expect(controle.avancos).toBe(1);
  });

  it('falha quando a paginação não muda o conteúdo', async () => {
    const atual = pagina([linha({ hrefs: [href(1)] })], {
      proxima: { presente: true, desabilitado: false },
      totalizador: null,
    });
    const controle = portalControlado({
      paginas: { EMITIDA: [atual] },
      repetirPagina: true,
    });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_FAILED');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'PAGINACAO_NAO_AVANCOU')).toBe(true);
    expect(resultado.inventario.completude).toBe('INDETERMINADO');
  });

  it('falha quando uma página posterior repete o conteúdo', async () => {
    const primeira = pagina([linha({ hrefs: [href(1)], textos: ['a'] })], {
      paginaIndicador: 1,
      proxima: { presente: true, desabilitado: false },
    });
    const segunda = pagina([linha({ hrefs: [href(2)], textos: ['b'] })], {
      paginaIndicador: 2,
      proxima: { presente: true, desabilitado: false },
    });
    const controle = portalControlado({ paginas: { EMITIDA: [primeira, segunda, primeira] } });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_FAILED');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'PAGINA_REPETIDA')).toBe(true);
  });

  it('registra chave duplicada e não a repete no inventário', async () => {
    const primeira = pagina([linha({ hrefs: [href(1)], textos: ['a'] })], {
      paginaIndicador: 1,
      proxima: { presente: true, desabilitado: false },
    });
    const segunda = pagina([linha({ hrefs: [href(1)], textos: ['b'] })], {
      paginaIndicador: 2,
      proxima: { presente: false, desabilitado: true },
    });
    const controle = portalControlado({ paginas: { EMITIDA: [primeira, segunda] } });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.registros).toHaveLength(2);
    expect(resultado.inventario.documentos).toHaveLength(1);
    expect(resultado.status).toBe('DISCOVERY_INCOMPLETE');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'DUPLICIDADE')).toBe(true);
    expect(resultado.inventario.completude).toBe('PARCIAL');
  });

  it('preserva a chave encontrada nas duas direções fora do inventário confirmado', async () => {
    const emitida = pagina([linha({ hrefs: [href(7)] })], { totalizador: 1 });
    const recebida = pagina([linha({ hrefs: [href(7)] })], {
      url: 'https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1',
      totalizador: 1,
    });
    const controle = portalControlado({ paginas: { EMITIDA: [emitida], RECEBIDA: [recebida] } });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'AMBAS',
    });
    expect(resultado.registros.map((item) => item.direcao)).toEqual(['EMITIDA', 'RECEBIDA']);
    expect(resultado.inventario.documentos).toHaveLength(0);
    expect(resultado.status).toBe('DISCOVERY_INCOMPLETE');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'CHAVE_EM_AMBAS_DIRECOES')).toBe(
      true
    );
  });

  it('não inclui linha sem chave e deixa o inventário incompleto', async () => {
    const controle = portalControlado({
      paginas: { EMITIDA: [pagina([linha({ hrefs: [], textos: ['sem link'] })], { totalizador: 1 })] },
    });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.inventario.documentos).toHaveLength(0);
    expect(resultado.registros[0].problemas).toContain('CHAVE_NAO_IDENTIFICADA');
    expect(resultado.status).toBe('DISCOVERY_INCOMPLETE');
  });

  it('falha de forma explícita quando a navegação não abre a listagem', async () => {
    let capturas = 0;
    const portal: PortalListagem = {
      async abrir() {
        throw new Error('menu ausente');
      },
      async aplicarPeriodo() {
        throw new Error('não deveria filtrar');
      },
      async capturar() {
        capturas += 1;
        throw new Error('não deveria capturar');
      },
      async avancar() {
        return false;
      },
    };
    const resultado = await executarDescoberta(portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_FAILED');
    expect(resultado.diagnosticos[0].codigo).toBe('NAV_FALHA');
    expect(capturas).toBe(0);
    expect(resultado.inventario.completude).toBe('INDETERMINADO');
  });

  it('falha quando os campos de data não confirmam o período', async () => {
    let capturas = 0;
    const portal: PortalListagem = {
      async abrir() {
        return undefined;
      },
      async aplicarPeriodo(_periodo, direcao) {
        return leituraDe(direcao, { dataInicio: '01/02/2026', dataFim: '28/02/2026' });
      },
      async capturar() {
        capturas += 1;
        throw new Error('não deveria capturar');
      },
      async avancar() {
        return false;
      },
    };
    const resultado = await executarDescoberta(portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_FAILED');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'FILTRO_NAO_APLICADO')).toBe(true);
    expect(capturas).toBe(0);
  });

  it('aceita a pesquisa quando a URL registra executar=1 e o período', async () => {
    const controle = portalControlado({
      paginas: { EMITIDA: [pagina([linha({ hrefs: [href(11)] })], { totalizador: 1 })] },
    });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'FILTRO_NAO_APLICADO')).toBe(false);
    expect(controle.capturas).toBe(1);
  });

  it('rejeita linhas visíveis quando a pesquisa não atualizou a URL', async () => {
    let capturas = 0;
    const portal: PortalListagem = {
      async abrir() {
        return undefined;
      },
      async aplicarPeriodo(_periodo, direcao) {
        return leituraDe(direcao, {
          url: 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas',
          quantidadeLinhas: 12,
          temTabela: true,
        });
      },
      async capturar() {
        capturas += 1;
        throw new Error('não deveria capturar');
      },
      async avancar() {
        return false;
      },
    };
    const resultado = await executarDescoberta(portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_FAILED');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'FILTRO_NAO_APLICADO')).toBe(true);
    expect(capturas).toBe(0);
  });

  it('rejeita a tabela antiga que permanece visível após preencher as datas', async () => {
    let capturas = 0;
    const portal: PortalListagem = {
      async abrir() {
        return undefined;
      },
      async aplicarPeriodo(_periodo, direcao) {
        return leituraDe(direcao, {
          url: urlComPesquisa(direcao, '01/12/2025', '31/12/2025'),
          quantidadeLinhas: 8,
          temTabela: true,
        });
      },
      async capturar() {
        capturas += 1;
        throw new Error('não deveria capturar');
      },
      async avancar() {
        return false;
      },
    };
    const resultado = await executarDescoberta(portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_FAILED');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'FILTRO_NAO_APLICADO')).toBe(true);
    expect(resultado.inventario.documentos).toHaveLength(0);
    expect(capturas).toBe(0);
  });

  it('aceita pesquisa válida mesmo quando as notas repetem a listagem anterior', async () => {
    const notas = [linha({ hrefs: [href(21)], textos: ['13/08/2025', '08/2025'] })];
    const controle = portalControlado({
      paginas: { EMITIDA: [pagina(notas, { totalizador: 1 }), pagina(notas, { totalizador: 1 })] },
    });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
    });
    expect(resultado.status).toBe('DISCOVERY_COMPLETE');
    expect(resultado.inventario.documentos).toHaveLength(1);
    expect(resultado.inventario.documentos[0].competenciaFiscalXml).toBeUndefined();
    expect(resultado.diagnosticos.some((item) => item.codigo === 'FILTRO_NAO_APLICADO')).toBe(false);
  });

  it('rejeita CNPJ inválido antes de consultar o portal', async () => {
    const portal: PortalListagem = {
      async abrir() {
        throw new Error('portal acionado');
      },
      async aplicarPeriodo() {
        throw new Error('portal acionado');
      },
      async capturar() {
        throw new Error('portal acionado');
      },
      async avancar() {
        return false;
      },
    };
    await expect(
      executarDescoberta(portal, { cnpj: '123', periodoConsulta: PERIODO, tipo: 'EMITIDAS' })
    ).rejects.toThrow(ContratoNfseError);
  });

  it('rejeita período inválido antes de consultar o portal', async () => {
    const portal: PortalListagem = {
      async abrir() {
        throw new Error('portal acionado');
      },
      async aplicarPeriodo() {
        throw new Error('portal acionado');
      },
      async capturar() {
        throw new Error('portal acionado');
      },
      async avancar() {
        return false;
      },
    };
    const periodo = {
      tipo: 'PERIODO_CONSULTA_PORTAL',
      inicio: '32/01/2026',
      fim: '31/01/2026',
    } as PeriodoConsultaPortal;
    await expect(
      executarDescoberta(portal, { cnpj: CNPJ, periodoConsulta: periodo, tipo: 'EMITIDAS' })
    ).rejects.toThrow(/DD\/MM\/YYYY/);
  });

  it('falha ao atingir o limite de segurança sem declarar sucesso', async () => {
    const atual = pagina([linha({ hrefs: [href(1)] })], {
      proxima: { presente: true, desabilitado: false },
    });
    const controle = portalControlado({ paginas: { EMITIDA: [atual, atual] } });
    const resultado = await executarDescoberta(controle.portal, {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: 'EMITIDAS',
      maxPaginas: 1,
    });
    expect(resultado.status).toBe('DISCOVERY_INCOMPLETE');
    expect(resultado.diagnosticos.some((item) => item.codigo === 'LIMITE_PAGINAS')).toBe(true);
    expect(controle.avancos).toBe(0);
  });
});

describe('evidência bruta de situação', () => {
  it('guarda o ícone da coluna de situação e não classifica a nota', () => {
    const html = `
      <table><tbody>
        <tr data-situacao="2">
          <td class="td-situacao">
            <img src="/img/cancelada.svg" title="Nota cancelada" data-original-title="Nota cancelada" alt="cancelada" />
          </td>
          <td><a href="${href(4)}">Download XML</a></td>
        </tr>
      </tbody></table>`;
    const registro = registroDaLinha(interpretarHtmlTabela(html)[0], 'EMITIDA');
    expect(registro.chaveNacional).toBe(chave(4));
    expect(registro.evidenciaSituacao.dataSituacao).toBe('2');
    expect(registro.evidenciaSituacao.icones[0].title).toBe('Nota cancelada');
    expect(registro.evidenciaSituacao.icones[0].dataOriginalTitle).toBe('Nota cancelada');
    expect(registro.problemas).toEqual([]);
  });

  it('ignora o ícone de ação do menu', () => {
    const html = `
      <table><tbody>
        <tr>
          <td class="td-situacao"><img src="/img/situacao.svg" title="Gerada" alt="gerada" /></td>
          <td class="td-acoes">
            <a href="${href(5)}">Download XML</a>
            <img src="/img/acoes/cancelar.png" title="Cancelar" alt="Cancelar" aria-label="Cancelar nota" />
          </td>
        </tr>
      </tbody></table>`;
    const registro = registroDaLinha(interpretarHtmlTabela(html)[0], 'EMITIDA');
    const titulos = registro.evidenciaSituacao.icones.map((icone) => icone.title);
    expect(titulos).toEqual(['Gerada']);
    expect(JSON.stringify(registro.evidenciaSituacao)).not.toContain('Cancelar');
  });
});

/**
 * Homologação offline 22.8 — fluxo integrado com componentes reais.
 * Sem browser, HTTP, SEFIN, Portal ou certificados de clientes.
 */
import { gzipSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import { planejarRecuperacaoSefin } from '../recovery/recovery-service';
import { inspecionarCredencialMtls } from '../recovery/mtls-provider';
import {
  NAMESPACE_OFICIAL_NFSE,
  validarXmlNfse,
} from '../recovery/xml-validator';
import type {
  CredencialMtls,
  EntradaRecuperacaoSefin,
  ResultadoRecuperacaoSefin,
  TransporteHttpMtls,
} from '../recovery/types';
import {
  AdaptadorCertificadoA1,
  RepositorioFiscalNfse,
  criarResolvedorRaizInjetada,
} from '../infrastructure';
import {
  NOME_FLAG_RECUPERACAO_NATIVA,
  decidirIntegracaoNativa,
  executarFluxoFiscalNativo,
} from '../orchestration';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import type { DependenciasFluxoFiscalNativo } from '../orchestration/types';

const CNPJ = '12345678000199';
const TOMADOR = '11222333000181';
const OUTRO = '99888777000166';
const SENHA = 'SENHA-SINTETICA-NAO-VAZAR';
const PAGE = { url: () => 'about:blank' } as unknown as Page;

let raiz: string;
const evidencias: Array<{ id: string; resultado: 'PASS' | 'FAIL'; detalhe: string }> = [];

function registrar(id: string, resultado: 'PASS' | 'FAIL', detalhe: string) {
  evidencias.push({ id, resultado, detalhe });
}

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), 'nfse-hom-'));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('homologação 22.8 — evidências offline', () => {
  it('01 empresa sem movimento', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const inv = inventario([], periodo);
    const plano = planejarRecuperacaoSefin(inv);
    expect(plano.podeIniciar).toBe(true);
    expect(plano.elegiveis).toHaveLength(0);
    const deps = depsFluxo(inv);
    const r = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: periodo,
      execucaoId: 'h-01',
      tipo: 'ambas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(r.descobertos).toBe(0);
    expect(r.conclusaoReconciliacao).toBe('RECONCILIADA');
    registrar('01', 'PASS', `sem movimento cobertura=${r.coberturaPercentual}`);
  });

  it('02–04 emitidas, recebidas e ambas', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    for (const [id, docs, tipo] of [
      ['02', [doc(chave(1), { periodo })], 'emitidas' as const],
      ['03', [doc(chave(2), { periodo, direcao: 'RECEBIDA' })], 'recebidas' as const],
      [
        '04',
        [doc(chave(3), { periodo }), doc(chave(4), { periodo, direcao: 'RECEBIDA' })],
        'ambas' as const,
      ],
    ]) {
      const dir = await mkdtemp(path.join(tmpdir(), `nfse-hom-${id}-`));
      try {
        const inv = inventario(docs, periodo);
        const r = await executarFluxoFiscalNativo({
          page: PAGE,
          cnpj: CNPJ,
          periodoConsulta: periodo,
          execucaoId: `h-${id}`,
          tipo,
          baixarPdf: false,
          raizFiscal: dir,
          dependencias: depsFluxo(inv, {
            raizOverride: dir,
            recuperar: async (e) =>
              e.direcao === 'RECEBIDA'
                ? recuperadoRecebida(e.chave, periodo)
                : recuperadoEmitida(e.chave, periodo),
          }),
        });
        expect(r.persistidos).toBe(docs.length);
        expect(r.estadoAuditoria).toBe('RECONCILIADA');
        registrar(id, 'PASS', `${tipo} persistidos=${r.persistidos}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('05 canceladas no inventário fora da recuperação', () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const inv = inventario(
      [doc(chave(1), { periodo }), doc(chave(2), { periodo, situacao: 'CANCELADA' })],
      periodo
    );
    const plano = planejarRecuperacaoSefin(inv);
    expect(plano.elegiveis).toHaveLength(1);
    expect(plano.excluidas).toContain(chave(2));
    expect(inv.totais.canceladas).toBe(1);
    registrar('05', 'PASS', 'cancelada excluída do plano e presente no inventário');
  });

  it('06 indeterminada recupera com atenção fiscal (API-03M)', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const inv = inventario([doc(chave(1), { periodo, situacao: 'INDETERMINADA' })], periodo);
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: periodo,
      execucaoId: 'h-06',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: depsFluxo(inv),
    });
    expect(resultado.indeterminadas).toBe(1);
    expect(resultado.xmlsComAtencaoFiscal).toBe(1);
    expect(resultado.documentosPendentesFiscais?.length).toBe(1);
    expect(resultado.loteLiberado).toBe(false);
    registrar('06', 'PASS', 'INDETERMINADA segue SEFIN com atenção fiscal');
  });

  it('07 paginação múltipla (inventário consolidado)', () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const docs = Array.from({ length: 5 }, (_, i) => doc(chave(10 + i), { periodo }));
    const inv = inventario(docs, periodo);
    expect(inv.totais.descobertos).toBe(5);
    expect(new Set(docs.map((d) => d.chaveNacional)).size).toBe(5);
    registrar('07', 'PASS', '5 chaves únicas consolidadas');
  });

  it('08–11 recuperação integral, parcial, transitória e permanente', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const integral = await fluxoSimples(
      inventario([doc(chave(1), { periodo })], periodo),
      periodo,
      'h-08'
    );
    expect(integral.persistidos).toBe(1);
    registrar('08', 'PASS', 'XML integral persistido');

    const parcial = await fluxoSimples(
      inventario([doc(chave(1), { periodo }), doc(chave(2), { periodo })], periodo),
      periodo,
      'h-09',
      {
        recuperar: async (e) =>
          e.chave === chave(1)
            ? recuperadoEmitida(e.chave, periodo)
            : falhaSefin(e.chave, 'TRANSITORIO', 'TIMEOUT'),
      }
    );
    expect(parcial.persistidos).toBe(1);
    expect(parcial.estadoAuditoria).toBe('PARCIAL');
    registrar('09', 'PASS', 'parcial 1/2');

    const trans = await fluxoSimples(
      inventario([doc(chave(3), { periodo })], periodo),
      periodo,
      'h-10',
      { recuperar: async (e) => falhaSefin(e.chave, 'TRANSITORIO', 'TIMEOUT') }
    );
    expect(trans.persistidos).toBe(0);
    registrar('10', 'PASS', 'falha transitória registrada');

    const perm = await fluxoSimples(
      inventario([doc(chave(4), { periodo })], periodo),
      periodo,
      'h-11',
      { recuperar: async (e) => falhaSefin(e.chave, 'PERMANENTE', 'HTTP_404') }
    );
    expect(perm.recuperacoes[0]?.codigo).toBe('HTTP_404');
    registrar('11', 'PASS', 'falha permanente HTTP_404');
  });

  it('12–15 retomada, órfão, corrompido e hash divergente', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const inv = inventario([doc(chave(1), { periodo })], periodo);
    const raizRetoma = await mkdtemp(path.join(tmpdir(), 'nfse-retoma-'));
    try {
      await fluxoSimples(inv, periodo, 'h-12a', { raizOverride: raizRetoma });
      const retoma = await fluxoSimples(inv, periodo, 'h-12b', {
        raizOverride: raizRetoma,
        recuperar: async () => {
          throw new Error('não deve SEFIN');
        },
      });
      expect(retoma.persistidos).toBe(1);
      registrar('12', 'PASS', 'retomada sem nova SEFIN');
    } finally {
      await rm(raizRetoma, { recursive: true, force: true });
    }

    const raizOrf = await mkdtemp(path.join(tmpdir(), 'nfse-orf-'));
    try {
      const repo = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raizOrf));
      const invO = inventario([doc(chave(1), { periodo })], periodo);
      await repo.criarCheckpoint(invO, 'orf-1');
      await repo.xmls.persistir(CNPJ, periodo, chave(1), xmlEmitida(chave(1), '2026-08'), 'EMITIDA');
      const r = await fluxoSimples(invO, periodo, 'h-13', {
        raizOverride: raizOrf,
        recuperar: async () => {
          throw new Error('órfão');
        },
      });
      expect(r.persistidos).toBe(1);
      registrar('13', 'PASS', 'órfão válido reaproveitado');
    } finally {
      await rm(raizOrf, { recursive: true, force: true });
    }

    const raizCorr = await mkdtemp(path.join(tmpdir(), 'nfse-corr-'));
    try {
      const repo = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raizCorr));
      const invC = inventario([doc(chave(1), { periodo })], periodo);
      await repo.criarCheckpoint(invC, 'corr-1');
      await repo.persistirXml(invC, chave(1), xmlEmitida(chave(1), '2026-08'));
      await writeFile(repo.caminhoXml(CNPJ, periodo, chave(1)), '<xml>x</xml>');
      const r = await fluxoSimples(invC, periodo, 'h-14', {
        raizOverride: raizCorr,
        recuperar: async (e) => recuperadoEmitida(e.chave, periodo),
      });
      expect(r.recuperacoes.some((x) => x.resultado === 'INCONSISTENTE')).toBe(true);
      registrar('14', 'PASS', 'XML corrompido → INCONSISTENTE');
    } finally {
      await rm(raizCorr, { recursive: true, force: true });
    }

    const raizHash = await mkdtemp(path.join(tmpdir(), 'nfse-hash-'));
    try {
      const invH = inventario([doc(chave(1), { periodo })], periodo);
      const repo = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raizHash));
      await repo.criarCheckpoint(invH, 'hash-1');
      await repo.persistirXml(invH, chave(1), xmlEmitida(chave(1), '2026-08'));
      await expect(
        repo.persistirXml(invH, chave(1), xmlEmitida(chave(1), '2026-09'))
      ).rejects.toBeTruthy();
      registrar('15', 'PASS', 'hash/conteúdo divergente recusado');
    } finally {
      await rm(raizHash, { recursive: true, force: true });
    }
  });

  it('16 API-03F superconjunto evolui checkpoint', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const raizFp = await mkdtemp(path.join(tmpdir(), 'nfse-fp-'));
    try {
      await fluxoSimples(inventario([doc(chave(1), { periodo })], periodo), periodo, 'h-16a', {
        raizOverride: raizFp,
      });
      const segundo = await fluxoSimples(
        inventario([doc(chave(1), { periodo }), doc(chave(2), { periodo })], periodo),
        periodo,
        'h-16b',
        { raizOverride: raizFp }
      );
      expect(segundo.descobertos).toBe(2);
      expect(segundo.persistidos).toBe(2);
      registrar('16', 'PASS', 'superconjunto evolui e completa');
    } finally {
      await rm(raizFp, { recursive: true, force: true });
    }
  });

  it('17 execução simultânea', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const inv = inventario([doc(chave(1), { periodo })], periodo);
    const raizConc = await mkdtemp(path.join(tmpdir(), 'nfse-conc-'));
    try {
      const depsA = depsFluxo(inv, { raizOverride: raizConc });
      // Segura a trava fiscal do Commit 05 e tenta segunda execução na mesma identidade.
      await depsA.repositorio.executarComExclusividadeFiscal(CNPJ, periodo, async () => {
        await expect(
          fluxoSimples(inv, periodo, 'h-17b', { raizOverride: raizConc })
        ).rejects.toMatchObject({ codigo: 'EXECUCAO_EM_USO' });
      });
      const completo = await fluxoSimples(inv, periodo, 'h-17a', { raizOverride: raizConc });
      expect(completo.persistidos).toBe(1);
      registrar('17', 'PASS', 'segunda execução EXECUCAO_EM_USO');
    } finally {
      await rm(raizConc, { recursive: true, force: true });
    }
  });

  it('18–19 certificado indisponível e expirado', async () => {
    await expect(
      new AdaptadorCertificadoA1({
        async carregar() {
          throw new Error('Certificado não encontrado');
        },
      }).obter(CNPJ)
    ).rejects.toMatchObject({ codigo: 'CERTIFICADO_INEXISTENTE' });
    registrar('18', 'PASS', 'A1 indisponível');

    expect(() =>
      inspecionarCredencialMtls({ pfx: pfxValidade(SENHA, '2010-01-01', '2011-01-01'), senha: SENHA })
    ).toThrow(/expirado/i);
    registrar('19', 'PASS', 'A1 expirado');

    expect(() =>
      inspecionarCredencialMtls(
        { pfx: pfxValidade(SENHA, '2090-01-01', '2099-01-01'), senha: SENHA },
        new Date('2026-10-20T00:00:00Z')
      )
    ).toThrow(/ainda não válido/i);
  });

  it('20–23 PDF, flag e autorização', () => {
    const envOn = {
      [NOME_FLAG_RECUPERACAO_NATIVA]: 'true',
      NFSE_FISCAL_STORAGE_PATH: raiz,
    };
    // API-02K: baixarPdf não bloqueia — nativo XML-only com PDF_NAO_RECUPERADO
    const dPdf = decidirIntegracaoNativa({
      page: PAGE,
      cnpj: CNPJ,
      dataInicio: '01/09/2026',
      dataFim: '30/09/2026',
      tipo: 'ambas',
      baixarPdf: true,
      execucaoId: 'h-20',
      tipoAutenticacao: 'certificado',
      env: envOn,
      autorizacaoNativa: { autorizada: true },
    });
    expect(dPdf.situacao).toBe('NATIVO_SOLICITADO');
    expect(dPdf.compatibilidadePdf).toBe('PDF_NAO_RECUPERADO');
    registrar('20', 'PASS', 'PDF → NATIVO_SOLICITADO (XML-only)');

    expect(
      decidirIntegracaoNativa({
        page: PAGE,
        cnpj: CNPJ,
        dataInicio: '01/09/2026',
        dataFim: '30/09/2026',
        tipo: 'ambas',
        baixarPdf: false,
        execucaoId: 'h-21',
        tipoAutenticacao: 'certificado',
        env: {},
      }).situacao
    ).toBe('LEGADO_SOLICITADO');
    registrar('21', 'PASS', 'flag off → legado');

    expect(
      decidirIntegracaoNativa({
        page: PAGE,
        cnpj: CNPJ,
        dataInicio: '01/09/2026',
        dataFim: '30/09/2026',
        tipo: 'ambas',
        baixarPdf: false,
        execucaoId: 'h-22',
        tipoAutenticacao: 'certificado',
        env: envOn,
      }).situacao
    ).toBe('LEGADO_SOLICITADO');
    registrar('22', 'PASS', 'flag on sem auth → legado');

    expect(
      decidirIntegracaoNativa({
        page: PAGE,
        cnpj: CNPJ,
        dataInicio: '01/09/2026',
        dataFim: '30/09/2026',
        tipo: 'ambas',
        baixarPdf: false,
        execucaoId: 'h-23',
        tipoAutenticacao: 'certificado',
        env: envOn,
        autorizacaoNativa: { autorizada: true },
      }).situacao
    ).toBe('NATIVO_SOLICITADO');
    registrar('23', 'PASS', 'flag+auth → NATIVO_SOLICITADO');
  });

  it('24–25 auditoria parcial e reconciliada', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const parcial = await fluxoSimples(
      inventario([doc(chave(1), { periodo }), doc(chave(2), { periodo })], periodo),
      periodo,
      'h-24',
      {
        recuperar: async (e) =>
          e.chave === chave(1)
            ? recuperadoEmitida(e.chave, periodo)
            : falhaSefin(e.chave, 'TRANSITORIO', 'TIMEOUT'),
      }
    );
    expect(parcial.estadoAuditoria).toBe('PARCIAL');
    registrar('24', 'PASS', 'auditoria PARCIAL');

    const ok = await fluxoSimples(
      inventario([doc(chave(5), { periodo })], periodo),
      periodo,
      'h-25'
    );
    expect(ok.estadoAuditoria).toBe('RECONCILIADA');
    registrar('25', 'PASS', 'auditoria RECONCILIADA');
  });

  it('26 dCompet diferente do período não exclui vigente', () => {
    const portalSet = portal('01/09/2026', '30/09/2026');
    const leitura = validarXmlNfse(xmlEmitida(chave(1), '2026-08'), {
      chave: chave(1),
      cnpj: CNPJ,
      direcao: 'EMITIDA',
    });
    expect(leitura.validacao).toBe('CONFIRMADA');
    expect(leitura.dCompet).toBe('2026-08');
    const inv = inventario(
      [
        criarDocumentoFiscal({
          chaveNacional: chave(1),
          cnpj: CNPJ,
          direcao: 'EMITIDA',
          situacao: 'VIGENTE',
          periodoConsulta: portalSet,
          competenciaFiscalXml: { tipo: 'COMPETENCIA_FISCAL_XML', dCompet: '2026-08' },
        }),
      ],
      portalSet
    );
    expect(inv.totais.vigentes).toBe(1);
    expect(planejarRecuperacaoSefin(inv).elegiveis).toHaveLength(1);
    registrar('26', 'PASS', 'portal set/dCompet ago — vigente incluído');
  });

  it('27–29 namespace inválido, direção e CNPJ divergentes', () => {
    expect(() =>
      validarXmlNfse(
        `<?xml version="1.0"?><NFSe xmlns="http://evil.example"><infNFSe><chNFSe>${chave(1)}</chNFSe></infNFSe></NFSe>`,
        { chave: chave(1), cnpj: CNPJ, direcao: 'EMITIDA' }
      )
    ).toThrow(/Namespace/);
    registrar('27', 'PASS', 'namespace inválido');

    expect(() =>
      validarXmlNfse(xmlEmitida(chave(1), '2026-08'), {
        chave: chave(1),
        cnpj: CNPJ,
        direcao: 'RECEBIDA',
      })
    ).toThrow(/tomador/);
    registrar('28', 'PASS', 'direção divergente');

    expect(() =>
      validarXmlNfse(xmlEmitida(chave(1), '2026-08'), {
        chave: chave(1),
        cnpj: OUTRO,
        direcao: 'EMITIDA',
      })
    ).toThrow(/emitente/);
    registrar('29', 'PASS', 'CNPJ divergente');
  });

  it('30 exportação incompleta não libera lote', async () => {
    const periodo = portal('01/09/2026', '30/09/2026');
    const r = await fluxoSimples(
      inventario([doc(chave(1), { periodo }), doc(chave(2), { periodo })], periodo),
      periodo,
      'h-30',
      {
        recuperar: async (e) =>
          e.chave === chave(1)
            ? recuperadoEmitida(e.chave, periodo)
            : falhaSefin(e.chave, 'TRANSITORIO', 'TIMEOUT'),
      }
    );
    expect(r.loteLiberado).toBe(false);
    expect(r.documentosAptos.length).toBe(1);
    registrar('30', 'PASS', 'lote incompleto não liberado');
  });

  it('PKCS#12 / XXE / namespace oficial / dCompet nos três períodos', () => {
    const cred: CredencialMtls = { pfx: pfxValidade(SENHA, '2020-01-01', '2099-01-01'), senha: SENHA };
    expect(() => inspecionarCredencialMtls(cred)).not.toThrow();
    expect(NAMESPACE_OFICIAL_NFSE).toBe('http://www.sped.fazenda.gov.br/nfse');

    expect(() =>
      validarXmlNfse(
        `<!DOCTYPE NFSe [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NFSe xmlns="${NAMESPACE_OFICIAL_NFSE}">&xxe;</NFSe>`,
        { chave: chave(1), cnpj: CNPJ, direcao: 'EMITIDA' }
      )
    ).toThrow(/DOCTYPE|ENTITY/);

    for (const [inicio, fim, dCompet] of [
      ['01/09/2026', '30/09/2026', '2026-08'],
      ['01/08/2026', '31/08/2026', '2026-08'],
      ['01/09/2026', '30/09/2026', '2026-09'],
    ] as const) {
      const periodo = portal(inicio, fim);
      const leitura = validarXmlNfse(xmlEmitida(chave(1), dCompet), {
        chave: chave(1),
        cnpj: CNPJ,
        direcao: 'EMITIDA',
      });
      expect(leitura.validacao).toBe('CONFIRMADA');
      expect(leitura.dCompet).toBe(dCompet);
      const inv = inventario([doc(chave(1), { periodo })], periodo);
      expect(planejarRecuperacaoSefin(inv).elegiveis).toHaveLength(1);
    }
  });

  it('resumo de evidências das 30 cenários executados', () => {
    const ids = new Set(evidencias.filter((e) => e.resultado === 'PASS').map((e) => e.id));
    for (let i = 1; i <= 30; i += 1) {
      expect(ids.has(String(i).padStart(2, '0'))).toBe(true);
    }
  });
});

function portal(inicio: string, fim: string): PeriodoConsultaPortal {
  return criarPeriodoConsultaPortal(inicio, fim);
}

function chave(n: number): string {
  return String(n).padStart(50, '9');
}

function doc(
  ch: string,
  op: {
    periodo: PeriodoConsultaPortal;
    situacao?: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA';
    direcao?: 'EMITIDA' | 'RECEBIDA';
  }
) {
  return criarDocumentoFiscal({
    chaveNacional: ch,
    cnpj: CNPJ,
    direcao: op.direcao ?? 'EMITIDA',
    situacao: op.situacao ?? 'VIGENTE',
    periodoConsulta: op.periodo,
  });
}

function inventario(docs: ReturnType<typeof doc>[], periodo: PeriodoConsultaPortal): InventarioNfse {
  return montarInventario({
    id: 'inv-hom',
    cnpj: CNPJ,
    periodoConsulta: periodo,
    documentos: docs,
    completude: 'COMPLETO',
  });
}

function xmlEmitida(ch: string, dCompet: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="${NAMESPACE_OFICIAL_NFSE}">
  <infNFSe Id="NFS${ch}">
    <chNFSe>${ch}</chNFSe>
    <dCompet>${dCompet}</dCompet>
    <emit><CNPJ>${CNPJ}</CNPJ></emit>
    <toma><CNPJ>${TOMADOR}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function xmlRecebida(ch: string, dCompet: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="${NAMESPACE_OFICIAL_NFSE}">
  <infNFSe Id="NFS${ch}">
    <chNFSe>${ch}</chNFSe>
    <dCompet>${dCompet}</dCompet>
    <emit><CNPJ>${OUTRO}</CNPJ></emit>
    <toma><CNPJ>${CNPJ}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function recuperadoEmitida(ch: string, periodo: PeriodoConsultaPortal): ResultadoRecuperacaoSefin {
  const xml = xmlEmitida(ch, '2026-08');
  return {
    chaveNacional: ch,
    cnpj: CNPJ,
    direcao: 'EMITIDA',
    periodoConsulta: periodo,
    resultado: 'RECUPERADO',
    validacaoXml: 'CONFIRMADA',
    classeErro: null,
    codigo: null,
    mensagem: 'ok',
    dCompet: '2026-08',
    hashSha256: 'a'.repeat(64),
    xml,
  };
}

function recuperadoRecebida(ch: string, periodo: PeriodoConsultaPortal): ResultadoRecuperacaoSefin {
  const xml = xmlRecebida(ch, '2026-08');
  return {
    ...recuperadoEmitida(ch, periodo),
    direcao: 'RECEBIDA',
    xml,
  };
}

function falhaSefin(
  ch: string,
  classe: 'TRANSITORIO' | 'PERMANENTE',
  codigo: string
): ResultadoRecuperacaoSefin {
  return {
    chaveNacional: ch,
    cnpj: CNPJ,
    direcao: 'EMITIDA',
    periodoConsulta: null,
    resultado: 'FALHOU',
    validacaoXml: 'NAO_APLICADA',
    classeErro: classe,
    codigo,
    mensagem: codigo,
    dCompet: null,
    hashSha256: null,
    xml: null,
  };
}

function depsFluxo(
  inv: InventarioNfse,
  op: {
    recuperar?: (entrada: EntradaRecuperacaoSefin) => Promise<ResultadoRecuperacaoSefin>;
    raizOverride?: string;
  } = {}
): DependenciasFluxoFiscalNativo {
  const raizLocal = op.raizOverride ?? raiz;
  const repositorio = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raizLocal));
  const descobrir = vi.fn(async (input: { tipo: 'EMITIDAS' | 'RECEBIDAS' | 'AMBAS' }): Promise<ResultadoDescobertaNfse> => {
    const documentos =
      input.tipo === 'EMITIDAS'
        ? inv.documentos.filter((d) => d.direcao === 'EMITIDA')
        : input.tipo === 'RECEBIDAS'
          ? inv.documentos.filter((d) => d.direcao === 'RECEBIDA')
          : inv.documentos;
    const parcial = montarInventario({
      id: `${inv.id}-${input.tipo}`,
      cnpj: inv.cnpj,
      periodoConsulta: inv.periodoConsulta,
      documentos,
      completude: 'COMPLETO',
    });
    return {
      cnpj: CNPJ,
      periodoConsulta: inv.periodoConsulta,
      tipo: input.tipo === 'AMBAS' ? 'AMBAS' : input.tipo,
      status: 'DISCOVERY_COMPLETE',
      inventario: parcial,
      registros: [],
      diagnosticos: [],
      paginasPercorridas: 1,
    };
  });
  const recuperar = vi.fn(
    op.recuperar ?? ((e: EntradaRecuperacaoSefin) => Promise.resolve(recuperadoEmitida(e.chave, inv.periodoConsulta)))
  );
  const transporte: TransporteHttpMtls = {
    async consultar() {
      return { status: 200, body: gzipSync(Buffer.from('{}')) };
    },
  };
  return {
    descobrir,
    recuperar,
    transporte,
    provedorA1: new AdaptadorCertificadoA1({
      async carregar() {
        return { pfx: pfxValidade(SENHA, '2020-01-01', '2099-01-01'), passphrase: SENHA };
      },
    }),
    repositorio,
  };
}

async function fluxoSimples(
  inv: InventarioNfse,
  periodo: PeriodoConsultaPortal,
  execucaoId: string,
  op: {
    recuperar?: (entrada: EntradaRecuperacaoSefin) => Promise<ResultadoRecuperacaoSefin>;
    raizOverride?: string;
  } = {}
) {
  const criarRaiz = !op.raizOverride;
  const raizLocal = op.raizOverride ?? (await mkdtemp(path.join(tmpdir(), `nfse-${execucaoId}-`)));
  try {
    const deps = depsFluxo(inv, { ...op, raizOverride: raizLocal });
    return await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: periodo,
      execucaoId,
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raizLocal,
      dependencias: deps,
    });
  } finally {
    if (criarRaiz) await rm(raizLocal, { recursive: true, force: true });
  }
}

function pfxValidade(senha: string, notBefore: string, notAfter: string): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date(`${notBefore}T00:00:00Z`);
  certificado.validity.notAfter = new Date(`${notAfter}T00:00:00Z`);
  const attrs = [{ name: 'commonName', value: 'hom-sintetico' }];
  certificado.setSubject(attrs);
  certificado.setIssuer(attrs);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], senha);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

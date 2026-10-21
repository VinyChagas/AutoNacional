/**
 * API-01X — Exportação ADN → downloads operacionais (offline).
 * Sem rede ADN/Portal/SEFIN. Não altera checkpoints reais.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  montarCaminhoCompleto,
  validarArquivoBaixado,
} from '../../download-manager';
import {
  exportarAdnParaDownloadsOperacionais,
  exportarXmlAdnIdempotente,
  listarXmlsAdnCompetenciaOperacional,
  validarXmlsOperacionaisExportados,
} from './exportar-downloads-operacionais';

const CNPJ_A = '45517515000100';
const CNPJ_B = '11222333000181';
const CHAVE_E1 = '41069022228631747000167000000000003626090719238991';
const CHAVE_E2 = '41069022228631747000167000000000003626090719238992';
const CHAVE_R1 = '41069022252448489000162000000000005526095260389667';

function xmlMin(chave: string): string {
  return `<?xml version="1.0"?><NFSe><infNFSe><chNFSe>${chave}</chNFSe></infNFSe></NFSe>`;
}

describe('API-01X — exportação ADN → downloads', () => {
  let raizAdn: string;
  let raizDownloads: string;

  beforeEach(() => {
    raizAdn = fs.mkdtempSync(path.join(os.tmpdir(), 'adn-exp-src-'));
    raizDownloads = fs.mkdtempSync(path.join(os.tmpdir(), 'adn-exp-dst-'));
  });

  afterEach(() => {
    fs.rmSync(raizAdn, { recursive: true, force: true });
    fs.rmSync(raizDownloads, { recursive: true, force: true });
  });

  function seedEmpresa(
    cnpj: string,
    competencia: string,
    files: { pasta: string; nome: string; conteudo: string }[]
  ): void {
    const [ano, mes] = competencia.split('-');
    const base = path.join(raizAdn, cnpj, 'producao', ano!, mes!);
    for (const f of files) {
      const dir = path.join(base, f.pasta);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, f.nome), f.conteudo, 'utf8');
    }
  }

  it('primeira exportação copia Emitidas/Recebidas para contrato operacional', async () => {
    seedEmpresa(CNPJ_A, '2026-01', [
      { pasta: 'Emitidas', nome: `${CHAVE_E1}.xml`, conteudo: xmlMin(CHAVE_E1) },
      { pasta: 'Recebidas', nome: `${CHAVE_R1}.xml`, conteudo: xmlMin(CHAVE_R1) },
      { pasta: 'Eventos', nome: `${CHAVE_E1}__CANCEL__nsu1.xml`, conteudo: '<evento/>' },
      { pasta: 'Intermediadas', nome: 'inter.xml', conteudo: '<x/>' },
    ]);

    const r = await exportarAdnParaDownloadsOperacionais({
      cnpj: CNPJ_A,
      ambiente: 'producao',
      raizDocumentosAdn: raizAdn,
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
      downloadsBasePath: raizDownloads,
      nomeContabilidade: 'Contab Teste',
      mesExecucaoExtenso: 'outubro-2026',
      nomeEmpresa: 'Empresa A',
    });

    expect(r.ok).toBe(true);
    expect(r.encontrados).toBe(2);
    expect(r.copiados).toBe(2);
    expect(r.jaIguais).toBe(0);
    expect(r.omitidosEventos).toBe(1);
    expect(r.omitidosIntermediadas).toBe(1);
    expect(r.conflitos).toBe(0);

    const destE = path.join(
      montarCaminhoCompleto(raizDownloads, 'Contab Teste', 'outubro-2026', 'Empresa A', 'Emitidas'),
      `${CHAVE_E1}.xml`
    );
    const destR = path.join(
      montarCaminhoCompleto(raizDownloads, 'Contab Teste', 'outubro-2026', 'Empresa A', 'Recebidas'),
      `${CHAVE_R1}.xml`
    );
    expect(fs.existsSync(destE)).toBe(true);
    expect(fs.existsSync(destR)).toBe(true);
    // Originais preservados
    expect(
      fs.existsSync(path.join(raizAdn, CNPJ_A, 'producao', '2026', '01', 'Emitidas', `${CHAVE_E1}.xml`))
    ).toBe(true);

    const val = await validarXmlsOperacionaisExportados([destE, destR]);
    expect(val.ok).toBe(true);
    expect((await validarArquivoBaixado(destE, 'xml')).valid).toBe(true);
  });

  it('reexecução é idempotente sem duplicar', async () => {
    seedEmpresa(CNPJ_A, '2026-01', [
      { pasta: 'Emitidas', nome: `${CHAVE_E1}.xml`, conteudo: xmlMin(CHAVE_E1) },
    ]);
    const entrada = {
      cnpj: CNPJ_A,
      ambiente: 'producao' as const,
      raizDocumentosAdn: raizAdn,
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
      downloadsBasePath: raizDownloads,
      nomeContabilidade: 'Contab',
      mesExecucaoExtenso: 'outubro-2026',
      nomeEmpresa: 'Emp',
    };
    const a = await exportarAdnParaDownloadsOperacionais(entrada);
    const b = await exportarAdnParaDownloadsOperacionais(entrada);
    expect(a.copiados).toBe(1);
    expect(b.copiados).toBe(0);
    expect(b.jaIguais).toBe(1);
    expect(b.ok).toBe(true);

    const dir = montarCaminhoCompleto(raizDownloads, 'Contab', 'outubro-2026', 'Emp', 'Emitidas');
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.xml'))).toHaveLength(1);
  });

  it('competência sem documentos → ok com zero', async () => {
    seedEmpresa(CNPJ_A, '2025-06', [
      { pasta: 'Emitidas', nome: `${CHAVE_E1}.xml`, conteudo: xmlMin(CHAVE_E1) },
    ]);
    const r = await exportarAdnParaDownloadsOperacionais({
      cnpj: CNPJ_A,
      ambiente: 'producao',
      raizDocumentosAdn: raizAdn,
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
      downloadsBasePath: raizDownloads,
      nomeContabilidade: 'Contab',
      mesExecucaoExtenso: 'outubro-2026',
      nomeEmpresa: 'Emp',
    });
    expect(r.ok).toBe(true);
    expect(r.encontrados).toBe(0);
    expect(r.copiados).toBe(0);
  });

  it('múltiplas empresas isoladas', async () => {
    seedEmpresa(CNPJ_A, '2026-01', [
      { pasta: 'Emitidas', nome: `${CHAVE_E1}.xml`, conteudo: xmlMin(CHAVE_E1) },
    ]);
    seedEmpresa(CNPJ_B, '2026-01', [
      { pasta: 'Recebidas', nome: `${CHAVE_R1}.xml`, conteudo: xmlMin(CHAVE_R1) },
    ]);

    const a = await exportarAdnParaDownloadsOperacionais({
      cnpj: CNPJ_A,
      ambiente: 'producao',
      raizDocumentosAdn: raizAdn,
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
      downloadsBasePath: raizDownloads,
      nomeContabilidade: 'Contab',
      mesExecucaoExtenso: 'outubro-2026',
      nomeEmpresa: 'Empresa A',
    });
    const b = await exportarAdnParaDownloadsOperacionais({
      cnpj: CNPJ_B,
      ambiente: 'producao',
      raizDocumentosAdn: raizAdn,
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
      downloadsBasePath: raizDownloads,
      nomeContabilidade: 'Contab',
      mesExecucaoExtenso: 'outubro-2026',
      nomeEmpresa: 'Empresa B',
    });

    expect(a.copiados).toBe(1);
    expect(b.copiados).toBe(1);
    expect(
      fs.existsSync(
        path.join(
          montarCaminhoCompleto(raizDownloads, 'Contab', 'outubro-2026', 'Empresa A', 'Emitidas'),
          `${CHAVE_E1}.xml`
        )
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          montarCaminhoCompleto(raizDownloads, 'Contab', 'outubro-2026', 'Empresa B', 'Recebidas'),
          `${CHAVE_R1}.xml`
        )
      )
    ).toBe(true);
    // Isolamento: A não recebe arquivo de B
    expect(
      fs.existsSync(
        path.join(
          montarCaminhoCompleto(raizDownloads, 'Contab', 'outubro-2026', 'Empresa A', 'Recebidas'),
          `${CHAVE_R1}.xml`
        )
      )
    ).toBe(false);
  });

  it('falha parcial de escrita (conflito) → ok=false e origem intacta', async () => {
    seedEmpresa(CNPJ_A, '2026-01', [
      { pasta: 'Emitidas', nome: `${CHAVE_E1}.xml`, conteudo: xmlMin(CHAVE_E1) },
      { pasta: 'Emitidas', nome: `${CHAVE_E2}.xml`, conteudo: xmlMin(CHAVE_E2) },
    ]);
    const destDir = montarCaminhoCompleto(
      raizDownloads,
      'Contab',
      'outubro-2026',
      'Emp',
      'Emitidas'
    );
    fs.mkdirSync(destDir, { recursive: true });
    // Destino divergente para E1
    fs.writeFileSync(path.join(destDir, `${CHAVE_E1}.xml`), '<outro/>', 'utf8');

    const r = await exportarAdnParaDownloadsOperacionais({
      cnpj: CNPJ_A,
      ambiente: 'producao',
      raizDocumentosAdn: raizAdn,
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
      downloadsBasePath: raizDownloads,
      nomeContabilidade: 'Contab',
      mesExecucaoExtenso: 'outubro-2026',
      nomeEmpresa: 'Emp',
    });

    expect(r.ok).toBe(false);
    expect(r.conflitos).toBe(1);
    expect(r.copiados).toBe(1); // E2 copiado
    expect(r.codigoErro).toBe('ADN_EXPORT_FALHOU');
    expect(
      fs.readFileSync(path.join(raizAdn, CNPJ_A, 'producao', '2026', '01', 'Emitidas', `${CHAVE_E1}.xml`), 'utf8')
    ).toBe(xmlMin(CHAVE_E1));
    // Destino divergente NÃO sobrescrito
    expect(fs.readFileSync(path.join(destDir, `${CHAVE_E1}.xml`), 'utf8')).toBe('<outro/>');
  });

  it('exportarXmlAdnIdempotente: conflito e ja_igual', async () => {
    const src = path.join(raizAdn, 'a.xml');
    const dst = path.join(raizDownloads, 'a.xml');
    fs.writeFileSync(src, xmlMin(CHAVE_E1));
    expect(await exportarXmlAdnIdempotente(src, dst)).toBe('copiado');
    expect(await exportarXmlAdnIdempotente(src, dst)).toBe('ja_igual');
    fs.writeFileSync(dst, '<x/>');
    expect(await exportarXmlAdnIdempotente(src, dst)).toBe('conflito');
    expect(fs.readFileSync(src, 'utf8')).toBe(xmlMin(CHAVE_E1));
  });

  it('listagem separa emitidas/recebidas e omite eventos', () => {
    seedEmpresa(CNPJ_A, '2026-01', [
      { pasta: 'Emitidas', nome: `${CHAVE_E1}.xml`, conteudo: xmlMin(CHAVE_E1) },
      { pasta: 'Recebidas', nome: `${CHAVE_R1}.xml`, conteudo: xmlMin(CHAVE_R1) },
      { pasta: 'Eventos', nome: 'ev.xml', conteudo: '<e/>' },
    ]);
    const l = listarXmlsAdnCompetenciaOperacional({
      raizDocumentosAdn: raizAdn,
      cnpj: CNPJ_A,
      ambiente: 'producao',
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
    });
    expect(l.xmls).toHaveLength(2);
    expect(l.xmls.filter((x) => x.tipoNota === 'Emitidas')).toHaveLength(1);
    expect(l.xmls.filter((x) => x.tipoNota === 'Recebidas')).toHaveLength(1);
    expect(l.omitidosEventos).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ContratoNfseError,
  METODO_PARA_TIPO_AUTENTICACAO,
  MOTORES_PROCESSAMENTO,
  PERIODO_CONSULTA_PORTAL,
  auditarRecuperacao,
  bloqueiaProcessamentoAutomatico,
  consolidarResultadoExecucao,
  criarCompetenciaFiscalXml,
  criarDocumentoFiscal,
  criarPeriodoConsultaPortal,
  criarRecuperacaoDocumento,
  documentoPermaneceNoInventario,
  entraNaExportacaoXmlVigentes,
  entraNaRecuperacaoSefin,
  montarInventario,
  montarPlanoRecuperacao,
  motorAssociadoAoMetodo,
  projetarContagensSse,
  statusPersistivelEmExecucoes,
  validarChaveNacional,
  validarSituacaoFiscal,
  type DirecaoDocumentoFiscal,
  type DocumentoFiscalNfse,
  type InventarioNfse,
  type SituacaoDocumentoFiscal,
} from './index';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const CNPJ_FORMATADO = '12.345.678/0001-99';
const CNPJ = '12345678000199';

function chave(final: number): string {
  return String(final).padStart(50, '9');
}

const periodo = criarPeriodoConsultaPortal('01/01/2026', '31/01/2026');

function documento(params: {
  final: number;
  direcao: DirecaoDocumentoFiscal;
  situacao: SituacaoDocumentoFiscal;
  dCompet?: string;
  periodoConsulta?: ReturnType<typeof criarPeriodoConsultaPortal>;
}): DocumentoFiscalNfse {
  return criarDocumentoFiscal({
    chaveNacional: chave(params.final),
    cnpj: CNPJ_FORMATADO,
    direcao: params.direcao,
    situacao: params.situacao,
    periodoConsulta: params.periodoConsulta ?? periodo,
    competenciaFiscalXml: params.dCompet ? criarCompetenciaFiscalXml(params.dCompet) : undefined,
  });
}

function inventario(
  documentos: DocumentoFiscalNfse[],
  completude: 'COMPLETO' | 'PARCIAL' | 'INDETERMINADO' = 'COMPLETO'
): InventarioNfse {
  return montarInventario({
    id: 'inv-2026-01',
    cnpj: CNPJ_FORMATADO,
    periodoConsulta: periodo,
    documentos,
    completude,
  });
}

function recuperado(
  final: number,
  hash: string,
  resultado: 'RECUPERADO' | 'REUTILIZADO' = 'RECUPERADO'
) {
  return criarRecuperacaoDocumento({
    chaveNacional: chave(final),
    resultado,
    caminhoXml: `nfse/${chave(final)}.xml`,
    hashSha256: hash,
  });
}

describe('documento fiscal', () => {
  it('aceita chave nacional de 50 dígitos e rejeita a chave de 44 do fluxo atual', () => {
    expect(validarChaveNacional(chave(1))).toHaveLength(50);
    const doc = documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE' });
    expect(doc.chaveNacional).toBe(chave(1));
    expect(doc.cnpj).toBe(CNPJ);

    expect(() => validarChaveNacional('1'.repeat(44))).toThrow(ContratoNfseError);
    expect(() => validarChaveNacional('1'.repeat(49))).toThrow(/50 dígitos/);
    expect(() => validarChaveNacional(`${'1'.repeat(49)}A`)).toThrow(ContratoNfseError);
  });

  it('aceita somente as situações vigente, cancelada e indeterminada', () => {
    expect(validarSituacaoFiscal('VIGENTE')).toBe('VIGENTE');
    expect(validarSituacaoFiscal('CANCELADA')).toBe('CANCELADA');
    expect(validarSituacaoFiscal('INDETERMINADA')).toBe('INDETERMINADA');
    expect(() => validarSituacaoFiscal('cancelada')).toThrow(ContratoNfseError);
    expect(() => validarSituacaoFiscal('ATIVA')).toThrow(/não permitida/);
  });
});

describe('inventário', () => {
  it('conta emitidas e recebidas descobertas no mesmo período', () => {
    const inv = inventario([
      documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE' }),
      documento({ final: 2, direcao: 'EMITIDA', situacao: 'VIGENTE' }),
      documento({ final: 3, direcao: 'RECEBIDA', situacao: 'VIGENTE' }),
    ]);

    expect(inv.id).toBe('inv-2026-01');
    expect(inv.cnpj).toBe(CNPJ);
    expect(inv.periodoConsulta.tipo).toBe(PERIODO_CONSULTA_PORTAL);
    expect(inv.completude).toBe('COMPLETO');
    expect(inv.totais).toMatchObject({
      descobertos: 3,
      emitidas: 2,
      recebidas: 1,
      vigentes: 3,
      canceladas: 0,
      indeterminadas: 0,
    });
  });

  it('mantém cancelada no inventário e fora da recuperação e da exportação', () => {
    const vigente = documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE' });
    const cancelada = documento({ final: 2, direcao: 'EMITIDA', situacao: 'CANCELADA' });
    const inv = inventario([vigente, cancelada]);

    expect(inv.documentos.map((item) => item.situacao)).toEqual(['VIGENTE', 'CANCELADA']);
    expect(inv.totais.canceladas).toBe(1);
    expect(inv.totais.descobertos).toBe(2);
    expect(entraNaRecuperacaoSefin(cancelada)).toBe(false);
    expect(entraNaExportacaoXmlVigentes(cancelada)).toBe(false);
    expect(entraNaRecuperacaoSefin(vigente)).toBe(true);
    expect(bloqueiaProcessamentoAutomatico(cancelada)).toBe(false);

    const plano = montarPlanoRecuperacao(inv);
    expect(plano.map((item) => item.chaveNacional)).toEqual([vigente.chaveNacional]);

    const indevida = criarRecuperacaoDocumento({
      chaveNacional: cancelada.chaveNacional,
      resultado: 'RECUPERADO',
      caminhoXml: 'xml/cancelada.xml',
      hashSha256: HASH_A,
    });
    const auditoria = auditarRecuperacao(inv, [recuperado(1, HASH_B), indevida]);
    expect(auditoria.canceladasExcluidas).toBe(0);
    expect(auditoria.coberturaVigentes).toBe(1);
    expect(auditoria.statusAprovacao).toBe('REPROVADA');

    const resultado = consolidarResultadoExecucao({
      execucaoId: 'exec-cancelada',
      metodoAutenticacao: 'CERTIFICADO',
      motor: 'SEFIN_A1',
      inventario: inv,
      recuperacoes: [recuperado(1, HASH_B), indevida],
    });
    expect(resultado.status).toBe('FALHOU');
  });

  it('conta vigentes sem incluir canceladas nem indeterminadas', () => {
    const inv = inventario([
      documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE' }),
      documento({ final: 2, direcao: 'RECEBIDA', situacao: 'VIGENTE' }),
      documento({ final: 3, direcao: 'EMITIDA', situacao: 'CANCELADA' }),
      documento({ final: 4, direcao: 'RECEBIDA', situacao: 'INDETERMINADA' }),
    ]);

    expect(inv.totais.vigentes).toBe(2);
    expect(inv.totais.canceladas).toBe(1);
    expect(inv.totais.indeterminadas).toBe(1);
    expect(inv.totais.emitidas).toBe(2);
    expect(inv.totais.recebidas).toBe(2);
    expect(projetarContagensSse(inv)).toEqual({
      qtd_emitidas: 1,
      qtd_recebidas: 1,
      qtd_canceladas: 1,
    });
  });

  it('mantém o documento quando dCompet difere do período consultado', () => {
    const alinhada = documento({
      final: 1,
      direcao: 'EMITIDA',
      situacao: 'VIGENTE',
      dCompet: '2026-01',
    });
    const divergente = documento({
      final: 2,
      direcao: 'RECEBIDA',
      situacao: 'VIGENTE',
      dCompet: '2025-12',
    });

    expect(documentoPermaneceNoInventario(divergente, periodo)).toBe(true);
    expect(divergente.competenciaFiscalXml?.tipo).toBe('COMPETENCIA_FISCAL_XML');
    expect(divergente.periodoConsulta).toEqual(periodo);

    const inv = inventario([alinhada, divergente]);
    expect(inv.documentos).toHaveLength(2);
    expect(inv.totais.vigentes).toBe(2);
    expect(inv.documentos.map((item) => item.competenciaFiscalXml?.dCompet).sort()).toEqual([
      '2025-12',
      '2026-01',
    ]);

    expect(() => criarPeriodoConsultaPortal('2026-01-01', '2026-01-31')).toThrow(/DD\/MM\/YYYY/);

    const outroPeriodo = criarPeriodoConsultaPortal('01/02/2026', '28/02/2026');
    const foraDoPeriodo = documento({
      final: 3,
      direcao: 'EMITIDA',
      situacao: 'VIGENTE',
      dCompet: '2026-01',
      periodoConsulta: outroPeriodo,
    });
    expect(documentoPermaneceNoInventario(foraDoPeriodo, periodo)).toBe(false);
    expect(() => inventario([divergente, foraDoPeriodo])).toThrow(/outro período consultado/);
  });
});

describe('recuperação', () => {
  it('deixa vigentes pendentes, omite canceladas e bloqueia indeterminadas', () => {
    const inv = inventario([
      documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE' }),
      documento({ final: 2, direcao: 'RECEBIDA', situacao: 'VIGENTE' }),
      documento({ final: 3, direcao: 'EMITIDA', situacao: 'CANCELADA' }),
      documento({ final: 4, direcao: 'RECEBIDA', situacao: 'INDETERMINADA' }),
    ]);
    const plano = montarPlanoRecuperacao(inv);

    expect(plano.filter((item) => item.resultado === 'PENDENTE')).toHaveLength(2);
    expect(plano.some((item) => item.chaveNacional === chave(3))).toBe(false);
    const bloqueada = plano.find((item) => item.chaveNacional === chave(4));
    expect(bloqueada?.resultado).toBe('BLOQUEADO');
    expect(bloqueada?.caminhoXml).toBeUndefined();
    expect(bloqueada?.motivoFalha).toMatch(/indeterminada/i);
    expect(() =>
      criarRecuperacaoDocumento({
        chaveNacional: chave(1),
        resultado: 'FALHOU',
      })
    ).toThrow(/exige motivo/);

    const resultado = consolidarResultadoExecucao({
      execucaoId: 'exec-pendente',
      metodoAutenticacao: 'CERTIFICADO',
      motor: 'SEFIN_A1',
      inventario: inv,
      recuperacoes: plano,
    });
    expect(resultado.status).toBe('BLOQUEADA');
    expect(resultado.contagens.pendentes).toBe(2);
    expect(resultado.contagens.bloqueados).toBe(1);
    expect(resultado.auditoria.xmlsAusentes).toBe(2);
    expect(statusPersistivelEmExecucoes(resultado.status)).toBeNull();
    expect(resultado.pendencias.map((item) => item.codigo)).toEqual(
      expect.arrayContaining(['SITUACAO_INDETERMINADA', 'RECUPERACAO_PENDENTE'])
    );
  });
});

describe('auditoria', () => {
  it('aprova cobertura integral quando cada vigente tem um XML e a cancelada ficou de fora', () => {
    const inv = inventario([
      documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE', dCompet: '2025-11' }),
      documento({ final: 2, direcao: 'RECEBIDA', situacao: 'VIGENTE', dCompet: '2026-01' }),
      documento({ final: 3, direcao: 'EMITIDA', situacao: 'CANCELADA' }),
    ]);
    const auditoria = auditarRecuperacao(inv, [
      recuperado(1, HASH_A, 'RECUPERADO'),
      recuperado(2, HASH_B, 'REUTILIZADO'),
    ]);

    expect(auditoria).toEqual({
      totalVigentes: 2,
      xmlsValidos: 2,
      xmlsAusentes: 0,
      xmlsInvalidos: 0,
      xmlsDuplicados: 0,
      canceladasExcluidas: 1,
      coberturaVigentes: 1,
      statusAprovacao: 'APROVADA',
    });
  });

  it('reprova cobertura parcial quando falta XML de vigente', () => {
    const inv = inventario([
      documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE' }),
      documento({ final: 2, direcao: 'RECEBIDA', situacao: 'VIGENTE' }),
      documento({ final: 3, direcao: 'EMITIDA', situacao: 'CANCELADA' }),
    ]);
    const auditoria = auditarRecuperacao(inv, [
      recuperado(1, HASH_A),
      criarRecuperacaoDocumento({ chaveNacional: chave(2), resultado: 'PENDENTE' }),
    ]);

    expect(auditoria.totalVigentes).toBe(2);
    expect(auditoria.xmlsValidos).toBe(1);
    expect(auditoria.xmlsAusentes).toBe(1);
    expect(auditoria.xmlsInvalidos).toBe(0);
    expect(auditoria.xmlsDuplicados).toBe(0);
    expect(auditoria.canceladasExcluidas).toBe(1);
    expect(auditoria.coberturaVigentes).toBe(0.5);
    expect(auditoria.statusAprovacao).toBe('REPROVADA');

    const resultado = consolidarResultadoExecucao({
      execucaoId: 'exec-parcial',
      metodoAutenticacao: 'CERTIFICADO',
      motor: 'SEFIN_A1',
      inventario: inv,
      recuperacoes: [
        recuperado(1, HASH_A),
        criarRecuperacaoDocumento({ chaveNacional: chave(2), resultado: 'PENDENTE' }),
      ],
    });
    expect(resultado.status).toBe('PENDENTE');
    expect(resultado.contagens.pendentes).toBe(1);
    expect(resultado.contagens.vigentes).toBe(2);
  });

  it('reprova XML válido duplicado e XML de recuperação falha', () => {
    const inv = inventario([
      documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE' }),
      documento({ final: 2, direcao: 'RECEBIDA', situacao: 'VIGENTE' }),
    ]);
    const duplicada = auditarRecuperacao(inv, [
      recuperado(1, HASH_A),
      criarRecuperacaoDocumento({
        chaveNacional: chave(1),
        resultado: 'REUTILIZADO',
        caminhoXml: 'outro.xml',
        hashSha256: HASH_B,
      }),
      recuperado(2, HASH_B),
    ]);
    expect(duplicada.xmlsValidos).toBe(3);
    expect(duplicada.xmlsDuplicados).toBe(1);
    expect(duplicada.coberturaVigentes).toBe(0.5);
    expect(duplicada.statusAprovacao).toBe('REPROVADA');

    const falha = criarRecuperacaoDocumento({
      chaveNacional: chave(1),
      resultado: 'FALHOU',
      motivoFalha: 'SEFIN recusou o certificado.',
    });
    const invalida = auditarRecuperacao(
      inventario([documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE' })]),
      [falha]
    );
    expect(invalida.xmlsInvalidos).toBe(1);
    expect(invalida.xmlsAusentes).toBe(0);
    expect(invalida.statusAprovacao).toBe('REPROVADA');
  });
});

describe('execução', () => {
  it('consolida o resultado aprovado sem usar dCompet como filtro', () => {
    const inv = inventario([
      documento({ final: 1, direcao: 'EMITIDA', situacao: 'VIGENTE', dCompet: '2025-12' }),
      documento({ final: 2, direcao: 'RECEBIDA', situacao: 'VIGENTE', dCompet: '2026-01' }),
      documento({ final: 3, direcao: 'EMITIDA', situacao: 'CANCELADA', dCompet: '2024-01' }),
    ]);
    const resultado = consolidarResultadoExecucao({
      execucaoId: 'exec-2026-01',
      metodoAutenticacao: 'CERTIFICADO',
      motor: 'SEFIN_A1',
      inventario: inv,
      recuperacoes: [recuperado(1, HASH_A), recuperado(2, HASH_B, 'REUTILIZADO')],
      artefatos: {
        diretorioBase: 'downloads/nfse/12345678000199',
        diretorioXmlVigentes: 'downloads/nfse/12345678000199/vigentes',
      },
    });

    expect(resultado.execucaoId).toBe('exec-2026-01');
    expect(resultado.cnpj).toBe(CNPJ);
    expect(resultado.periodoConsulta).toEqual({
      tipo: PERIODO_CONSULTA_PORTAL,
      inicio: '01/01/2026',
      fim: '31/01/2026',
    });
    expect(resultado.metodoAutenticacao).toBe('CERTIFICADO');
    expect(resultado.motor).toBe('SEFIN_A1');
    expect(resultado.status).toBe('CONCLUIDA');
    expect(statusPersistivelEmExecucoes(resultado.status)).toBe('concluido');
    expect(resultado.contagens).toEqual({
      emitidas: 2,
      recebidas: 1,
      vigentes: 2,
      canceladas: 1,
      indeterminadas: 0,
      recuperados: 1,
      reutilizados: 1,
      pendentes: 0,
      falhos: 0,
      bloqueados: 0,
    });
    expect(resultado.contagensCompativeis).toEqual({
      qtd_emitidas: 1,
      qtd_recebidas: 1,
      qtd_canceladas: 1,
    });
    expect(resultado.auditoria.statusAprovacao).toBe('APROVADA');
    expect(resultado.auditoria.coberturaVigentes).toBe(1);
    expect(resultado.erros).toEqual([]);
    expect(resultado.pendencias).toEqual([]);
    expect(resultado.inventario.documentos).toHaveLength(3);
    expect(resultado.artefatos.diretorioXmlVigentes).toBe(
      'downloads/nfse/12345678000199/vigentes'
    );
    expect(motorAssociadoAoMetodo('CERTIFICADO')).toBe('SEFIN_A1');
    expect(motorAssociadoAoMetodo('CREDENCIAL')).toBe('PORTAL_BROWSER');
    expect(MOTORES_PROCESSAMENTO.map((item) => item.nome)).toEqual([
      'Recuperação SEFIN com certificado A1',
      'Download pelo navegador do Portal Nacional',
    ]);
    expect(METODO_PARA_TIPO_AUTENTICACAO).toEqual({
      CERTIFICADO: 'certificado',
      CREDENCIAL: 'credenciais',
    });
    expect(() =>
      consolidarResultadoExecucao({
        execucaoId: 'exec-motor',
        metodoAutenticacao: 'CERTIFICADO',
        motor: 'PORTAL_BROWSER',
        inventario: inv,
        recuperacoes: [],
      })
    ).toThrow(/não está associado/);
  });
});

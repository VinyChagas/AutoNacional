/**
 * UI-01d — testes da visão fiscal (Inventário / Validação / Recuperação).
 * Sem navegador real / Portal / Backend.
 */
import {
  isDiscoveryOnlyResultado,
  mapearAutenticacao,
  mapearInventario,
  mapearRecuperacao,
  mapearValidacao,
  mapearVisaoFiscal,
} from './execution-fiscal-view.model';
import type { ExecutionRow } from './execution-row.model';

function row(partial: Partial<ExecutionRow> & Pick<ExecutionRow, 'metodo' | 'status'>): ExecutionRow {
  return {
    empresa_id: partial.empresa_id ?? 1,
    cnpj: partial.cnpj ?? '12345678000199',
    razao_social: partial.razao_social ?? 'Empresa Teste',
    metodo: partial.metodo,
    qtd_emitidas: partial.qtd_emitidas ?? 0,
    qtd_recebidas: partial.qtd_recebidas ?? 0,
    qtd_canceladas: partial.qtd_canceladas ?? 0,
    status: partial.status,
    mensagem: partial.mensagem ?? '',
    ultimo_stage: partial.ultimo_stage,
    resultado_final: partial.resultado_final,
  };
}

describe('UI-01d mapearVisaoFiscal', () => {
  it('1. Empresa A1 — rótulo Certificado A1', () => {
    const v = mapearAutenticacao(row({ metodo: 'CERTIFICADO', status: 'FILA' }));
    expect(v.rotulo).toBe('Certificado A1');
    expect(v.aguardandoCaptcha).toBe(false);
  });

  it('2. Empresa com credenciais', () => {
    const v = mapearAutenticacao(row({ metodo: 'CREDENCIAL', status: 'EM_EXECUCAO' }));
    expect(v.rotulo).toBe('Credenciais');
    expect(v.metodo).toBe('CREDENCIAL');
  });

  it('3. Aguardando CAPTCHA — destaque na autenticação', () => {
    const v = mapearAutenticacao(
      row({ metodo: 'CREDENCIAL', status: 'AGUARDANDO_CAPTCHA', mensagem: 'Aguardando resolução manual' })
    );
    expect(v.aguardandoCaptcha).toBe(true);
    expect(mapearInventario(row({ metodo: 'CREDENCIAL', status: 'AGUARDANDO_CAPTCHA' })).estado).toBe(
      'Em andamento'
    );
  });

  it('4. Contagens disponíveis — inventário exibe E/R/C/Total', () => {
    const inv = mapearInventario(
      row({
        metodo: 'CERTIFICADO',
        status: 'OK',
        qtd_emitidas: 3,
        qtd_recebidas: 2,
        qtd_canceladas: 1,
      })
    );
    expect(inv.exibirContagens).toBe(true);
    expect(inv.contagens).toEqual({ emitidas: 3, recebidas: 2, canceladas: 1, total: 5 });
    expect(inv.estado).toBe('Concluído');
  });

  it('5. Contagens ausentes em fila — não exibe números', () => {
    const inv = mapearInventario(row({ metodo: 'CERTIFICADO', status: 'FILA' }));
    expect(inv.exibirContagens).toBe(false);
    expect(inv.estado).toBe('Aguardando');
  });

  it('6. Execução legada OK — validação/recuperação sem evidência nativa', () => {
    const v = mapearVisaoFiscal(
      row({
        metodo: 'CERTIFICADO',
        status: 'OK',
        qtd_emitidas: 1,
        resultado_final: 'NFS_ENCONTRADAS',
      })
    );
    expect(v.validacao.estado).toBe('Não disponível');
    expect(v.recuperacao.estado).toBe('Não disponível');
    expect(v.recuperacao.exibirProgresso).toBe(false);
    expect(v.discoveryOnly).toBe(false);
  });

  it('7. Discovery-Only — nunca recuperação concluída', () => {
    expect(isDiscoveryOnlyResultado('HOMOLOGACAO_DISCOVERY_ONLY_CONCLUIDA')).toBe(true);
    const v = mapearVisaoFiscal(
      row({
        metodo: 'CERTIFICADO',
        status: 'OK',
        qtd_emitidas: 10,
        qtd_recebidas: 5,
        resultado_final: 'HOMOLOGACAO_DISCOVERY_ONLY_CONCLUIDA',
      })
    );
    expect(v.discoveryOnly).toBe(true);
    expect(v.recuperacao.estado).toBe('Não executada');
    expect(v.recuperacao.exibirProgresso).toBe(false);
    expect(v.inventario.estado).toBe('Concluído');
  });

  it('7b. Discovery cancelada/bloqueada — inventário Falha, recuperação não executada', () => {
    const cancelada = mapearVisaoFiscal(
      row({
        metodo: 'CERTIFICADO',
        status: 'OK',
        resultado_final: 'HOMOLOGACAO_DISCOVERY_ONLY_CANCELADA',
      })
    );
    expect(cancelada.inventario.estado).toBe('Falha');
    expect(cancelada.recuperacao.estado).toBe('Não executada');
    const bloqueada = mapearVisaoFiscal(
      row({
        metodo: 'CERTIFICADO',
        status: 'OK',
        resultado_final: 'HOMOLOGACAO_DISCOVERY_ONLY_BLOQUEADA',
      })
    );
    expect(bloqueada.inventario.estado).toBe('Falha');
    expect(bloqueada.recuperacao.estado).toBe('Não executada');
  });

  it('8. Recuperação não executada em execução ativa', () => {
    const rec = mapearRecuperacao(row({ metodo: 'CERTIFICADO', status: 'EM_EXECUCAO' }));
    expect(rec.estado).toBe('Não executada');
  });

  it('9. Execução concluída — inventário Concluído + status OK', () => {
    const v = mapearVisaoFiscal(
      row({ metodo: 'CERTIFICADO', status: 'OK', qtd_emitidas: 0, qtd_recebidas: 0 })
    );
    expect(v.inventario.estado).toBe('Concluído');
    expect(v.inventario.exibirContagens).toBe(true);
    expect(v.status.status).toBe('OK');
  });

  it('10. Execução com erro — inventário Falha', () => {
    const inv = mapearInventario(
      row({
        metodo: 'CERTIFICADO',
        status: 'ERRO',
        mensagem: 'Falha na autenticação',
        qtd_emitidas: 0,
      })
    );
    expect(inv.estado).toBe('Falha');
    expect(inv.exibirContagens).toBe(false);
  });

  it('11. Inventário parcial (Discovery incompleto)', () => {
    const inv = mapearInventario(
      row({
        metodo: 'CERTIFICADO',
        status: 'OK',
        qtd_emitidas: 2,
        resultado_final: 'HOMOLOGACAO_DISCOVERY_ONLY_INCOMPLETA',
      })
    );
    expect(inv.estado).toBe('Incompleto');
    expect(inv.exibirContagens).toBe(true);
  });

  it('12. Atualização SSE (stage + counts) — em andamento com contagens', () => {
    const inv = mapearInventario(
      row({
        metodo: 'CERTIFICADO',
        status: 'EM_EXECUCAO',
        ultimo_stage: 'baixar_emitidas',
        qtd_emitidas: 4,
        qtd_recebidas: 0,
      })
    );
    expect(inv.estado).toBe('Em andamento');
    expect(inv.exibirContagens).toBe(true);
    expect(inv.contagens.emitidas).toBe(4);
  });

  it('13. Atualização polling — resultado_final e etapa refletidos', () => {
    const v = mapearVisaoFiscal(
      row({
        metodo: 'CREDENCIAL',
        status: 'OK',
        ultimo_stage: 'baixar_recebidas',
        resultado_final: 'NOTAS_RECEBIDAS',
        qtd_recebidas: 7,
      })
    );
    expect(v.inventario.contagens.recebidas).toBe(7);
    expect(v.validacao.estado).toBe('Não disponível');
  });

  it('14. Múltiplas empresas — mapeamentos independentes', () => {
    const a = mapearVisaoFiscal(row({ empresa_id: 1, metodo: 'CERTIFICADO', status: 'FILA' }));
    const b = mapearVisaoFiscal(
      row({
        empresa_id: 2,
        metodo: 'CREDENCIAL',
        status: 'AGUARDANDO_CAPTCHA',
        cnpj: '99888777000166',
      })
    );
    expect(a.autenticacao.rotulo).toBe('Certificado A1');
    expect(b.autenticacao.aguardandoCaptcha).toBe(true);
    expect(a.inventario.estado).toBe('Aguardando');
    expect(b.inventario.estado).toBe('Em andamento');
  });

  it('15. Preservação da Central — flag CAPTCHA não altera validação/recuperação', () => {
    const v = mapearVisaoFiscal(
      row({
        metodo: 'CREDENCIAL',
        status: 'AGUARDANDO_CAPTCHA',
        mensagem: 'Aguardando resolução MANUAL na Central',
      })
    );
    expect(v.autenticacao.aguardandoCaptcha).toBe(true);
    expect(v.validacao.estado).toBe('Não iniciada');
    expect(v.recuperacao.estado).toBe('Não executada');
    // Botão Central continua baseado em batchId + credenciais (componente), não neste mapper.
  });

  it('validação nunca Concluída sem evidência Backend', () => {
    expect(mapearValidacao(row({ metodo: 'CERTIFICADO', status: 'OK' })).estado).toBe(
      'Não disponível'
    );
    expect(mapearValidacao(row({ metodo: 'CERTIFICADO', status: 'FILA' })).estado).toBe(
      'Não iniciada'
    );
  });
});

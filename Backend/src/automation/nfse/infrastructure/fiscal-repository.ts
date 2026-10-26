/**
 * Repositório fiscal definitivo sobre o checkpoint do Commit 05.
 * Não duplica SHA-256, trava, reconciliação nem o parser fiscal.
 * Não escreve no diretório operacional de downloads.
 */
import type { InventarioNfse } from '../contracts/inventario';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import {
  CheckpointService,
  CheckpointStore,
  XmlStore,
  hashSha256Conteudo,
  reconciliarNfse,
  retomarExecucaoNfse,
  type ArquivoVerificadoNfse,
  type CheckpointNfse,
  type RelatorioReconciliacaoNfse,
  type ResultadoRetomadaNfse,
} from '../checkpoint';
import { LIMITES_RECUPERACAO_PADRAO } from '../recovery/types';
import { ErroRecuperacaoSefin } from '../recovery/types';
import { validarXmlNfse } from '../recovery/xml-validator';
import type { ResolvedorArmazenamentoFiscal } from './storage-resolver';
import {
  InfraestruturaNfseError,
  type AvaliacaoLoteExportacaoNfse,
  type DocumentoExportavelNfse,
  type ResultadoListagemExportacaoNfse,
} from './types';

export class RepositorioFiscalNfse {
  readonly checkpoints: CheckpointStore;
  readonly xmls: XmlStore;
  readonly servico: CheckpointService;

  constructor(
    private readonly resolvedor: ResolvedorArmazenamentoFiscal,
    agora?: () => string
  ) {
    this.checkpoints = new CheckpointStore(resolvedor.raizCheckpoints());
    this.xmls = new XmlStore(resolvedor.raizXml());
    this.servico = new CheckpointService(this.checkpoints, this.xmls, agora);
  }

  raiz(): string {
    return this.resolvedor.raiz();
  }

  /**
   * Exclusividade fiscal (Commit 05): uma trava por CNPJ+período cobrindo
   * a sequência crítica do orquestrador. Liberada no finally de comTrava.
   */
  async executarComExclusividadeFiscal<T>(
    cnpj: string,
    periodo: PeriodoConsultaPortal,
    operacao: () => Promise<T>
  ): Promise<T> {
    return this.checkpoints.comTrava(cnpj, periodo, operacao);
  }

  async criarCheckpoint(
    inventario: InventarioNfse,
    execucaoId: string,
    opcoes?: { jaComTrava?: boolean }
  ): Promise<CheckpointNfse> {
    return this.servico.criarCheckpoint(inventario, execucaoId, opcoes);
  }

  async persistirXml(
    inventario: InventarioNfse,
    chaveNacional: string,
    xml: string,
    opcoes?: { jaComTrava?: boolean }
  ): Promise<CheckpointNfse> {
    return this.servico.persistirXml(inventario, chaveNacional, xml, opcoes);
  }

  async retomar(
    inventario: InventarioNfse,
    opcoes?: { jaComTrava?: boolean }
  ): Promise<ResultadoRetomadaNfse> {
    return retomarExecucaoNfse({
      inventario,
      checkpointStore: this.checkpoints,
      xmlStore: this.xmls,
      jaComTrava: opcoes?.jaComTrava,
    });
  }

  async verificarArquivos(inventario: InventarioNfse): Promise<ArquivoVerificadoNfse[]> {
    const arquivos: ArquivoVerificadoNfse[] = [];
    for (const documento of inventario.documentos) {
      if (documento.situacao !== 'VIGENTE') continue;
      arquivos.push(
        await this.xmls.verificar(inventario.cnpj, inventario.periodoConsulta, documento.chaveNacional)
      );
    }
    return arquivos;
  }

  async reconciliar(
    inventario: InventarioNfse,
    checkpoint?: CheckpointNfse
  ): Promise<{ checkpoint: CheckpointNfse; relatorio: RelatorioReconciliacaoNfse }> {
    const atual =
      checkpoint ??
      (await this.checkpoints.carregar(inventario.cnpj, inventario.periodoConsulta));
    if (!atual) {
      throw new InfraestruturaNfseError('FALHA_LEITURA', 'Checkpoint ausente para reconciliar.');
    }
    const arquivos = await this.verificarArquivos(inventario);
    return { checkpoint: atual, relatorio: reconciliarNfse(inventario, atual, arquivos) };
  }

  /**
   * API-03M — aptos (vigentes) + aptosPendentesFiscais (indeterminadas com XML).
   * Exportação individual NÃO depende de reconciliação 100% / lote.liberado.
   * lote.liberado = lote contábil limpo (sem indeterminadas + RECONCILIADA).
   */
  async listarDocumentosExportaveis(inventario: InventarioNfse): Promise<ResultadoListagemExportacaoNfse> {
    const bloqueadoPorIndeterminada = inventario.documentos.some(
      (documento) => documento.situacao === 'INDETERMINADA'
    );
    const checkpoint = await this.checkpoints.carregar(inventario.cnpj, inventario.periodoConsulta);
    if (!checkpoint) {
      return {
        aptos: [],
        aptosPendentesFiscais: [],
        lote: {
          liberado: false,
          bloqueadoPorIndeterminada,
          motivos: ['Checkpoint ausente.'],
        },
      };
    }

    const aptos: DocumentoExportavelNfse[] = [];
    const aptosPendentesFiscais: DocumentoExportavelNfse[] = [];
    for (const documento of checkpoint.documentos) {
      if (documento.situacao === 'CANCELADA') continue;
      if (documento.estado !== 'PERSISTIDO') continue;
      if (!documento.hashSha256 || !documento.caminhoRelativo || !documento.tamanhoBytes) continue;
      if (documento.situacao !== 'VIGENTE' && documento.situacao !== 'INDETERMINADA') continue;

      const noInventario = inventario.documentos.find(
        (item) => item.chaveNacional === documento.chaveNacional
      );
      if (!noInventario || noInventario.cnpj !== inventario.cnpj) continue;
      if (noInventario.direcao !== documento.direcao) continue;
      if (noInventario.situacao !== documento.situacao) continue;

      const leitura = await this.xmls.lerLimitado(
        inventario.cnpj,
        inventario.periodoConsulta,
        documento.chaveNacional,
        LIMITES_RECUPERACAO_PADRAO.maxBytesXml
      );
      if (leitura.situacao !== 'lido') continue;
      if (
        leitura.tamanhoBytes <= 0 ||
        leitura.hashSha256 !== documento.hashSha256 ||
        leitura.tamanhoBytes !== documento.tamanhoBytes
      ) {
        continue;
      }

      let confirmado;
      try {
        confirmado = validarXmlNfse(leitura.conteudo.toString('utf8'), {
          chave: documento.chaveNacional,
          cnpj: inventario.cnpj,
          direcao: documento.direcao,
        });
      } catch (erro) {
        if (erro instanceof ErroRecuperacaoSefin) continue;
        throw erro;
      }
      if (confirmado.validacao !== 'CONFIRMADA' || confirmado.chaveXml !== documento.chaveNacional) {
        continue;
      }

      const exportavel: DocumentoExportavelNfse = {
        chaveNacional: documento.chaveNacional,
        direcao: documento.direcao,
        situacao: documento.situacao,
        caminhoRelativo: documento.caminhoRelativo,
        hashSha256: documento.hashSha256,
        tamanhoBytes: documento.tamanhoBytes,
        papelFiscal: confirmado.papelConfirmado,
      };
      if (documento.situacao === 'VIGENTE') aptos.push(exportavel);
      else aptosPendentesFiscais.push(exportavel);
    }

    const { relatorio } = await this.reconciliar(inventario, checkpoint);
    const lote = avaliarLoteExportacao(inventario, relatorio, aptos, bloqueadoPorIndeterminada);
    return { aptos, aptosPendentesFiscais, lote };
  }

  caminhoXml(cnpj: string, periodo: PeriodoConsultaPortal, chaveNacional: string): string {
    return this.xmls.caminhoArquivo(cnpj, periodo, chaveNacional);
  }

  hashConteudo(conteudo: Buffer): string {
    return hashSha256Conteudo(conteudo);
  }
}

export function avaliarLoteExportacao(
  inventario: InventarioNfse,
  reconciliacao: RelatorioReconciliacaoNfse,
  aptos: readonly DocumentoExportavelNfse[],
  bloqueadoPorIndeterminada: boolean
): AvaliacaoLoteExportacaoNfse {
  const motivos: string[] = [];
  if (inventario.completude !== 'COMPLETO') {
    motivos.push('Inventário sem completude COMPLETO.');
  }
  // API-03M — indeterminada impede só o lote contábil “limpo”, não a exportação dos vigentes.
  if (bloqueadoPorIndeterminada) {
    motivos.push('Lote contábil completo pendente: há situações fiscais não confirmadas.');
  }
  if (reconciliacao.conclusao !== 'RECONCILIADA') {
    motivos.push('Reconciliação fiscal ainda não RECONCILIADA.');
  }
  if (reconciliacao.inconsistencias > 0 || reconciliacao.divergenciasHash.length > 0) {
    motivos.push('Há inconsistência bloqueante.');
  }
  const vigentes = inventario.documentos.filter((documento) => documento.situacao === 'VIGENTE');
  if (aptos.length !== vigentes.length) {
    motivos.push('Nem todos os vigentes estão individualmente aptos à exportação.');
  }
  return {
    liberado: motivos.length === 0,
    bloqueadoPorIndeterminada,
    motivos,
  };
}

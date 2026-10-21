/**
 * Inventário ADN a partir do armazenamento persistido (CNPJ+ambiente).
 * Sessão vazia ≠ ausência de movimento fiscal na competência solicitada.
 * Nunca declara cobertura mensal completa.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import type { ClassificacaoDocumentoAdn, ResultadoSyncAdn } from './types';

export interface ContagensClassificacaoAdn {
  emitidas: number;
  recebidas: number;
  intermediadas: number;
  eventos: number;
  naoClassificados: number;
  xmlInvalidos: number;
}

export interface ContagensCompetenciaAdn extends ContagensClassificacaoAdn {
  competencia: string; // YYYY-MM
  totalArquivos: number;
}

export interface ConsolidacaoInventarioPersistidoAdn {
  cnpj: string;
  ambiente: AmbienteAdn;
  /** Competências cobertas pelo período solicitado (YYYY-MM). */
  competenciasSolicitadas: string[];
  /** Contagens apenas das competências do período. */
  porCompetencia: ContagensCompetenciaAdn[];
  /** Soma do período solicitado. */
  periodo: ContagensClassificacaoAdn & {
    totalArquivos: number;
    nfsEmitidasRecebidas: number;
  };
  /** Totais no armazenamento do CNPJ/ambiente (todas as competências). */
  armazenadoTotal: ContagensClassificacaoAdn & {
    totalArquivos: number;
    chavesIndice: number | null;
  };
  /** Documentos novos apenas desta sessão de sync. */
  sessao: ContagensClassificacaoAdn & {
    totalDocumentos: number;
    novosPersistiveis: number;
  };
  /**
   * Estado da distribuição ADN desta sessão.
   * Nunca misturar com inventário da competência para resultado_final.
   */
  distribuicao: {
    status: ResultadoSyncAdn['status'];
    fimDistribuicaoConfirmado: boolean;
  };
  /** Consulta ao índice/disco bem-sucedida. */
  evidenciaPersistenciaOk: boolean;
}

export interface FonteInventarioPersistidoAdn {
  contarArquivos(params: {
    cnpj: string;
    ambiente: AmbienteAdn;
    /** null = todas as competências conhecidas na fonte. */
    competencias: string[] | null;
  }): Promise<{
    porCompetencia: ContagensCompetenciaAdn[];
    chavesIndice: number | null;
  }>;
}

const PASTAS: Array<{ pasta: string; campo: keyof ContagensClassificacaoAdn }> = [
  { pasta: 'Emitidas', campo: 'emitidas' },
  { pasta: 'Recebidas', campo: 'recebidas' },
  { pasta: 'Intermediadas', campo: 'intermediadas' },
  { pasta: 'Eventos', campo: 'eventos' },
  { pasta: '_nao_classificados', campo: 'naoClassificados' },
  { pasta: '_xml_invalidos', campo: 'xmlInvalidos' },
];

function zerosClassificacao(): ContagensClassificacaoAdn {
  return {
    emitidas: 0,
    recebidas: 0,
    intermediadas: 0,
    eventos: 0,
    naoClassificados: 0,
    xmlInvalidos: 0,
  };
}

function somarClassificacao(
  a: ContagensClassificacaoAdn,
  b: ContagensClassificacaoAdn
): ContagensClassificacaoAdn {
  return {
    emitidas: a.emitidas + b.emitidas,
    recebidas: a.recebidas + b.recebidas,
    intermediadas: a.intermediadas + b.intermediadas,
    eventos: a.eventos + b.eventos,
    naoClassificados: a.naoClassificados + b.naoClassificados,
    xmlInvalidos: a.xmlInvalidos + b.xmlInvalidos,
  };
}

function totalArquivosDe(c: ContagensClassificacaoAdn): number {
  return (
    c.emitidas +
    c.recebidas +
    c.intermediadas +
    c.eventos +
    c.naoClassificados +
    c.xmlInvalidos
  );
}

/** Converte DD/MM/YYYY ou YYYY-MM-DD em lista inclusiva de YYYY-MM. */
export function listarCompetenciasDoPeriodo(inicio: string, fim: string): string[] {
  const parse = (s: string): { y: number; m: number } | null => {
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
    if (br) return { y: Number(br[3]), m: Number(br[2]) };
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (iso) return { y: Number(iso[1]), m: Number(iso[2]) };
    const ym = /^(\d{4})-(\d{2})$/.exec(s.trim());
    if (ym) return { y: Number(ym[1]), m: Number(ym[2]) };
    return null;
  };
  const a = parse(inicio);
  const b = parse(fim);
  if (!a || !b) {
    throw new ErroAdn('PERIODO_INVALIDO', 'PERMANENTE', 'Período inválido para inventário ADN persistido.');
  }
  let y = a.y;
  let m = a.m;
  const out: string[] = [];
  const guard = 240;
  for (let i = 0; i < guard; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (y === b.y && m === b.m) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function contarXmlEmDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.xml')) n += 1;
  }
  return n;
}

function contarCompetenciaDir(baseComp: string, competencia: string): ContagensCompetenciaAdn {
  const c = zerosClassificacao();
  for (const { pasta, campo } of PASTAS) {
    c[campo] = contarXmlEmDir(path.join(baseComp, pasta));
  }
  return {
    competencia,
    ...c,
    totalArquivos: totalArquivosDe(c),
  };
}

/**
 * Fonte filesystem alinhada ao DocumentStoreArquivoAdn:
 * raiz/cnpj/ambiente/YYYY/MM/{Emitidas|Recebidas|...}
 */
export class InventarioPersistidoArquivoAdn implements FonteInventarioPersistidoAdn {
  constructor(private readonly raizDocumentos: string) {}

  private baseCnpj(cnpj: string, ambiente: AmbienteAdn): string {
    const digitos = cnpj.replace(/\D/g, '');
    if (!/^\d{14}$/.test(digitos)) {
      throw new ErroAdn('CNPJ_INVALIDO', 'PERMANENTE', 'CNPJ inválido para inventário persistido.');
    }
    if (ambiente !== 'producao' && ambiente !== 'producao-restrita') {
      throw new ErroAdn('AMBIENTE_INVALIDO', 'PERMANENTE', 'Ambiente ADN inválido.');
    }
    return path.join(path.resolve(this.raizDocumentos), digitos, ambiente);
  }

  private listarCompetenciasDisco(base: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(base)) return out;
    for (const anoEnt of fs.readdirSync(base, { withFileTypes: true })) {
      if (!anoEnt.isDirectory() || !/^\d{4}$/.test(anoEnt.name)) continue;
      const anoDir = path.join(base, anoEnt.name);
      for (const mesEnt of fs.readdirSync(anoDir, { withFileTypes: true })) {
        if (!mesEnt.isDirectory() || !/^\d{2}$/.test(mesEnt.name)) continue;
        out.push(`${anoEnt.name}-${mesEnt.name}`);
      }
    }
    // _sem_competencia
    const sem = path.join(base, '_sem_competencia');
    if (fs.existsSync(sem)) out.push('_sem_competencia');
    return out.sort();
  }

  private lerChavesIndice(base: string): number | null {
    const file = path.join(base, '.adn-dedupe-index.json');
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { keys?: unknown };
      return Array.isArray(raw.keys) ? raw.keys.length : null;
    } catch {
      return null;
    }
  }

  async contarArquivos(params: {
    cnpj: string;
    ambiente: AmbienteAdn;
    competencias: string[] | null;
  }): Promise<{ porCompetencia: ContagensCompetenciaAdn[]; chavesIndice: number | null }> {
    const base = this.baseCnpj(params.cnpj, params.ambiente);
    const comps =
      params.competencias ??
      this.listarCompetenciasDisco(base).filter((c) => c !== '_sem_competencia');
    const porCompetencia: ContagensCompetenciaAdn[] = [];
    for (const comp of comps) {
      if (comp === '_sem_competencia') {
        porCompetencia.push(contarCompetenciaDir(path.join(base, '_sem_competencia'), comp));
        continue;
      }
      const m = /^(\d{4})-(\d{2})$/.exec(comp);
      if (!m) continue;
      porCompetencia.push(contarCompetenciaDir(path.join(base, m[1]!, m[2]!), comp));
    }
    return { porCompetencia, chavesIndice: this.lerChavesIndice(base) };
  }
}

/** Fonte em memória para testes offline (sem filesystem real). */
export class InventarioPersistidoMemoriaAdn implements FonteInventarioPersistidoAdn {
  private readonly porCnpj = new Map<string, ContagensCompetenciaAdn[]>();
  private readonly indices = new Map<string, number>();

  private key(cnpj: string, ambiente: AmbienteAdn): string {
    return `${cnpj.replace(/\D/g, '')}|${ambiente}`;
  }

  seed(
    cnpj: string,
    ambiente: AmbienteAdn,
    competencias: ContagensCompetenciaAdn[],
    chavesIndice?: number
  ): void {
    const k = this.key(cnpj, ambiente);
    this.porCnpj.set(k, competencias.map((c) => ({ ...c })));
    if (chavesIndice != null) this.indices.set(k, chavesIndice);
  }

  async contarArquivos(params: {
    cnpj: string;
    ambiente: AmbienteAdn;
    competencias: string[] | null;
  }): Promise<{ porCompetencia: ContagensCompetenciaAdn[]; chavesIndice: number | null }> {
    const k = this.key(params.cnpj, params.ambiente);
    const todos = this.porCnpj.get(k) ?? [];
    const filtrados =
      params.competencias == null
        ? todos
        : todos.filter((c) => params.competencias!.includes(c.competencia));
    // Competências solicitadas sem seed → zero explícito (evidência de ausência).
    if (params.competencias) {
      const map = new Map(filtrados.map((c) => [c.competencia, c]));
      const porCompetencia = params.competencias.map((comp) => {
        const hit = map.get(comp);
        if (hit) return { ...hit };
        return {
          competencia: comp,
          ...zerosClassificacao(),
          totalArquivos: 0,
        };
      });
      return { porCompetencia, chavesIndice: this.indices.get(k) ?? null };
    }
    return {
      porCompetencia: filtrados.map((c) => ({ ...c })),
      chavesIndice: this.indices.get(k) ?? null,
    };
  }
}

function contagensSessao(sync: ResultadoSyncAdn): ConsolidacaoInventarioPersistidoAdn['sessao'] {
  const c = zerosClassificacao();
  for (const d of sync.documentos) {
    const cls = d.classificacao as ClassificacaoDocumentoAdn;
    if (cls === 'emitida') c.emitidas += 1;
    else if (cls === 'recebida') c.recebidas += 1;
    else if (cls === 'intermediada') c.intermediadas += 1;
    else if (cls === 'evento') c.eventos += 1;
    else c.naoClassificados += 1;
    if (d.xmlValido === false) c.xmlInvalidos += 1;
  }
  return {
    ...c,
    totalDocumentos: sync.documentos.length,
    novosPersistiveis: sync.documentos.filter((d) => d.xmlValido !== false).length,
  };
}

export async function consolidarInventarioPersistidoAdn(params: {
  cnpj: string;
  ambiente: AmbienteAdn;
  dataInicio: string;
  dataFim: string;
  sync: ResultadoSyncAdn;
  fonte: FonteInventarioPersistidoAdn;
}): Promise<ConsolidacaoInventarioPersistidoAdn> {
  const competenciasSolicitadas = listarCompetenciasDoPeriodo(params.dataInicio, params.dataFim);
  const sessao = contagensSessao(params.sync);

  let evidenciaPersistenciaOk = true;
  let porCompetencia: ContagensCompetenciaAdn[] = [];
  let chavesIndice: number | null = null;
  let armazenadoCls = zerosClassificacao();

  try {
    const periodoScan = await params.fonte.contarArquivos({
      cnpj: params.cnpj,
      ambiente: params.ambiente,
      competencias: competenciasSolicitadas,
    });
    porCompetencia = periodoScan.porCompetencia;
    chavesIndice = periodoScan.chavesIndice;

    const totalScan = await params.fonte.contarArquivos({
      cnpj: params.cnpj,
      ambiente: params.ambiente,
      competencias: null,
    });
    for (const c of totalScan.porCompetencia) {
      armazenadoCls = somarClassificacao(armazenadoCls, c);
    }
    if (totalScan.chavesIndice != null) chavesIndice = totalScan.chavesIndice;
  } catch {
    evidenciaPersistenciaOk = false;
    porCompetencia = competenciasSolicitadas.map((comp) => ({
      competencia: comp,
      ...zerosClassificacao(),
      totalArquivos: 0,
    }));
  }

  let periodoCls = zerosClassificacao();
  for (const c of porCompetencia) {
    periodoCls = somarClassificacao(periodoCls, c);
  }

  return {
    cnpj: params.cnpj.replace(/\D/g, ''),
    ambiente: params.ambiente,
    competenciasSolicitadas,
    porCompetencia,
    periodo: {
      ...periodoCls,
      totalArquivos: totalArquivosDe(periodoCls),
      nfsEmitidasRecebidas: periodoCls.emitidas + periodoCls.recebidas,
    },
    armazenadoTotal: {
      ...armazenadoCls,
      totalArquivos: totalArquivosDe(armazenadoCls),
      chavesIndice,
    },
    sessao,
    distribuicao: {
      status: params.sync.status,
      fimDistribuicaoConfirmado: params.sync.fimDistribuicaoConfirmado,
    },
    evidenciaPersistenciaOk,
  };
}

export type ResultadoFinalAdnIniciar =
  | 'NFS_ENCONTRADAS'
  | 'NOTAS_EMITIDAS'
  | 'NOTAS_RECEBIDAS'
  | 'SEM_MOVIMENTO'
  | 'ADN_INVENTARIO_INDETERMINADO';

/**
 * resultado_final usa EXCLUSIVAMENTE o inventário da competência solicitada.
 * Contagens globais da sessão ADN (outros meses/NSUs) nunca alteram o resultado.
 * Competência vazia + distribuição ainda PARCIAL → ADN_INVENTARIO_INDETERMINADO
 * (nunca SEM_MOVIMENTO enquanto o cursor NSU não esgotou).
 */
export function decidirResultadoFinalAdnIniciar(
  consolidacao: ConsolidacaoInventarioPersistidoAdn
): ResultadoFinalAdnIniciar {
  const { periodo, evidenciaPersistenciaOk, distribuicao } = consolidacao;

  const emitidas = periodo.emitidas;
  const recebidas = periodo.recebidas;

  if (emitidas > 0 && recebidas > 0) return 'NFS_ENCONTRADAS';
  if (emitidas > 0) return 'NOTAS_EMITIDAS';
  if (recebidas > 0) return 'NOTAS_RECEBIDAS';

  // Intermediadas/eventos na competência: há movimento fiscal rastreável.
  if (periodo.intermediadas > 0 || periodo.eventos > 0) {
    return 'NFS_ENCONTRADAS';
  }

  if (!evidenciaPersistenciaOk) {
    return 'ADN_INVENTARIO_INDETERMINADO';
  }

  // Competência vazia, mas distribuição ADN ainda incompleta → indeterminado.
  if (
    !distribuicao.fimDistribuicaoConfirmado ||
    distribuicao.status === 'PARCIAL'
  ) {
    return 'ADN_INVENTARIO_INDETERMINADO';
  }

  // Evidência: varredura do período concluída e vazia + fim NSU confirmado.
  return 'SEM_MOVIMENTO';
}

export function formatarMotivoConsolidacaoAdn(
  sync: ResultadoSyncAdn,
  consolidacao: ConsolidacaoInventarioPersistidoAdn,
  resultadoFinal: ResultadoFinalAdnIniciar
): string {
  const comps = consolidacao.competenciasSolicitadas.join(',');
  return (
    `ADN ${sync.status}; sessão novos=${consolidacao.sessao.totalDocumentos}; ` +
    `persistidos período[${comps}] emitidas=${consolidacao.periodo.emitidas} ` +
    `recebidas=${consolidacao.periodo.recebidas} intermediadas=${consolidacao.periodo.intermediadas} ` +
    `eventos=${consolidacao.periodo.eventos}; ` +
    `armazenadoTotal=${consolidacao.armazenadoTotal.totalArquivos}` +
    (consolidacao.armazenadoTotal.chavesIndice != null
      ? ` (índice=${consolidacao.armazenadoTotal.chavesIndice})`
      : '') +
    `; fimNSU=${sync.fimDistribuicaoConfirmado}; resultado=${resultadoFinal}; ` +
    `completude mensal NÃO comprovada (PARCIAL).`
  );
}

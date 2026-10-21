/**
 * Persistência segura de documentos ADN por CNPJ + ambiente.
 * Sem path traversal. Sem sobrescrever XML idêntico. Preserva eventos.
 * Não declara competência mensal completa.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { dedupeKeyDistribuicao } from './lote-analyzer';
import type { ClassificacaoDocumentoAdn, DocumentoDistribuidoAdn } from './types';

export interface ResultadoPersistenciaDocumentoAdn {
  caminho: string | null;
  duplicado: boolean;
  chaveDedupe: string;
}

export interface PersistenciaDocumentosAdn {
  salvar(
    cnpj: string,
    ambiente: AmbienteAdn,
    doc: DocumentoDistribuidoAdn
  ): Promise<ResultadoPersistenciaDocumentoAdn>;
  carregarChavesDedupe(cnpj: string, ambiente: AmbienteAdn): Promise<Set<string>>;
  raizCnpj(cnpj: string, ambiente: AmbienteAdn): string;
}

function normalizarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  if (!/^\d{14}$/.test(d)) {
    throw new ErroAdn('CNPJ_INVALIDO', 'PERMANENTE', 'CNPJ inválido para persistência ADN.');
  }
  return d;
}

function assertDentroDaRaiz(raiz: string, alvo: string): string {
  const root = path.resolve(raiz);
  const resolved = path.resolve(alvo);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ErroAdn('CAMINHO_INSEGURO', 'BLOQUEANTE', 'Caminho fora da raiz ADN autorizada.');
  }
  if (resolved.includes('\0') || resolved.split(path.sep).includes('..')) {
    throw new ErroAdn('CAMINHO_INSEGURO', 'BLOQUEANTE', 'Caminho ADN inválido.');
  }
  return resolved;
}

function pastaClassificacao(classificacao: ClassificacaoDocumentoAdn): string {
  switch (classificacao) {
    case 'emitida':
      return 'Emitidas';
    case 'recebida':
      return 'Recebidas';
    case 'intermediada':
      return 'Intermediadas';
    case 'evento':
      return 'Eventos';
    default:
      return '_nao_classificados';
  }
}

function segmentoCompetencia(competencia?: string): string[] {
  if (competencia && /^\d{4}-\d{2}$/.test(competencia)) {
    const [ano, mes] = competencia.split('-');
    return [ano!, mes!];
  }
  return ['_sem_competencia'];
}

function nomeArquivo(doc: DocumentoDistribuidoAdn): string {
  const chave = doc.chaveAcesso?.replace(/\D/g, '') ?? '';
  if (doc.classificacao === 'evento') {
    const evt = (doc.tipoEvento ?? 'EVENTO').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'EVENTO';
    const base = chave || `nsu-${doc.nsu ?? 'x'}`;
    return `${base}__${evt}__nsu${doc.nsu ?? 'x'}.xml`;
  }
  if (chave) return `${chave}.xml`;
  const sha = (doc.sha256 || 'semhash').slice(0, 16);
  return `nsu-${doc.nsu ?? 'x'}__${sha}.xml`;
}

function chaveDedupeDocumento(doc: DocumentoDistribuidoAdn): string {
  return dedupeKeyDistribuicao({
    NSU: doc.nsu ?? null,
    TipoDocumento:
      doc.classificacao === 'evento'
        ? 'EVENTO'
        : ((doc.tipoDocumento as 'NFSE') ?? 'NFSE'),
    ChaveAcesso: doc.chaveAcesso ?? null,
    TipoEvento: doc.tipoEvento ?? null,
  });
}

function escreverAtomico(filePath: string, content: string, mode = 0o600): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tmp, content, { mode });
    fs.renameSync(tmp, filePath);
  } catch (erro) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw erro;
  }
}

/**
 * Store em filesystem isolado por CNPJ/ambiente.
 */
export class DocumentStoreArquivoAdn implements PersistenciaDocumentosAdn {
  constructor(private readonly raiz: string) {
    const resolved = path.resolve(raiz);
    if (!resolved || resolved.includes('\0')) {
      throw new ErroAdn('RAIZ_INVALIDA', 'BLOQUEANTE', 'Raiz de persistência ADN inválida.');
    }
    this.raiz = resolved;
  }

  raizCnpj(cnpj: string, ambiente: AmbienteAdn): string {
    const c = normalizarCnpj(cnpj);
    if (ambiente !== 'producao' && ambiente !== 'producao-restrita') {
      throw new ErroAdn('AMBIENTE_INVALIDO', 'PERMANENTE', 'Ambiente ADN inválido.');
    }
    return assertDentroDaRaiz(this.raiz, path.join(this.raiz, c, ambiente));
  }

  private indexPath(cnpj: string, ambiente: AmbienteAdn): string {
    return path.join(this.raizCnpj(cnpj, ambiente), '.adn-dedupe-index.json');
  }

  async carregarChavesDedupe(cnpj: string, ambiente: AmbienteAdn): Promise<Set<string>> {
    const file = this.indexPath(cnpj, ambiente);
    if (!fs.existsSync(file)) return new Set();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { keys?: string[] };
      return new Set(Array.isArray(raw.keys) ? raw.keys.filter((k) => typeof k === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private persistirIndice(cnpj: string, ambiente: AmbienteAdn, keys: Set<string>): void {
    const file = this.indexPath(cnpj, ambiente);
    escreverAtomico(file, JSON.stringify({ keys: [...keys].sort(), atualizadoEm: new Date().toISOString() }, null, 2));
  }

  async salvar(
    cnpj: string,
    ambiente: AmbienteAdn,
    doc: DocumentoDistribuidoAdn
  ): Promise<ResultadoPersistenciaDocumentoAdn> {
    const chave = chaveDedupeDocumento(doc);
    const existentes = await this.carregarChavesDedupe(cnpj, ambiente);
    if (existentes.has(chave)) {
      return { caminho: null, duplicado: true, chaveDedupe: chave };
    }

    if (!doc.xml || !doc.xml.trim()) {
      // Metadado sem XML: registra só a chave de dedupe para não reprocessar o item.
      existentes.add(chave);
      this.persistirIndice(cnpj, ambiente, existentes);
      return { caminho: null, duplicado: false, chaveDedupe: chave };
    }

    const base = this.raizCnpj(cnpj, ambiente);
    const dir = assertDentroDaRaiz(
      this.raiz,
      path.join(base, ...segmentoCompetencia(doc.competencia), pastaClassificacao(doc.classificacao))
    );
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    const dest = assertDentroDaRaiz(this.raiz, path.join(dir, nomeArquivo(doc)));
    if (fs.existsSync(dest)) {
      const prev = fs.readFileSync(dest, 'utf8');
      if (prev === doc.xml) {
        existentes.add(chave);
        this.persistirIndice(cnpj, ambiente, existentes);
        return { caminho: dest, duplicado: true, chaveDedupe: chave };
      }
      // Conteúdo divergente: não sobrescreve — grava sufixo.
      const alt = assertDentroDaRaiz(
        this.raiz,
        path.join(dir, nomeArquivo(doc).replace(/\.xml$/, `__divergente-nsu${doc.nsu ?? 'x'}.xml`))
      );
      escreverAtomico(alt, doc.xml);
      existentes.add(chave);
      this.persistirIndice(cnpj, ambiente, existentes);
      return { caminho: alt, duplicado: false, chaveDedupe: chave };
    }

    escreverAtomico(dest, doc.xml);
    existentes.add(chave);
    this.persistirIndice(cnpj, ambiente, existentes);
    return { caminho: dest, duplicado: false, chaveDedupe: chave };
  }
}

/** Store em memória (testes offline). */
export class DocumentStoreMemoriaAdn implements PersistenciaDocumentosAdn {
  private readonly keys = new Map<string, Set<string>>();
  private readonly files = new Map<string, string>();

  private bucket(cnpj: string, ambiente: AmbienteAdn): string {
    return `${normalizarCnpj(cnpj)}|${ambiente}`;
  }

  raizCnpj(cnpj: string, ambiente: AmbienteAdn): string {
    return `memory://${this.bucket(cnpj, ambiente)}`;
  }

  async carregarChavesDedupe(cnpj: string, ambiente: AmbienteAdn): Promise<Set<string>> {
    return new Set(this.keys.get(this.bucket(cnpj, ambiente)) ?? []);
  }

  async salvar(
    cnpj: string,
    ambiente: AmbienteAdn,
    doc: DocumentoDistribuidoAdn
  ): Promise<ResultadoPersistenciaDocumentoAdn> {
    const b = this.bucket(cnpj, ambiente);
    const set = this.keys.get(b) ?? new Set<string>();
    const chave = chaveDedupeDocumento(doc);
    if (set.has(chave)) {
      return { caminho: null, duplicado: true, chaveDedupe: chave };
    }
    set.add(chave);
    this.keys.set(b, set);
    const caminho = doc.xml
      ? `memory://${b}/${pastaClassificacao(doc.classificacao)}/${nomeArquivo(doc)}`
      : null;
    if (caminho && doc.xml) this.files.set(caminho, doc.xml);
    return { caminho, duplicado: false, chaveDedupe: chave };
  }

  /** Inspeção de testes. */
  obterXml(caminho: string): string | undefined {
    return this.files.get(caminho);
  }
}

export { chaveDedupeDocumento };

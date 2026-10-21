/**
 * Persistência segura de documentos ADN por CNPJ + ambiente.
 * Journal pending → XML → índice; sem sobrescrita; limite de armazenamento.
 * Não declara competência mensal completa.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { escreverArquivoAtomico, escreverArquivoAtomicoNovo } from './fs-atomic';
import { dedupeKeyDistribuicao } from './lote-analyzer';
import type { ClassificacaoDocumentoAdn, DocumentoDistribuidoAdn, LimitesAdn } from './types';
import { LIMITES_ADN_PADRAO } from './types';

export interface ResultadoPersistenciaDocumentoAdn {
  caminho: string | null;
  duplicado: boolean;
  chaveDedupe: string;
  xmlInvalidoPersistido: boolean;
  bytesGravados: number;
}

export interface PersistenciaDocumentosAdn {
  salvar(
    cnpj: string,
    ambiente: AmbienteAdn,
    doc: DocumentoDistribuidoAdn
  ): Promise<ResultadoPersistenciaDocumentoAdn>;
  carregarChavesDedupe(cnpj: string, ambiente: AmbienteAdn): Promise<Set<string>>;
  raizCnpj(cnpj: string, ambiente: AmbienteAdn): string;
  /** Reconcilia pendências XML↔índice (recuperação pós-falha). */
  reconciliar?(cnpj: string, ambiente: AmbienteAdn): Promise<{ recuperados: number; abandonados: number }>;
  estimarBytes?(cnpj: string, ambiente: AmbienteAdn): Promise<number>;
}

export interface OpcoesDocumentStoreAdn {
  maxBytesArmazenamentoCnpj?: number;
}

interface IndiceDedupeAdn {
  keys: string[];
  atualizadoEm: string;
}

interface PendenciaPersistenciaAdn {
  chaveDedupe: string;
  caminhoRelativo: string;
  sha256?: string;
  atualizadoEm: string;
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

function safePendingName(chave: string): string {
  return chave.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180) || 'pendente';
}

function somarBytesDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const atual = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(atual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(atual, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

/**
 * Store em filesystem isolado por CNPJ/ambiente.
 */
export class DocumentStoreArquivoAdn implements PersistenciaDocumentosAdn {
  private readonly maxBytes: number;

  constructor(
    private readonly raiz: string,
    opcoes: OpcoesDocumentStoreAdn | LimitesAdn = {}
  ) {
    const resolved = path.resolve(raiz);
    if (!resolved || resolved.includes('\0')) {
      throw new ErroAdn('RAIZ_INVALIDA', 'BLOQUEANTE', 'Raiz de persistência ADN inválida.');
    }
    this.raiz = resolved;
    this.maxBytes =
      'maxBytesArmazenamentoCnpj' in opcoes && opcoes.maxBytesArmazenamentoCnpj != null
        ? opcoes.maxBytesArmazenamentoCnpj
        : LIMITES_ADN_PADRAO.maxBytesArmazenamentoCnpj;
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

  private pendingDir(cnpj: string, ambiente: AmbienteAdn): string {
    return path.join(this.raizCnpj(cnpj, ambiente), '.adn-pending');
  }

  async estimarBytes(cnpj: string, ambiente: AmbienteAdn): Promise<number> {
    return somarBytesDir(this.raizCnpj(cnpj, ambiente));
  }

  private assertEspaco(cnpj: string, ambiente: AmbienteAdn, bytesExtras: number): void {
    if (this.maxBytes <= 0) return;
    const atual = somarBytesDir(this.raizCnpj(cnpj, ambiente));
    if (atual + bytesExtras > this.maxBytes) {
      throw new ErroAdn(
        'LIMITE_ARMAZENAMENTO',
        'BLOQUEANTE',
        `Limite de armazenamento ADN excedido (${atual + bytesExtras} > ${this.maxBytes}).`
      );
    }
  }

  private lerIndice(cnpj: string, ambiente: AmbienteAdn): Set<string> {
    const file = this.indexPath(cnpj, ambiente);
    if (!fs.existsSync(file)) return new Set();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as IndiceDedupeAdn;
      return new Set(Array.isArray(raw.keys) ? raw.keys.filter((k) => typeof k === 'string') : []);
    } catch {
      throw new ErroAdn(
        'INDICE_CORROMPIDO',
        'BLOQUEANTE',
        'Índice de dedupe ADN corrompido — não avança checkpoint.'
      );
    }
  }

  private persistirIndice(cnpj: string, ambiente: AmbienteAdn, keys: Set<string>): void {
    const file = this.indexPath(cnpj, ambiente);
    const payload: IndiceDedupeAdn = {
      keys: [...keys].sort(),
      atualizadoEm: new Date().toISOString(),
    };
    escreverArquivoAtomico(file, JSON.stringify(payload, null, 2));
  }

  private gravarPendencia(
    cnpj: string,
    ambiente: AmbienteAdn,
    pend: PendenciaPersistenciaAdn
  ): string {
    const dir = this.pendingDir(cnpj, ambiente);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = assertDentroDaRaiz(
      this.raiz,
      path.join(dir, `${safePendingName(pend.chaveDedupe)}.json`)
    );
    escreverArquivoAtomico(file, JSON.stringify(pend, null, 2));
    return file;
  }

  private removerPendencia(pendingFile: string): void {
    try {
      fs.unlinkSync(pendingFile);
    } catch {
      /* ignore */
    }
  }

  async reconciliar(
    cnpj: string,
    ambiente: AmbienteAdn
  ): Promise<{ recuperados: number; abandonados: number }> {
    const base = this.raizCnpj(cnpj, ambiente);
    const dir = this.pendingDir(cnpj, ambiente);
    if (!fs.existsSync(dir)) return { recuperados: 0, abandonados: 0 };

    const keys = this.lerIndice(cnpj, ambiente);
    let recuperados = 0;
    let abandonados = 0;
    let mudou = false;

    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const pendFile = path.join(dir, name);
      let pend: PendenciaPersistenciaAdn;
      try {
        pend = JSON.parse(fs.readFileSync(pendFile, 'utf8')) as PendenciaPersistenciaAdn;
      } catch {
        this.removerPendencia(pendFile);
        abandonados += 1;
        continue;
      }
      const abs = assertDentroDaRaiz(this.raiz, path.join(base, pend.caminhoRelativo));
      if (fs.existsSync(abs)) {
        if (!keys.has(pend.chaveDedupe)) {
          keys.add(pend.chaveDedupe);
          mudou = true;
          recuperados += 1;
        }
        this.removerPendencia(pendFile);
      } else {
        // XML não chegou a ser commitado — abandona pendência (sem perda: checkpoint não avançou).
        this.removerPendencia(pendFile);
        abandonados += 1;
      }
    }

    if (mudou) this.persistirIndice(cnpj, ambiente, keys);
    return { recuperados, abandonados };
  }

  async carregarChavesDedupe(cnpj: string, ambiente: AmbienteAdn): Promise<Set<string>> {
    await this.reconciliar(cnpj, ambiente);
    return this.lerIndice(cnpj, ambiente);
  }

  private resolverDestinoNovo(
    dir: string,
    doc: DocumentoDistribuidoAdn,
    preferido: string
  ): string {
    const primario = assertDentroDaRaiz(this.raiz, path.join(dir, preferido));
    if (!fs.existsSync(primario)) return primario;

    const prev = fs.readFileSync(primario, 'utf8');
    if (prev === doc.xml) {
      return primario; // idêntico — caller trata como dedupe
    }

    // Divergente: nunca sobrescreve; escolhe nome livre.
    for (let i = 0; i < 100; i++) {
      const altNome = preferido.replace(
        /\.xml$/,
        `__divergente-nsu${doc.nsu ?? 'x'}${i > 0 ? `-${i}` : ''}.xml`
      );
      const alt = assertDentroDaRaiz(this.raiz, path.join(dir, altNome));
      if (!fs.existsSync(alt)) return alt;
      const existente = fs.readFileSync(alt, 'utf8');
      if (existente === doc.xml) return alt;
    }
    throw new ErroAdn(
      'COLISAO_ARQUIVO',
      'PERMANENTE',
      'Não foi possível alocar nome de arquivo ADN sem sobrescrita.'
    );
  }

  async salvar(
    cnpj: string,
    ambiente: AmbienteAdn,
    doc: DocumentoDistribuidoAdn
  ): Promise<ResultadoPersistenciaDocumentoAdn> {
    await this.reconciliar(cnpj, ambiente);
    const chave = chaveDedupeDocumento(doc);
    const existentes = this.lerIndice(cnpj, ambiente);
    if (existentes.has(chave)) {
      return {
        caminho: null,
        duplicado: true,
        chaveDedupe: chave,
        xmlInvalidoPersistido: false,
        bytesGravados: 0,
      };
    }

    const xmlInvalido = doc.xmlValido === false;
    const temXml = Boolean(doc.xml && doc.xml.trim());

    // Inválido sem conteúdo: só índice (metadado), para não reprocessar eternamente.
    if (!temXml) {
      existentes.add(chave);
      this.persistirIndice(cnpj, ambiente, existentes);
      return {
        caminho: null,
        duplicado: false,
        chaveDedupe: chave,
        xmlInvalidoPersistido: xmlInvalido,
        bytesGravados: 0,
      };
    }

    const xml = doc.xml!;
    const bytes = Buffer.byteLength(xml, 'utf8');
    this.assertEspaco(cnpj, ambiente, bytes);

    const base = this.raizCnpj(cnpj, ambiente);
    const pasta = xmlInvalido
      ? '_xml_invalidos'
      : pastaClassificacao(doc.classificacao);
    const dir = assertDentroDaRaiz(
      this.raiz,
      path.join(base, ...segmentoCompetencia(doc.competencia), pasta)
    );
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    const preferido = nomeArquivo(doc);
    const dest = this.resolverDestinoNovo(dir, doc, preferido);

    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === xml) {
      existentes.add(chave);
      this.persistirIndice(cnpj, ambiente, existentes);
      return {
        caminho: dest,
        duplicado: true,
        chaveDedupe: chave,
        xmlInvalidoPersistido: xmlInvalido,
        bytesGravados: 0,
      };
    }

    const caminhoRelativo = path.relative(base, dest);
    const pendingFile = this.gravarPendencia(cnpj, ambiente, {
      chaveDedupe: chave,
      caminhoRelativo,
      sha256: doc.sha256 || undefined,
      atualizadoEm: new Date().toISOString(),
    });

    try {
      escreverArquivoAtomicoNovo(dest, xml);
      existentes.add(chave);
      this.persistirIndice(cnpj, ambiente, existentes);
      this.removerPendencia(pendingFile);
    } catch (erro) {
      // Mantém pendência se XML existe (reconciliar recupera índice);
      // se XML não existe, reconciliar abandona a pendência.
      if (!fs.existsSync(dest)) {
        this.removerPendencia(pendingFile);
      }
      throw erro;
    }

    return {
      caminho: dest,
      duplicado: false,
      chaveDedupe: chave,
      xmlInvalidoPersistido: xmlInvalido,
      bytesGravados: bytes,
    };
  }
}

/** Store em memória (testes offline). */
export class DocumentStoreMemoriaAdn implements PersistenciaDocumentosAdn {
  private readonly keys = new Map<string, Set<string>>();
  private readonly files = new Map<string, string>();
  private readonly maxBytes: number;
  private falharEm?: (doc: DocumentoDistribuidoAdn) => Error | null;

  constructor(opcoes: OpcoesDocumentStoreAdn = {}) {
    this.maxBytes = opcoes.maxBytesArmazenamentoCnpj ?? 0;
  }

  /** Gancho de teste para simular falha mid-persistência. */
  simularFalha(fn: (doc: DocumentoDistribuidoAdn) => Error | null): void {
    this.falharEm = fn;
  }

  private bucket(cnpj: string, ambiente: AmbienteAdn): string {
    return `${normalizarCnpj(cnpj)}|${ambiente}`;
  }

  raizCnpj(cnpj: string, ambiente: AmbienteAdn): string {
    return `memory://${this.bucket(cnpj, ambiente)}`;
  }

  async estimarBytes(cnpj: string, ambiente: AmbienteAdn): Promise<number> {
    const prefix = `memory://${this.bucket(cnpj, ambiente)}/`;
    let total = 0;
    for (const [k, v] of this.files) {
      if (k.startsWith(prefix)) total += Buffer.byteLength(v, 'utf8');
    }
    return total;
  }

  async carregarChavesDedupe(cnpj: string, ambiente: AmbienteAdn): Promise<Set<string>> {
    return new Set(this.keys.get(this.bucket(cnpj, ambiente)) ?? []);
  }

  async salvar(
    cnpj: string,
    ambiente: AmbienteAdn,
    doc: DocumentoDistribuidoAdn
  ): Promise<ResultadoPersistenciaDocumentoAdn> {
    if (this.falharEm) {
      const err = this.falharEm(doc);
      if (err) throw err;
    }

    const b = this.bucket(cnpj, ambiente);
    const set = this.keys.get(b) ?? new Set<string>();
    const chave = chaveDedupeDocumento(doc);
    if (set.has(chave)) {
      return {
        caminho: null,
        duplicado: true,
        chaveDedupe: chave,
        xmlInvalidoPersistido: false,
        bytesGravados: 0,
      };
    }

    const xmlInvalido = doc.xmlValido === false;
    const bytes = doc.xml ? Buffer.byteLength(doc.xml, 'utf8') : 0;
    if (this.maxBytes > 0 && doc.xml) {
      const atual = await this.estimarBytes(cnpj, ambiente);
      if (atual + bytes > this.maxBytes) {
        throw new ErroAdn(
          'LIMITE_ARMAZENAMENTO',
          'BLOQUEANTE',
          'Limite de armazenamento ADN (memória) excedido.'
        );
      }
    }

    set.add(chave);
    this.keys.set(b, set);

    const pasta = xmlInvalido ? '_xml_invalidos' : pastaClassificacao(doc.classificacao);
    const caminho = doc.xml ? `memory://${b}/${pasta}/${nomeArquivo(doc)}` : null;
    if (caminho && doc.xml) this.files.set(caminho, doc.xml);

    return {
      caminho,
      duplicado: false,
      chaveDedupe: chave,
      xmlInvalidoPersistido: xmlInvalido && Boolean(doc.xml),
      bytesGravados: bytes,
    };
  }

  obterXml(caminho: string): string | undefined {
    return this.files.get(caminho);
  }
}

export { chaveDedupeDocumento };

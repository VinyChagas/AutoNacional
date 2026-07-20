/**
 * Gerenciador de downloads para automação NFSe.
 *
 * Fornece funções utilitárias para interceptar, identificar,
 * nomear e salvar downloads de forma robusta e reutilizável.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { Page, Download, APIResponse } from 'playwright';
import { getLogger } from '../infrastructure/logger';
import { resolveStoragePath } from '../utils/path-resolve';

const logger = getLogger('download-manager');

const BACKEND_DIR = path.resolve(__dirname, '../..');
const DOWNLOADS_TESTE_DIR = path.join(BACKEND_DIR, 'downloads_teste');

let _downloadsBasePath: string | null = null;

/**
 * Define o caminho base para downloads.
 */
export function setDownloadsBasePath(basePath: string): void {
  _downloadsBasePath = resolveStoragePath(basePath);
  logger.debug({ path: _downloadsBasePath }, 'Caminho base de downloads configurado');
}

/**
 * Obtém o caminho base para downloads.
 * Se não configurado, usa pasta de testes dentro do backend.
 */
export function getDownloadBasePath(): string {
  if (_downloadsBasePath) {
    return _downloadsBasePath;
  }
  return DOWNLOADS_TESTE_DIR;
}

/** Mês por extenso em português (índice 1 = janeiro). */
const MESES_EXTENSO: readonly string[] = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Formata o mês da execução para uso como nome de pasta.
 * Usa o mês que está sendo executado (não a competência da nota).
 * Ex: (2026, 1) → "janeiro-2026"
 */
export function formatarMesExecucaoParaPasta(ano: number, mes: number): string {
  const mesIdx = Math.max(0, Math.min(mes - 1, 11));
  const nomeMes = MESES_EXTENSO[mesIdx];
  return `${nomeMes}-${ano}`;
}

/**
 * Formata a competência para uso como nome de pasta.
 * @deprecated Use formatarMesExecucaoParaPasta para nova estrutura (contabilidade/mês-ano/empresa).
 * Ex: "10/2025" → "10-2025"
 */
export function formatarCompetenciaParaPasta(competencia: string): string {
  return competencia.replace('/', '-');
}

/**
 * Sanitiza o nome do arquivo removendo caracteres inválidos.
 */
export function sanitizarNomeArquivo(nome: string): string {
  let result = nome.replace(/[<>:"/\\|?*]/g, '_');
  result = result.replace(/\s+/g, '_');
  return result.trim();
}

/**
 * Sanitiza o nome para uso como nome de pasta.
 */
export function sanitizarNomePasta(nome: string): string {
  let result = nome.trim();
  result = result.replace(/[^\w\s-]/g, '');
  result = result.replace(/\s+/g, ' ');
  return result;
}

/**
 * Detecta a extensão correta do arquivo baixado.
 */
export async function detectarExtensaoArquivo(download: Download): Promise<string> {
  try {
    await download.path();

    const url = download.url();
    if (url.toLowerCase().includes('xml') || url.toLowerCase().includes('application/xml')) {
      return '.xml';
    }
    if (url.toLowerCase().includes('pdf') || url.toLowerCase().includes('danfse')) {
      return '.pdf';
    }
  } catch {
    /* ignore */
  }

  try {
    const tempPath = await download.path();
    const fullBuffer = await fs.readFile(tempPath);
    const buffer = fullBuffer.subarray(0, 10);
    if (buffer[0] === 0x3c || (buffer[0] === 0x3f && buffer[1] === 0x78)) {
      return '.xml';
    }
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return '.pdf';
    }
  } catch {
    /* ignore */
  }

  logger.warn('Não foi possível detectar extensão. Usando .bin');
  return '.bin';
}

/**
 * Gera o nome final do arquivo.
 */
export async function gerarNomeArquivo(
  download: Download,
  extensao: string,
  prefixo?: string
): Promise<string> {
  const suggestedName = download.suggestedFilename();
  const nomeValido =
    suggestedName &&
    suggestedName.length <= 200 &&
    (suggestedName.endsWith('.xml') ||
      suggestedName.endsWith('.pdf') ||
      suggestedName.endsWith('.bin') ||
      /[a-zA-Z0-9]/.test(suggestedName));

  let nomeFinal: string;
  if (nomeValido) {
    const nomeBase = path.basename(suggestedName, path.extname(suggestedName));
    nomeFinal = `${nomeBase}${extensao}`;
  } else {
    nomeFinal = prefixo ? `${prefixo}${extensao}` : `nota_${Date.now()}${extensao}`;
  }

  return sanitizarNomeArquivo(nomeFinal);
}

/**
 * Monta o caminho completo seguindo a hierarquia definida.
 * Estrutura: {base_path}/{contabilidade}/{mes_extenso}-{ano}/{empresa}/{tipo_nota}/
 * - contabilidade: nome da contabilidade em execução
 * - mes_extenso: mês da execução por extenso (ex: janeiro-2026), NÃO a competência da nota
 */
export function montarCaminhoCompleto(
  basePath: string,
  nomeContabilidade: string,
  mesExecucaoExtenso: string,
  empresa: string,
  tipoNota: string
): string {
  const tipo = tipoNota.trim();
  if (tipo !== 'Emitidas' && tipo !== 'Recebidas') {
    throw new Error(`tipo_nota deve ser 'Emitidas' ou 'Recebidas'. Recebido: ${tipo}`);
  }

  const contabFolder = sanitizarNomePasta(nomeContabilidade) || 'Contabilidade';
  const empresaFolder = sanitizarNomePasta(empresa);
  const caminhoCompleto = path.join(basePath, contabFolder, mesExecucaoExtenso, empresaFolder, tipo);

  return caminhoCompleto;
}

/**
 * Salva um download já interceptado no diretório correto.
 * Estrutura: {base}/{contabilidade}/{mes_extenso}-{ano}/{empresa}/{tipo}/
 */
export async function salvarDownloadDireto(
  download: Download,
  basePath: string,
  nomeContabilidade: string,
  mesExecucaoExtenso: string,
  empresa: string,
  tipoNota: string,
  nomeArquivoPrefixo?: string
): Promise<string> {
  const extensao = await detectarExtensaoArquivo(download);
  const nomeArquivo = await gerarNomeArquivo(download, extensao, nomeArquivoPrefixo);
  const dirDestino = montarCaminhoCompleto(basePath, nomeContabilidade, mesExecucaoExtenso, empresa, tipoNota);

  await fs.mkdir(dirDestino, { recursive: true });

  const caminhoFinal = path.join(dirDestino, nomeArquivo);
  await download.saveAs(caminhoFinal);

  logger.debug({ caminho: caminhoFinal }, 'Arquivo salvo com sucesso');
  return caminhoFinal;
}

export interface FileValidationResult {
  valid: boolean;
  path?: string;
  reason?: string;
  size?: number;
}

/**
 * Valida arquivo baixado (existência, tamanho e assinatura mínima XML/PDF).
 */
export async function validarArquivoBaixado(
  filePath: string,
  tipoArquivo: 'xml' | 'pdf'
): Promise<FileValidationResult> {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() || st.size <= 0) {
      return { valid: false, path: filePath, reason: 'arquivo vazio ou inexistente', size: st.size };
    }

    const buf = await fs.readFile(filePath);
    const head = buf.subarray(0, Math.min(512, buf.length));

    if (tipoArquivo === 'pdf') {
      const sig = head.toString('ascii', 0, 4);
      if (sig !== '%PDF') {
        return { valid: false, path: filePath, reason: 'arquivo sem assinatura %PDF', size: st.size };
      }
      return { valid: true, path: filePath, size: st.size };
    }

    // XML
    const text = head.toString('utf8').trimStart();
    if (!text || text.startsWith('<!DOCTYPE html') || /^<html[\s>]/i.test(text)) {
      return { valid: false, path: filePath, reason: 'conteudo parece HTML de erro, nao XML', size: st.size };
    }
    if (!text.startsWith('<') && !text.startsWith('<?xml')) {
      return { valid: false, path: filePath, reason: 'conteudo nao parece XML', size: st.size };
    }
    return { valid: true, path: filePath, size: st.size };
  } catch (e) {
    return {
      valid: false,
      path: filePath,
      reason: (e as Error).message,
    };
  }
}

/** Remove arquivo inválido (best-effort) antes de retry. */
export async function removerArquivoInvalido(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    /* ignore */
  }
}

/**
 * Procura arquivo válido já existente na pasta destino (idempotência).
 * Usa prefixo do número da nota e extensão esperada.
 */
export async function localizarArquivoExistenteValido(
  basePath: string,
  nomeContabilidade: string,
  mesExecucaoExtenso: string,
  empresa: string,
  tipoNota: string,
  tipoArquivo: 'xml' | 'pdf',
  nomeArquivoPrefixo?: string
): Promise<FileValidationResult> {
  const dir = montarCaminhoCompleto(basePath, nomeContabilidade, mesExecucaoExtenso, empresa, tipoNota);
  const ext = tipoArquivo === 'pdf' ? '.pdf' : '.xml';
  try {
    const entries = await fs.readdir(dir);
    const prefix = nomeArquivoPrefixo?.replace(/_$/, '') || '';
    const candidates = entries.filter((name) => {
      const lower = name.toLowerCase();
      if (!lower.endsWith(ext)) return false;
      if (!prefix) return true;
      return lower.includes(prefix.toLowerCase().slice(0, 20));
    });

    for (const name of candidates) {
      const full = path.join(dir, name);
      const result = await validarArquivoBaixado(full, tipoArquivo);
      if (result.valid) return result;
    }
  } catch {
    /* pasta ainda não existe */
  }
  return { valid: false, reason: 'nenhum arquivo valido encontrado' };
}

/**
 * Baixa um arquivo diretamente via requisição HTTP usando a sessão autenticada.
 * Estratégia RECOMENDADA para downloads.
 */
export async function baixarArquivoDireto(
  page: Page,
  seletorLink: string,
  basePath: string,
  nomeContabilidade: string,
  mesExecucaoExtenso: string,
  empresa: string,
  tipoNota: string
): Promise<string> {
  const tipo = tipoNota.trim();
  if (tipo !== 'Emitidas' && tipo !== 'Recebidas') {
    throw new Error(`tipo_nota deve ser 'Emitidas' ou 'Recebidas'. Recebido: ${tipo}`);
  }

  const linkLocator = page.locator(seletorLink);
  if ((await linkLocator.count()) === 0) {
    throw new Error(`Link não encontrado com seletor: ${seletorLink}`);
  }

  const href = await linkLocator.nth(0).getAttribute('href');
  if (!href) {
    throw new Error(`Link encontrado mas href está vazio. Seletor: ${seletorLink}`);
  }

  const currentUrl = page.url();
  const fullUrl = new URL(href, currentUrl).href;
  const nomeChave = href.split('/').pop() || href;

  const response: APIResponse = await page.request.get(fullUrl);
  if (response.status() !== 200) {
    throw new Error(`Erro na requisição HTTP. Status: ${response.status()}, URL: ${fullUrl}`);
  }

  const contentType = (response.headers()['content-type'] || '').toLowerCase();
  const content = await response.body();

  let extensao: string;
  if (contentType.includes('xml')) {
    extensao = '.xml';
  } else if (contentType.includes('pdf')) {
    extensao = '.pdf';
  } else if (content[0] === 0x3c || (content[1] === 0x3f && content[2] === 0x78)) {
    extensao = '.xml';
  } else if (content[0] === 0x25 && content[1] === 0x50 && content[2] === 0x44) {
    extensao = '.pdf';
  } else {
    extensao = '.bin';
  }

  const contabFolder = sanitizarNomePasta(nomeContabilidade) || 'Contabilidade';
  const empresaFolder = sanitizarNomePasta(empresa);
  const pastaFinal = path.join(basePath, contabFolder, mesExecucaoExtenso, empresaFolder, tipo);
  await fs.mkdir(pastaFinal, { recursive: true });

  const nomeArquivo = sanitizarNomeArquivo(`${nomeChave}${extensao}`);
  const caminhoFinal = path.join(pastaFinal, nomeArquivo);

  await fs.writeFile(caminhoFinal, content);
  logger.debug({ caminho: caminhoFinal, size: content.length }, 'Arquivo salvo com sucesso');

  return caminhoFinal;
}

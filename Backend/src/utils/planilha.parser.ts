/**
 * Parser de planilhas (xlsx, csv) para importação de credenciais.
 * Estrutura fixa - Linha 2 = cabeçalhos:
 *   Coluna A (0) = Razão Social
 *   Coluna B (1) = Tipo de Login
 *   Coluna C (2) = CNPJ ou CPF
 *   Coluna D (3) = Senha
 *   Coluna E (4) = Regime Tributário
 */
import * as XLSX from 'xlsx';
import { normalizarDocumento } from './documento.utils';

/** Cabeçalhos oficiais (linha 2 da planilha). Mantém sync com o modelo baixável. */
export const CABECALHOS_PLANILHA_CREDENCIAIS = [
  'Razão Social',
  'Tipo de Login',
  'CNPJ ou CPF',
  'Senha',
  'Regime Tributário',
] as const;

export const NOME_ARQUIVO_MODELO_CREDENCIAIS =
  'modelo_importacao_credenciais.xlsx';

function normalizarHeader(h: string): string {
  return String(h ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[áàâã]/g, 'a')
    .replace(/[éèê]/g, 'e')
    .replace(/[íìî]/g, 'i')
    .replace(/[óòôõ]/g, 'o')
    .replace(/[úùû]/g, 'u')
    .replace(/ç/g, 'c');
}

function validarCabecalhos(headers: string[]): boolean {
  if (!headers || headers.length < 5) return false;
  const h0 = normalizarHeader(String(headers[0] ?? ''));
  const h1 = normalizarHeader(String(headers[1] ?? ''));
  const h2 = normalizarHeader(String(headers[2] ?? ''));
  const h3 = normalizarHeader(String(headers[3] ?? ''));
  const h4 = normalizarHeader(String(headers[4] ?? ''));
  return (
    (h0.includes('razao') && h0.includes('social')) &&
    (h1.includes('tipo') && h1.includes('login')) &&
    (h2.includes('cnpj') || h2.includes('cpf')) &&
    h3.includes('senha') &&
    (h4.includes('regime') || h4.includes('tributari'))
  );
}

export interface LinhaCredencial {
  razao_social: string;
  tipo_login: 'CNPJ' | 'CPF';
  cnpj_ou_cpf: string;
  senha: string;
  regime?: string;
  linha: number;
  indice: number;
}

const COLS = {
  razao_social: 0,
  tipo_login: 1,
  cnpj_ou_cpf: 2,
  senha: 3,
  regime: 4,
} as const;

/**
 * Parse de buffer (xlsx ou csv) para linhas de credencial.
 * Linha 1 = opcional, Linha 2 = cabeçalhos obrigatórios, Linha 3+ = dados.
 */
export function parsePlanilhaCredenciais(buffer: Buffer): LinhaCredencial[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const primeira = workbook.SheetNames[0];
  if (!primeira) return [];
  const sheet = workbook.Sheets[primeira];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  }) as string[][];

  if (!data.length) return [];

  // Linha 2 (índice 1) = cabeçalhos obrigatórios
  if (data.length < 2) {
    throw new Error('Modelo de planilha inválido. Utilize o modelo oficial.');
  }
  const headerRowIndex = 1;
  const headers = (data[headerRowIndex] ?? []).map((c) => String(c ?? ''));

  if (!validarCabecalhos(headers)) {
    throw new Error('Modelo de planilha inválido. Utilize o modelo oficial.');
  }

  const dataStartIndex = headerRowIndex + 1;
  const resultado: LinhaCredencial[] = [];

  for (let i = dataStartIndex; i < data.length; i++) {
    const row = data[i] ?? [];
    const cnpjOuCpf = normalizarDocumento(String(row[COLS.cnpj_ou_cpf] ?? ''));
    const tipoRaw = String(row[COLS.tipo_login] ?? 'CNPJ').toUpperCase().trim();
    const tipo: 'CNPJ' | 'CPF' = tipoRaw.includes('CPF') ? 'CPF' : 'CNPJ';
    const razao = String(row[COLS.razao_social] ?? '').trim();
    const senha = String(row[COLS.senha] ?? '').trim();
    const regime = String(row[COLS.regime] ?? '').trim() || undefined;

    if (!cnpjOuCpf && !senha && !razao) continue;

    resultado.push({
      razao_social: razao || `Empresa ${cnpjOuCpf || `Linha ${i + 1}`}`,
      tipo_login: tipo,
      cnpj_ou_cpf: cnpjOuCpf,
      senha,
      regime,
      linha: i + 1,
      indice: resultado.length,
    });
  }
  return resultado;
}

/**
 * Gera o .xlsx oficial aceito por `parsePlanilhaCredenciais`.
 * Linha 1 = instrução; linha 2 = cabeçalhos; linhas 3+ = exemplos (editáveis).
 */
export function gerarModeloPlanilhaCredenciais(): Buffer {
  const instrucao =
    'Modelo oficial AutoNacional — preencha a partir da linha 3. ' +
    'Tipo de Login: CNPJ ou CPF. Regime Tributário é opcional.';

  const exemplos: string[][] = [
    [
      'Empresa Exemplo LTDA',
      'CNPJ',
      '00.000.000/0001-91',
      'sua_senha_aqui',
      'Simples Nacional',
    ],
    [
      'João da Silva',
      'CPF',
      '000.000.000-00',
      'sua_senha_aqui',
      '',
    ],
  ];

  const aoa: string[][] = [
    [instrucao],
    [...CABECALHOS_PLANILHA_CREDENCIAIS],
    ...exemplos,
  ];

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [
    { wch: 36 },
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
    { wch: 20 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Credenciais');
  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

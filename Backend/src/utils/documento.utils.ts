/**
 * Utilitários para normalização e validação de documentos (CNPJ/CPF).
 */

/**
 * Remove máscara de documento (pontos, traços, barras, espaços).
 */
export function normalizarDocumento(valor: string): string {
  return String(valor ?? '').replace(/[.\/\-\s]/g, '').trim();
}

/**
 * Valida se string contém apenas 14 dígitos (CNPJ).
 */
export function validarCNPJ(valor: string): boolean {
  const n = normalizarDocumento(valor);
  if (n.length !== 14) return false;
  if (!/^\d{14}$/.test(n)) return false;
  // CNPJs conhecidos inválidos (todos dígitos iguais)
  if (/^(\d)\1{13}$/.test(n)) return false;
  return true;
}

/**
 * Valida se string contém apenas 11 dígitos (CPF).
 */
export function validarCPF(valor: string): boolean {
  const n = normalizarDocumento(valor);
  if (n.length !== 11) return false;
  if (!/^\d{11}$/.test(n)) return false;
  // CPFs conhecidos inválidos (todos dígitos iguais)
  if (/^(\d)\1{10}$/.test(n)) return false;
  // Dígitos verificadores
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(n[i] ?? '0', 10) * (10 - i);
  let d1 = (soma * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(n[9] ?? '0', 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(n[i] ?? '0', 10) * (11 - i);
  let d2 = (soma * 10) % 11;
  if (d2 === 10) d2 = 0;
  if (d2 !== parseInt(n[10] ?? '0', 10)) return false;
  return true;
}

/**
 * Retorna CNPJ para armazenamento em empresas.
 * CPF (11 dígitos) é convertido para "000" + CPF = 14 dígitos.
 */
export function cnpjParaEmpresa(documento: string, tipo: 'CNPJ' | 'CPF'): string {
  const n = normalizarDocumento(documento);
  if (tipo === 'CPF' && n.length === 11) {
    return '000' + n;
  }
  return n;
}

/**
 * Formata documento para exibição (CNPJ ou CPF).
 */
export function formatarDocumento(doc: string, tipo: 'CNPJ' | 'CPF'): string {
  const n = normalizarDocumento(doc);
  if (tipo === 'CPF' && n.length === 11) {
    return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  if (n.length === 14) {
    return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return n || '-';
}

/**
 * Registro seguro de evidências de homologação.
 * Sem PFX, senha, XML integral, tokens, cookies, CPF ou chaves completas.
 */
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import type { EvidenciaHomologacaoSegura, OperacaoHomologacao } from './types';
import { HomologacaoNfseError } from './types';

const CAMPOS_PROIBIDOS = [
  'senha',
  'passphrase',
  'pfx',
  'password',
  'xml',
  'token',
  'cookie',
  'cpf',
  'chaveprivada',
  'privatekey',
];

export function mascararCnpjHomologacao(cnpj: string): string {
  const digitos = cnpj.replace(/\D/g, '');
  if (digitos.length !== 14) return '****';
  return `${digitos.slice(0, 4)}…${digitos.slice(-2)}`;
}

export function registrarEvidenciaHomologacao(entrada: {
  execucaoId: string;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  operacao: OperacaoHomologacao;
  evento: string;
  detalhes?: Record<string, unknown>;
  agora?: Date;
}): EvidenciaHomologacaoSegura {
  const evento = entrada.evento.trim();
  if (!evento) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Evento de evidência ausente.');
  }
  return {
    versao: 1,
    execucaoId: entrada.execucaoId.trim(),
    cnpjMascarado: mascararCnpjHomologacao(entrada.cnpj),
    periodoConsulta: entrada.periodoConsulta,
    operacao: entrada.operacao,
    evento,
    registradoEm: (entrada.agora ?? new Date()).toISOString(),
    detalhes: sanitizarDetalhes(entrada.detalhes ?? {}),
  };
}

export function evidenciaContemSegredo(evidencia: EvidenciaHomologacaoSegura): boolean {
  const texto = JSON.stringify(evidencia).toLowerCase();
  return CAMPOS_PROIBIDOS.some((campo) => texto.includes(`"${campo}"`)) || /begin (certificate|private)/i.test(texto);
}

function sanitizarDetalhes(
  bruto: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  const saida: Record<string, string | number | boolean | null> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    const chaveBaixa = chave.toLowerCase();
    if (CAMPOS_PROIBIDOS.some((p) => chaveBaixa.includes(p))) continue;
    if (valor === null) {
      saida[chave] = null;
      continue;
    }
    if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
      if (typeof valor === 'string' && valor.length > 200) {
        saida[chave] = `${valor.slice(0, 200)}…`;
      } else {
        saida[chave] = valor;
      }
    }
  }
  return saida;
}

/**
 * Fingerprint canônico do inventário fiscal (identidade do checkpoint).
 * SHA-256 hex de CNPJ, início, fim e documentos ordenados pela chave.
 * Cada documento entra só com chave, direção e situação.
 * Senha, PFX, chave privada, XML e dCompet ficam de fora.
 */
import { createHash } from 'node:crypto';
import type { InventarioNfse } from '../contracts/inventario';

export function calcularFingerprintInventario(inventario: InventarioNfse): string {
  const linhas = [...inventario.documentos]
    .map((documento) => `${documento.chaveNacional}:${documento.direcao}:${documento.situacao}`)
    .sort();
  const canonico = [inventario.cnpj, inventario.periodoConsulta.inicio, inventario.periodoConsulta.fim, ...linhas].join(
    '\n'
  );
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

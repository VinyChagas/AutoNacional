/**
 * Criptografia de credenciais.
 * Usa AES-256-CBC com chave derivada de APP_CRED_KEY.
 */
import * as crypto from 'crypto';
import { CRYPTO_KEY, APP_CRED_KEY } from './config';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const key = CRYPTO_KEY || APP_CRED_KEY || 'dev-key-default-change-in-production';
  return crypto.scryptSync(key, 'autonacional-salt', KEY_LENGTH);
}

export function encryptPassword(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  return iv.toString('base64') + ':' + encrypted.toString('base64');
}

export function decryptPassword(encrypted: string): string {
  const key = getKey();
  const [ivB64, dataB64] = encrypted.split(':');
  if (!ivB64 || !dataB64) {
    throw new Error('Formato de senha criptografada inválido');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return decipher.update(data) + decipher.final('utf8');
}

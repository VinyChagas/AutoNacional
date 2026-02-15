/**
 * Criptografia AES-256-GCM para credenciais (somente server).
 * Nunca exponha CRYPTO_KEY ou funções de decrypt ao frontend.
 */
import * as crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT = 'autonacional-cred-v1';

function getKey(): Buffer {
  const key = env.CRYPTO_KEY || 'dev-key-change-in-production';
  return crypto.scryptSync(key, SALT, KEY_LENGTH);
}

/**
 * Criptografa string com AES-256-GCM.
 * Formato armazenado: iv_base64:authTag_base64:ciphertext_base64
 */
export function encrypt(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Descriptografa string criptografada com encrypt().
 * Compatível com formato iv:authTag:data (base64).
 */
export function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de senha criptografada inválido');
  }
  const [ivB64, authTagB64, dataB64] = parts;
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Formato de senha criptografada inválido');
  }
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final('utf8');
}

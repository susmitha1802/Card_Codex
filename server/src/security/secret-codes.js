import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
export const SECRET_CODE_MIN_LENGTH = 8;
export const SECRET_CODE_MAX_LENGTH = 128;

// A random salt makes identical codes produce different hashes. Keep this
// version's parameters fixed so a malformed stored hash cannot request more work.
const parameters = { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };
const hashPattern = /^scrypt\$v1\$65536\$8\$2\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

export function isValidSecretCode(code) {
  // Reject broken Unicode rather than silently replacing it during UTF-8 hashing.
  if (typeof code !== 'string' || !code.isWellFormed() || !code.trim()) return false;
  const length = Array.from(code).length;
  return length >= SECRET_CODE_MIN_LENGTH && length <= SECRET_CODE_MAX_LENGTH;
}

export async function hashSecretCode(code) {
  if (!isValidSecretCode(code)) throw new Error('Invalid secret code.');
  const salt = randomBytes(16);
  const key = await deriveKey(code, salt, 64, parameters);
  return `scrypt$v1$65536$8$2$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifySecretCode(code, encodedHash) {
  if (!isValidSecretCode(code) || typeof encodedHash !== 'string'
    || encodedHash.length !== 'scrypt$v1$65536$8$2$'.length + 32 + 1 + 128) return false;
  const parts = hashPattern.exec(encodedHash);
  if (!parts) return false;
  try {
    const expected = Buffer.from(parts[2], 'hex');
    const actual = await deriveKey(code, Buffer.from(parts[1], 'hex'), 64, parameters);
    return timingSafeEqual(actual, expected);
  } catch {
    // A damaged hash or failed comparison must never reveal or unlock content.
    return false;
  }
}

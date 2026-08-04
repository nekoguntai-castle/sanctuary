import crypto from 'crypto';
import { promisify } from 'util';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number
) => Promise<Buffer>;

// Salt for key derivation - configurable via environment variable
// IMPORTANT: Changing this will invalidate all existing encrypted data
function getEncryptionSalt(): string {
  const salt = process.env.ENCRYPTION_SALT;
  if (!salt) {
    // Fall back to default for backward compatibility with existing installations
    // New installations should set ENCRYPTION_SALT for better security
    console.warn('');
    console.warn('SECURITY WARNING: ENCRYPTION_SALT environment variable is not set.');
    console.warn('Using default salt for backward compatibility.');
    console.warn('For better security, set a unique ENCRYPTION_SALT in your environment.');
    console.warn('');
    console.warn('CAUTION: If you set ENCRYPTION_SALT after data has been encrypted,');
    console.warn('existing encrypted data (like node passwords) will become unreadable.');
    console.warn('You will need to re-enter those values after changing the salt.');
    console.warn('');
    return 'sanctuary-node-config'; // Default for backward compatibility
  }
  return salt;
}

let encryptionKeyCache: Buffer | null = null;
let encryptionSaltCache: string | null = null;

/**
 * Get the cached encryption key. Throws if not initialized via validateEncryptionKey().
 * The key is derived once at startup using async scrypt to avoid blocking the event loop,
 * then cached for all subsequent synchronous encrypt/decrypt operations.
 */
function getEncryptionKey(): Buffer {
  if (!encryptionKeyCache) {
    throw new Error(
      'Encryption key not initialized. Call validateEncryptionKey() at startup before using encrypt/decrypt.'
    );
  }
  return encryptionKeyCache;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * @returns Encrypted string in format: iv:authTag:ciphertext (all base64)
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt an encrypted string
 * @param encrypted String in format: iv:authTag:ciphertext (all base64)
 */
export function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted string format');
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;
  const authTag = Buffer.from(authTagB64, 'base64');
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted string authentication tag length');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivB64, 'base64'),
    { authTagLength: AUTH_TAG_LENGTH }
  );
  decipher.setAuthTag(authTag);

  return (
    decipher.update(ciphertextB64, 'base64', 'utf8') + decipher.final('utf8')
  );
}

/**
 * Check if a string appears to be encrypted (matches our format)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;

  const parts = value.split(':');
  if (parts.length !== 3) return false;

  // Check each part is valid base64
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return parts.every((p) => p.length > 0 && base64Regex.test(p));
}

/**
 * Decrypt a value if it's encrypted, otherwise return as-is
 * Useful for backward compatibility with existing plaintext passwords
 */
export function decryptIfEncrypted(value: string): string {
  if (isEncrypted(value)) {
    return decrypt(value);
  }
  return value;
}

/**
 * Initialize and validate the encryption key.
 * Uses async scrypt to derive the key without blocking the event loop.
 * Must be called (and awaited) at startup before any encrypt/decrypt operations.
 */
export async function validateEncryptionKey(): Promise<void> {
  const currentSalt = getEncryptionSalt();

  // If salt changed, invalidate the key cache
  if (encryptionSaltCache !== null && encryptionSaltCache !== currentSalt) {
    encryptionKeyCache = null;
  }
  encryptionSaltCache = currentSalt;

  if (encryptionKeyCache) {
    return;
  }

  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY environment variable must be set and at least 32 characters long'
    );
  }

  encryptionKeyCache = await scryptAsync(key, currentSalt, 32);
}

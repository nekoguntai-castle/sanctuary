import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { z } from 'zod';
import { encrypt, decryptIfEncrypted } from '../utils/encryption';
import { safeJsonParse } from '../utils/safeJson';

const ISSUER = 'Sanctuary';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

const BackupCodesSchema = z.array(z.object({ hash: z.string(), used: z.boolean() }));

/**
 * Generate a new TOTP secret and QR code for 2FA setup
 * Returns the encrypted secret for secure database storage
 */
export async function generateSecret(username: string): Promise<{
  secret: string;
  qrCodeDataUrl: string;
}> {
  const plaintextSecret = otpGenerateSecret();
  const otpauthUrl = generateURI({
    issuer: ISSUER,
    label: username,
    secret: plaintextSecret,
  });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  // Encrypt the secret before returning for storage
  const encryptedSecret = encrypt(plaintextSecret);

  return { secret: encryptedSecret, qrCodeDataUrl };
}

/**
 * Verify a TOTP token against a secret
 * Handles both encrypted secrets (new) and plaintext secrets (legacy) for backward compatibility
 */
export function verifyToken(secret: string, token: string): boolean {
  try {
    // Decrypt the secret if it's encrypted, otherwise use as-is (backward compatibility)
    const plaintextSecret = decryptIfEncrypted(secret);
    // @ts-expect-error otplib v13 types don't include window but it works at runtime
    const result = verifySync({ token, secret: plaintextSecret, window: 1 });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generate random backup codes
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // Generate 8 character alphanumeric code
    // Use more bytes to ensure we have enough chars after filtering non-alphanumeric
    let code = '';
    while (code.length < BACKUP_CODE_LENGTH) {
      const chunk = crypto
        .randomBytes(BACKUP_CODE_LENGTH * 2) // Generate extra to account for filtering
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();
      code += chunk;
    }
    codes.push(code.substring(0, BACKUP_CODE_LENGTH));
  }
  return codes;
}

/**
 * Hash backup codes for secure storage
 */
export async function hashBackupCodes(codes: string[]): Promise<string> {
  const hashedCodes = await Promise.all(
    codes.map(async (code) => ({
      hash: await bcrypt.hash(code.toUpperCase(), 10),
      used: false,
    }))
  );
  return JSON.stringify(hashedCodes);
}

/**
 * Verify a backup code and mark it as used if valid
 * Returns the updated hashed codes string if valid, null if invalid
 */
export async function verifyBackupCode(
  hashedCodesJson: string | null,
  inputCode: string
): Promise<{ valid: boolean; updatedCodesJson: string | null }> {
  if (!hashedCodesJson) {
    return { valid: false, updatedCodesJson: null };
  }

  const codes = safeJsonParse(hashedCodesJson, BackupCodesSchema, [], 'backupCodes');
  if (codes.length === 0) {
    return { valid: false, updatedCodesJson: null };
  }

  const normalizedInput = inputCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

  for (let i = 0; i < codes.length; i++) {
    if (codes[i].used) continue;

    const match = await bcrypt.compare(normalizedInput, codes[i].hash);
    if (match) {
      // Mark code as used
      codes[i].used = true;
      return { valid: true, updatedCodesJson: JSON.stringify(codes) };
    }
  }

  return { valid: false, updatedCodesJson: null };
}

/**
 * Get the count of remaining (unused) backup codes
 */
export function getRemainingBackupCodeCount(hashedCodesJson: string | null): number {
  if (!hashedCodesJson) return 0;

  const codes = safeJsonParse(hashedCodesJson, BackupCodesSchema, [], 'backupCodes');
  return codes.filter((c) => !c.used).length;
}

/**
 * Check if a code looks like a backup code (8 alphanumeric chars) vs TOTP (6 digits)
 */
export function isBackupCode(code: string): boolean {
  const normalized = code.replace(/[^A-Z0-9]/gi, '');
  // TOTP codes are 6 digits, backup codes are 8 alphanumeric
  return normalized.length === BACKUP_CODE_LENGTH && !/^\d+$/.test(normalized);
}

export default {
  generateSecret,
  verifyToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
  getRemainingBackupCodeCount,
  isBackupCode,
};

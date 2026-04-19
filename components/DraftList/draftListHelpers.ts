import { DraftTransaction } from '../../src/api/drafts';
import { WalletType } from '../../types';
import { ExpirationUrgency } from './types';
import { getExpirationInfo } from './utils';

const BASE64_PSBT_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
const HEX_PSBT_PATTERN = /^[0-9a-fA-F\s]+$/;
const PSBT_MAGIC = 'psbt';
const PSBT_SEPARATOR = 0xff;

const urgencyOrder: Record<ExpirationUrgency, number> = {
  expired: 0,
  critical: 1,
  warning: 2,
  normal: 3,
};

export interface ParsedPsbtFile {
  base64: string;
  format: 'binary' | 'base64' | 'hex';
  byteLength?: number;
}

export function sortDraftsByExpiration(drafts: DraftTransaction[]): DraftTransaction[] {
  return [...drafts].sort(compareDrafts);
}

export function getDownloadablePsbt(draft: DraftTransaction): string {
  return draft.signedPsbtBase64 || draft.psbtBase64;
}

export function createPsbtBlob(psbtBase64: string): Blob {
  const bytes = base64ToBytes(psbtBase64);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return new Blob([buffer], { type: 'application/octet-stream' });
}

export function getDraftPsbtFilename(draftId: string): string {
  return `sanctuary-draft-${draftId.slice(0, 8)}.psbt`;
}

export function getSignedDraftStatus(walletType: WalletType): 'partial' | 'signed' {
  return walletType === WalletType.MULTI_SIG ? 'partial' : 'signed';
}

export async function readSignedPsbtFile(file: File): Promise<ParsedPsbtFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (hasBinaryPsbtMagic(bytes)) {
    return {
      base64: bytesToBase64(bytes),
      format: 'binary',
      byteLength: bytes.length,
    };
  }

  return parseTextPsbt(await file.text());
}

function compareDrafts(a: DraftTransaction, b: DraftTransaction): number {
  const aExpiration = getExpirationInfo(a.expiresAt);
  const bExpiration = getExpirationInfo(b.expiresAt);

  if (aExpiration && !bExpiration) return -1;
  if (!aExpiration && bExpiration) return 1;
  if (!aExpiration && !bExpiration) return compareCreatedAtDesc(a, b);

  const urgencyDiff = urgencyOrder[aExpiration!.urgency] - urgencyOrder[bExpiration!.urgency];
  return urgencyDiff || aExpiration!.diffMs - bExpiration!.diffMs;
}

function compareCreatedAtDesc(a: DraftTransaction, b: DraftTransaction): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function hasBinaryPsbtMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;

  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return magic === PSBT_MAGIC && bytes[4] === PSBT_SEPARATOR;
}

function parseTextPsbt(text: string): ParsedPsbtFile {
  const content = text.trim();

  if (content.match(BASE64_PSBT_PATTERN)) {
    return parseBase64Psbt(content);
  }

  if (content.match(HEX_PSBT_PATTERN)) {
    return {
      base64: bytesToBase64(parseHexBytes(content)),
      format: 'hex',
    };
  }

  throw new Error('Invalid PSBT file format. Expected binary, base64, or hex.');
}

function parseBase64Psbt(content: string): ParsedPsbtFile {
  const cleanBase64 = content.replace(/\s/g, '');

  try {
    const decoded = atob(cleanBase64);
    if (!decoded.startsWith(PSBT_MAGIC)) {
      throw new Error('Not a valid PSBT (missing magic bytes)');
    }

    return {
      base64: cleanBase64,
      format: 'base64',
    };
  } catch {
    throw new Error('Invalid base64 PSBT file');
  }
}

function parseHexBytes(content: string): Uint8Array {
  const cleanHex = content.replace(/\s/g, '');
  const hexPairs = cleanHex.match(/.{1,2}/g)!;
  return new Uint8Array(hexPairs.map(byte => parseInt(byte, 16)));
}

function base64ToBytes(psbtBase64: string): Uint8Array {
  const binaryString = atob(psbtBase64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

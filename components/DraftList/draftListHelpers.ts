import { DraftTransaction } from '../../src/api/drafts';
import { WalletType } from '../../types';
import {
  BASE64_TEXT_PATTERN,
  HEX_TEXT_PATTERN,
  base64ToBytes,
  bytesToBase64,
  hasBip174BinaryPsbtMagic,
  hasPsbtMagicText,
  hexTextToBytes,
} from '../../utils/psbtFormat';
import { ExpirationUrgency } from './types';
import { getExpirationInfo } from './utils';

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
  if (hasBip174BinaryPsbtMagic(bytes)) {
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

function parseTextPsbt(text: string): ParsedPsbtFile {
  const content = text.trim();

  if (content.match(BASE64_TEXT_PATTERN)) {
    return parseBase64Psbt(content);
  }

  if (content.match(HEX_TEXT_PATTERN)) {
    return {
      base64: bytesToBase64(hexTextToBytes(content)),
      format: 'hex',
    };
  }

  throw new Error('Invalid PSBT file format. Expected binary, base64, or hex.');
}

function parseBase64Psbt(content: string): ParsedPsbtFile {
  const cleanBase64 = content.replace(/\s/g, '');

  try {
    const decoded = atob(cleanBase64);
    if (!hasPsbtMagicText(decoded)) {
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

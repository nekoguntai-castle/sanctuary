import type { SignedPsbtImport } from './types';

const INVALID_PSBT_FILE_FORMAT = 'Invalid PSBT file format. Expected binary PSBT, base64, or hex.';

/**
 * Raised when an uploaded signed-PSBT file is readable but not one of the
 * accepted encodings: binary PSBT, base64 PSBT text, or hex PSBT text.
 */
export class InvalidPsbtFileFormatError extends Error {
  constructor() {
    super(INVALID_PSBT_FILE_FORMAT);
    this.name = 'InvalidPsbtFileFormatError';
  }
}

/**
 * Reads a signed PSBT file from QR-signing fallback upload.
 *
 * Accepted formats are BIP-174 binary PSBT, base64 PSBT text, and hex PSBT
 * text. Read failures and parse failures are normalized to Error instances so
 * modal error rendering can show the user-facing message directly.
 */
export async function readSignedPsbtFile(file: File): Promise<SignedPsbtImport> {
  const bytes = new Uint8Array(await readFileAsArrayBuffer(file));
  const binaryBase64 = parseBinaryPsbt(bytes);

  if (binaryBase64) {
    return { base64: binaryBase64, source: 'binary', size: bytes.length };
  }

  const content = await readFileAsText(file);
  return parseTextPsbt(content);
}

export function isInvalidPsbtFileFormatError(error: unknown): error is InvalidPsbtFileFormatError {
  return error instanceof InvalidPsbtFileFormatError;
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => {
      resolve(event.target!.result as ArrayBuffer);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve((event.target!.result as string).trim());
    reader.onerror = () => reject(new Error('Failed to read file as text'));
    reader.readAsText(file);
  });
}

function parseBinaryPsbt(bytes: Uint8Array) {
  if (!hasBinaryPsbtMagic(bytes)) {
    return null;
  }

  return bytesToBase64(bytes);
}

function hasBinaryPsbtMagic(bytes: Uint8Array) {
  // BIP-174 binary PSBTs start with ASCII "psbt" followed by 0xff.
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x70 &&
    bytes[1] === 0x73 &&
    bytes[2] === 0x62 &&
    bytes[3] === 0x74 &&
    bytes[4] === 0xff
  );
}

function parseTextPsbt(content: string): SignedPsbtImport {
  try {
    const base64Result = parseBase64TextPsbt(content);
    if (base64Result) return base64Result;

    const hexResult = parseHexTextPsbt(content);
    if (hexResult) return hexResult;

    throw new InvalidPsbtFileFormatError();
  } catch (error) {
    if (isInvalidPsbtFileFormatError(error)) {
      throw error;
    }

    throw new Error('Failed to parse PSBT file');
  }
}

function parseBase64TextPsbt(content: string): SignedPsbtImport | null {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(content)) {
    return null;
  }

  const cleanBase64 = content.replace(/\s/g, '');
  const decoded = atob(cleanBase64);

  return decoded.startsWith('psbt')
    ? { base64: cleanBase64, source: 'base64' }
    : null;
}

function parseHexTextPsbt(content: string): SignedPsbtImport | null {
  if (!/^[0-9a-fA-F\s]+$/.test(content)) {
    return null;
  }

  const cleanHex = content.replace(/\s/g, '');
  const pairs = cleanHex.match(/.{1,2}/g)!;
  const hexBytes = new Uint8Array(pairs.map(byte => parseInt(byte, 16)));
  return { base64: bytesToBase64(hexBytes), source: 'hex' };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}
